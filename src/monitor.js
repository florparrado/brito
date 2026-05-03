import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULTS = {
  sourcesFile: "config/sources.json",
  stateFile: "data/seen.json",
  intervalMinutes: 15,
  maxPrice: 2100,
  minRooms: 3,
  minArea: 80,
  requestTimeoutMs: 20000,
  stateKey: "barcelona-rental-monitor:state",
  userAgent:
    "Mozilla/5.0 (compatible; BarcelonaRentalMonitor/1.0; +local personal rental alerts)"
};

const TEMPORARY_PATTERNS = [
  /temporad[ao]/i,
  /vacacion(?:al|es)/i,
  /ocio/i,
  /recreativ[ao]/i,
  /32\s*d[ií]as/i,
  /11\s*mes(?:es)?/i,
  /10\s*mes(?:es)?/i,
  /3\s*mes(?:es)?/i,
  /corta\s+estancia/i,
  /short\s+term/i,
  /temporary/i,
  /uso\s+tur[ií]stico/i,
  /segunda\s+residencia/i
];

const POSITIVE_LONG_TERM_PATTERNS = [
  /larga\s+estancia/i,
  /larga\s+duraci[oó]n/i,
  /llarga\s+estada/i,
  /long\s+term/i,
  /vivienda\s+habitual/i,
  /residencial/i,
  /contrato\s+(?:de\s+)?(?:5|7)\s+a[nñ]os/i
];

const DISCARD_PATTERNS = [
  /habitaci[oó]n\s+en\s+alquiler/i,
  /room\s+for\s+rent/i,
  /local\s+comercial/i,
  /\blocal\b/i,
  /oficina/i,
  /despacho/i,
  /parking/i,
  /parquing/i,
  /garaje/i,
  /\bventa\b/i,
  /\bvendido\b/i,
  /\balquilado\b/i,
  /reservado/i,
  /traspaso/i
];

const PRIORITY_ZONE_PATTERNS = [
  /dreta\s+de\s+l['’]?eixample/i,
  /eixample\s+dreta/i,
  /eixample\s+derech[ao]/i,
  /right\s+eixample/i,
  /\bborn\b/i,
  /el\s+borne/i,
  /la\s+ribera/i,
  /sant\s+pere\s*[-–]\s*santa\s+caterina/i,
  /santa\s+caterina\s+i\s+la\s+ribera/i
];

const NEARBY_ZONE_PATTERNS = [
  /eixample/i,
  /ciutat\s+vella/i,
  /g[oó]tic/i,
  /raval/i,
  /sant\s+antoni/i,
  /fort\s+pienc/i,
  /gr[aà]cia/i,
  /sants/i,
  /poblenou/i,
  /vila\s+ol[ií]mpica/i
];

export function readEnvFile(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function loadDotEnv() {
  try {
    const text = await fs.readFile(".env", "utf8");
    const parsed = readEnvFile(text);
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}

function getOptions(args = process.argv.slice(2)) {
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  return {
    sourcesFile: process.env.SOURCES_FILE || DEFAULTS.sourcesFile,
    stateFile: process.env.STATE_FILE || DEFAULTS.stateFile,
    intervalMinutes: Number(process.env.INTERVAL_MINUTES || DEFAULTS.intervalMinutes),
    maxPrice: Number(process.env.MAX_PRICE || DEFAULTS.maxPrice),
    minRooms: Number(process.env.MIN_ROOMS || DEFAULTS.minRooms),
    minArea: Number(process.env.MIN_AREA || DEFAULTS.minArea),
    stateBackend: process.env.STATE_BACKEND || (process.env.UPSTASH_REDIS_REST_URL ? "upstash" : "file"),
    stateKey: process.env.STATE_KEY || DEFAULTS.stateKey,
    dryRun: flags.has("--dry-run"),
    notifyPageChanges: flags.has("--notify-page-changes")
  };
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function saveJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadState(options) {
  if (options.stateBackend === "upstash") {
    return loadUpstashState(options);
  }
  return loadJson(options.stateFile, { seen: {}, pages: {} });
}

async function saveState(options, state) {
  if (options.stateBackend === "upstash") {
    await saveUpstashState(options, state);
    return;
  }
  await saveJson(options.stateFile, state);
}

async function upstashCommand(command) {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !token) {
    throw new Error("Faltan UPSTASH_REDIS_REST_URL o UPSTASH_REDIS_REST_TOKEN.");
  }

  const response = await fetch(restUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`Upstash error ${response.status}: ${body.error || JSON.stringify(body)}`);
  }
  return body.result;
}

async function loadUpstashState(options) {
  const value = await upstashCommand(["GET", options.stateKey]);
  if (!value) return { seen: {}, pages: {} };
  try {
    return JSON.parse(value);
  } catch {
    return { seen: {}, pages: {} };
  }
}

async function saveUpstashState(options, state) {
  await upstashCommand(["SET", options.stateKey, JSON.stringify(state)]);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|article|section|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&euro;/g, "€")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLinks(html, baseUrl) {
  const links = [];
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html))) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      const text = htmlToText(match[2]).slice(0, 180);
      links.push({ url, text });
    } catch {
      // Ignore malformed links.
    }
  }
  return links;
}

function parseNumber(value) {
  if (!value) return undefined;
  return Number(value.replace(/[.\s]/g, "").replace(",", "."));
}

function extractPrice(text) {
  const pricePattern = /(?:^|[^\d])((?:\d{1,3}(?:[.\s]\d{3})+|\d{3,5})(?:,\d{1,2})?)\s*(?:€|eur|euros)(?:\s*\/?\s*(?:mes|month|mensual))?/gi;
  const reversePricePattern = /(?:€|eur)\s*((?:\d{1,3}(?:[.\s]\d{3})+|\d{3,5})(?:,\d{1,2})?)/gi;
  const values = [];
  for (const pattern of [pricePattern, reversePricePattern]) {
    let match;
    while ((match = pattern.exec(text))) {
      const value = parseNumber(match[1]);
      if (value !== undefined) values.push(value);
    }
  }
  return values.length ? Math.min(...values) : undefined;
}

export function parseListingText(text) {
  const areaMatch = text.match(/(\d{2,4})(?:[.,]\d+)?\s*m(?:2|²|<sup>2<\/sup>)?/i);
  const roomsMatch = text.match(/(\d{1,2})\s*(?:hab\.?|habs\.?|habitaciones|dorm\.?|dormitorios|bedrooms|rooms|habitacions)/i);
  const referenceMatch = text.match(/\bref(?:erencia)?\.?\s*:?\s*([A-Z0-9_-]{3,})/i);

  return {
    price: extractPrice(text),
    area: areaMatch ? Number(areaMatch[1]) : undefined,
    rooms: roomsMatch ? Number(roomsMatch[1]) : undefined,
    reference: referenceMatch?.[1]
  };
}

function hasAny(patterns, value) {
  return patterns.some((pattern) => pattern.test(value));
}

function zonePriority(text) {
  if (hasAny(PRIORITY_ZONE_PATTERNS, text)) return "priority";
  if (hasAny(NEARBY_ZONE_PATTERNS, text)) return "nearby";
  return "unknown";
}

export function buildContactMessage({ contactName, title, reference, url }) {
  const greeting = contactName ? `Hola ${contactName}!` : "Hola!";
  const propertyLabel = reference || title || url || "el piso publicado";
  return `${greeting} Escribo para programar una visita al piso de alquiler ${propertyLabel}.\nSomos una familia de 4, y nos encajaría perfecto.`;
}

export function classifyCandidate(candidate, options = DEFAULTS) {
  const text = `${candidate.title || ""} ${candidate.snippet || ""} ${candidate.zone || ""}`;
  const parsed = {
    ...parseListingText(text),
    ...candidate
  };

  const reasons = [];
  const temporary = hasAny(TEMPORARY_PATTERNS, text);
  const longTerm = hasAny(POSITIVE_LONG_TERM_PATTERNS, text);
  const discardText = hasAny(DISCARD_PATTERNS, text);
  const zoneMatch = zonePriority(text);

  if (temporary) reasons.push("parece temporal/vacacional");
  if (discardText) reasons.push("parece no residencial, venta o no disponible");
  if (parsed.price && parsed.price > options.maxPrice) reasons.push(`precio ${parsed.price} > ${options.maxPrice}`);
  if (parsed.rooms && parsed.rooms < options.minRooms) reasons.push(`solo ${parsed.rooms} habitaciones`);
  if (parsed.area && parsed.area < options.minArea) reasons.push(`solo ${parsed.area} m2`);
  if (!parsed.price) reasons.push("sin precio claro");
  if (!parsed.rooms) reasons.push("sin habitaciones claras");
  if (!parsed.area) reasons.push("sin superficie clara");

  const hardDiscard =
    temporary ||
    discardText ||
    (parsed.price !== undefined && parsed.price > options.maxPrice) ||
    (parsed.rooms !== undefined && parsed.rooms < options.minRooms) ||
    (parsed.area !== undefined && parsed.area < options.minArea);

  if (hardDiscard) {
    return { ...parsed, priority: "descartar", reasons, longTerm, zoneMatch };
  }

  const hasMinimums =
    parsed.price !== undefined &&
    parsed.rooms !== undefined &&
    parsed.area !== undefined &&
    parsed.price <= options.maxPrice &&
    parsed.rooms >= options.minRooms &&
    parsed.area >= options.minArea;

  if (hasMinimums && longTerm && zoneMatch === "priority") {
    return { ...parsed, priority: "alta prioridad", reasons: ["encaja con filtros y zona prioritaria"], longTerm, zoneMatch };
  }

  if (hasMinimums) {
    if (!longTerm) reasons.push("larga estancia no confirmada");
    if (zoneMatch !== "priority") reasons.push(zoneMatch === "nearby" ? "zona cercana, no prioritaria" : "zona no confirmada");
    return { ...parsed, priority: "revisar", reasons, longTerm, zoneMatch };
  }

  return { ...parsed, priority: "descartar", reasons, longTerm, zoneMatch };
}

function makeCandidateId(candidate) {
  return hash(
    [
      candidate.sourceName,
      candidate.url,
      candidate.reference,
      candidate.title,
      candidate.price,
      candidate.area,
      candidate.rooms
    ]
      .filter(Boolean)
      .join("|")
  );
}

export function extractCandidatesFromPage({ source, url, html }) {
  const text = htmlToText(html);
  const links = extractLinks(html, url);
  const candidates = [];
  const blocks = extractListingBlocks(html);

  for (const block of blocks) {
    const snippet = htmlToText(block);
    if (!looksLikeListing(snippet)) continue;
    const blockLinks = extractLinks(block, url);
    const detailLink = blockLinks.find((link) => looksLikeDetailLink(link)) || blockLinks[0];
    candidates.push({
      sourceName: source.name,
      sourceType: source.type,
      sourceContact: source.contact,
      url: detailLink?.url || url,
      title: cleanTitle(detailLink?.text || snippet),
      snippet,
      zone: source.zone
    });
  }

  if (candidates.length > 0) return candidates;
  if (/portal/i.test(source.type || "")) return candidates;

  const priceRegex = /(?:.{0,300})(?:\d[\d.\s]{2,}(?:,\d{1,2})?\s*(?:€|eur|euros)|(?:€|eur)\s*\d[\d.\s]{2,})(?:.{0,500})/gi;
  let match;
  while ((match = priceRegex.exec(text)) && candidates.length < 5) {
    const snippet = match[0].replace(/\s+/g, " ").trim();
    if (!looksLikeListing(snippet)) continue;
    const nearbyLink = links.find((link) => looksLikeDetailLink(link) && snippet.includes(link.text.slice(0, 40)));
    candidates.push({
      sourceName: source.name,
      sourceType: source.type,
      sourceContact: source.contact,
      url: nearbyLink?.url || url,
      title: cleanTitle(nearbyLink?.text || snippet),
      snippet,
      zone: source.zone
    });
  }

  return candidates;
}

function extractListingBlocks(html) {
  const blocks = [];
  const blockPatterns = [
    /<article\b[\s\S]*?<\/article>/gi,
    /<li\b[^>]*(?:property|inmueble|listing|card|result|item)[^>]*>[\s\S]*?<\/li>/gi,
    /<div\b[^>]*(?:property|inmueble|listing|card|result|item|product|estate)[^>]*>[\s\S]*?<\/div>/gi
  ];

  for (const pattern of blockPatterns) {
    let match;
    while ((match = pattern.exec(html))) {
      if (/(?:€|eur|euros|&euro;|&#x20ac;)/i.test(match[0])) blocks.push(match[0]);
    }
  }

  return blocks;
}

function looksLikeListing(text) {
  const hasPrice = extractPrice(text) !== undefined;
  const hasHousingWord = /alquiler|lloguer|rent|piso|apartamento|vivienda|habitatge|flat|apartment/i.test(text);
  const hasRooms = /(?:\d{1,2}\s*(?:hab\.?|habitaciones|dorm\.?|dormitorios|bedrooms|habitacions))|(?:habitaciones|dormitorios|bedrooms|habitacions)/i.test(text);
  const hasArea = /\d{2,4}(?:[.,]\d+)?\s*m(?:2|²)?/i.test(text);
  const tooGeneric = /reformas parciales|administraciones verticales|atenci[oó]n al cliente|financiaci[oó]n|servicios inmobiliarios/i.test(text);
  return hasPrice && hasHousingWord && hasRooms && hasArea && !tooGeneric;
}

function looksLikeDetailLink(link) {
  return /piso|alquiler|lloguer|inmueble|propiedad|property|apartamento|vivienda|flat|rent/i.test(`${link.url} ${link.text}`);
}

function cleanTitle(text) {
  return htmlToText(text)
    .replace(/\s+/g, " ")
    .replace(/^[-–|,.\s]+/, "")
    .slice(0, 120);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULTS.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": DEFAULTS.userAgent,
        accept: "text/html,application/xhtml+xml"
      },
      signal: controller.signal
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function formatAlert(candidate) {
  const message = buildContactMessage(candidate);
  const fields = [
    `${candidate.priority.toUpperCase()}: ${candidate.title || "Piso detectado"}`,
    `Fuente: ${candidate.sourceName} (${candidate.sourceType || "fuente"})`,
    `Zona: ${candidate.zone || "sin zona"} | Precio: ${candidate.price ?? "?"} € | ${candidate.area ?? "?"} m2 | ${candidate.rooms ?? "?"} hab`,
    candidate.reference ? `Referencia: ${candidate.reference}` : null,
    candidate.sourceContact ? `Contacto fuente: ${candidate.sourceContact}` : null,
    `Motivo: ${(candidate.reasons || []).join("; ") || "encaja para revisar"}`,
    `Enlace: ${candidate.url}`,
    "",
    message
  ].filter(Boolean);
  return fields.join("\n");
}

async function sendTelegram(text, options) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (options.dryRun || !token || !chatId) {
    console.log(`\n--- TELEGRAM ${options.dryRun ? "DRY RUN" : "NO CONFIGURADO"} ---\n${text}\n`);
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram error ${response.status}: ${await response.text()}`);
  }
}

async function checkSource(source, state, options) {
  const findings = [];
  const errors = [];
  const report = {
    name: source.name,
    type: source.type,
    zone: source.zone,
    status: "failed",
    checkedAt: new Date().toISOString(),
    attemptedUrls: 0,
    successfulUrls: 0,
    failedUrls: 0,
    candidatesFound: 0,
    newAlerts: 0,
    errors: []
  };
  const urls = source.rentalUrls?.length ? source.rentalUrls : [source.website];

  for (const url of urls) {
    report.attemptedUrls += 1;
    try {
      const { ok, status, body } = await fetchText(url);
      if (!ok) {
        const message = `${source.name}: ${url} devolvio ${status}`;
        errors.push(message);
        report.errors.push(message);
        report.failedUrls += 1;
        continue;
      }
      report.successfulUrls += 1;

      const pageHash = hash(body);
      const pageKey = hash(`${source.name}|${url}`);
      const previousPageHash = state.pages?.[pageKey];
      state.pages ??= {};
      state.pages[pageKey] = pageHash;

      const rawCandidates = extractCandidatesFromPage({ source, url, html: body });
      const classified = rawCandidates.map((candidate) => classifyCandidate(candidate, options));
      report.candidatesFound += rawCandidates.length;

      for (const candidate of classified) {
        if (candidate.priority === "descartar") continue;
        const id = makeCandidateId(candidate);
        candidate.id = id;
        if (state.seen?.[id]) continue;
        state.seen ??= {};
        state.seen[id] = {
          firstSeenAt: new Date().toISOString(),
          sourceName: candidate.sourceName,
          url: candidate.url,
          priority: candidate.priority,
          title: candidate.title,
          price: candidate.price,
          area: candidate.area,
          rooms: candidate.rooms
        };
        findings.push(candidate);
        report.newAlerts += 1;
      }

      if (options.notifyPageChanges && previousPageHash && previousPageHash !== pageHash && findings.length === 0) {
        const id = hash(`${source.name}|${url}|${pageHash}`);
        if (!state.seen?.[id]) {
          state.seen ??= {};
          state.seen[id] = { firstSeenAt: new Date().toISOString(), sourceName: source.name, url, priority: "revisar" };
          findings.push({
            id,
            sourceName: source.name,
            sourceType: source.type,
            sourceContact: source.contact,
            zone: source.zone,
            url,
            title: "Cambio detectado en pagina de alquiler/patrimonio",
            snippet: "La pagina cambio, pero no se pudo extraer una ficha completa.",
            priority: "revisar",
            reasons: ["cambio de pagina sin ficha estructurada"]
          });
          report.newAlerts += 1;
        }
      }
    } catch (error) {
      const message = `${source.name}: ${url} fallo (${error.message})`;
      errors.push(message);
      report.errors.push(message);
      report.failedUrls += 1;
    }
  }

  if (report.successfulUrls > 0 && report.failedUrls === 0) report.status = "success";
  else if (report.successfulUrls > 0) report.status = "partial";

  return { findings, errors, report };
}

export async function runCheck(options = getOptions()) {
  const startedAt = new Date().toISOString();
  const sources = await loadJson(options.sourcesFile, []);
  const state = await loadState(options);
  const activeSources = sources.filter((source) => source.status !== "paused");
  const allFindings = [];
  const allErrors = [];
  const sourceReports = [];

  for (const source of activeSources) {
    const { findings, errors, report } = await checkSource(source, state, options);
    allFindings.push(...findings);
    allErrors.push(...errors);
    sourceReports.push(report);
  }

  for (const finding of allFindings) {
    await sendTelegram(formatAlert(finding), options);
  }

  const finishedAt = new Date().toISOString();
  const summary = recordRunSummary(state, {
    startedAt,
    finishedAt,
    checkedSources: activeSources.length,
    successfulSources: sourceReports.filter((report) => report.status === "success").length,
    partialSources: sourceReports.filter((report) => report.status === "partial").length,
    failedSources: sourceReports.filter((report) => report.status === "failed").length,
    attemptedUrls: sourceReports.reduce((total, report) => total + report.attemptedUrls, 0),
    successfulUrls: sourceReports.reduce((total, report) => total + report.successfulUrls, 0),
    failedUrls: sourceReports.reduce((total, report) => total + report.failedUrls, 0),
    newAlerts: allFindings.length,
    errors: allErrors,
    sourceReports,
    stateBackend: options.stateBackend
  });

  await saveState(options, state);

  console.log(JSON.stringify(summary, null, 2));

  return { findings: allFindings, errors: allErrors };
}

function recordRunSummary(state, summary) {
  const run = {
    id: hash(`${summary.startedAt}|${summary.finishedAt}`),
    ...summary
  };

  state.runs ??= [];
  state.runs.unshift(run);
  state.runs = state.runs.slice(0, 120);

  state.sourceStats ??= {};
  for (const report of summary.sourceReports) {
    const current = state.sourceStats[report.name] || {
      name: report.name,
      type: report.type,
      zone: report.zone,
      successCount: 0,
      partialCount: 0,
      failureCount: 0,
      totalNewAlerts: 0
    };
    current.lastStatus = report.status;
    current.lastCheckedAt = report.checkedAt;
    current.lastError = report.errors.at(-1) || null;
    current.lastNewAlerts = report.newAlerts;
    current.successCount += report.status === "success" ? 1 : 0;
    current.partialCount += report.status === "partial" ? 1 : 0;
    current.failureCount += report.status === "failed" ? 1 : 0;
    current.totalNewAlerts += report.newAlerts;
    state.sourceStats[report.name] = current;
  }

  state.alertLog ??= [];
  for (const report of summary.sourceReports) {
    if (report.newAlerts > 0) {
      state.alertLog.unshift({
        runId: run.id,
        sourceName: report.name,
        count: report.newAlerts,
        createdAt: summary.finishedAt
      });
    }
  }
  state.alertLog = state.alertLog.slice(0, 120);

  return {
    id: run.id,
    checkedSources: summary.checkedSources,
    successfulSources: summary.successfulSources,
    partialSources: summary.partialSources,
    failedSources: summary.failedSources,
    attemptedUrls: summary.attemptedUrls,
    successfulUrls: summary.successfulUrls,
    failedUrls: summary.failedUrls,
    newAlerts: summary.newAlerts,
    stateBackend: summary.stateBackend,
    errors: summary.errors
  };
}

async function runWatch(options) {
  console.log(`Monitor activo cada ${options.intervalMinutes} minutos.`);
  while (true) {
    await runCheck(options);
    await new Promise((resolve) => setTimeout(resolve, options.intervalMinutes * 60 * 1000));
  }
}

async function runSimulation(options) {
  const candidate = classifyCandidate(
    {
      sourceName: "Simulacion Finques",
      sourceType: "finques",
      sourceContact: "agente@example.com",
      zone: "Dreta de l'Eixample",
      url: "https://example.com/piso-123",
      title: "Piso familiar en Dreta de l'Eixample REF ABC123",
      snippet:
        "Alquiler de larga estancia. Piso familiar en Dreta de l'Eixample. 3 habitaciones, 92 m2, 2 baños. 2.050 € / mes. Referencia: ABC123."
    },
    options
  );
  await sendTelegram(formatAlert(candidate), { ...options, dryRun: true });
}

async function main() {
  await loadDotEnv();
  const [command = "check"] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const options = getOptions();

  if (command === "check") await runCheck(options);
  else if (command === "watch") await runWatch(options);
  else if (command === "simulate") await runSimulation(options);
  else {
    console.error(`Comando no reconocido: ${command}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
