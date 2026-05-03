import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "../src/monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(__dirname, "public");
const configPath = path.join(rootDir, "data", "dashboard-config.json");
const defaultStateKey = "barcelona-rental-monitor:state";
const defaultRepo = "florparrado/brito";

await loadDotEnv();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/") {
      return sendFile(response, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/styles.css") {
      return sendFile(response, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/app.js") {
      return sendFile(response, path.join(publicDir, "app.js"), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      const config = await getConfig();
      return sendJson(response, publicConfig(config));
    }
    if (request.method === "POST" && url.pathname === "/api/config") {
      const body = await readJsonBody(request);
      await saveConfig({
        upstashUrl: body.upstashUrl?.trim(),
        upstashToken: body.upstashToken?.trim(),
        stateKey: body.stateKey?.trim() || defaultStateKey,
        githubRepo: body.githubRepo?.trim() || defaultRepo
      });
      return sendJson(response, { ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/summary") {
      const config = await getConfig();
      const [stateResult, githubResult] = await Promise.all([
        loadDashboardState(config),
        loadGithubRuns(config.githubRepo || defaultRepo)
      ]);
      return sendJson(response, {
        generatedAt: new Date().toISOString(),
        config: publicConfig(config),
        state: stateResult.state,
        stateError: stateResult.error,
        github: githubResult.runs,
        githubError: githubResult.error
      });
    }
    return sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    return sendJson(response, { error: error.message }, 500);
  }
});

const port = Number(process.env.DASHBOARD_PORT || 4173);
server.listen(port, "127.0.0.1", () => {
  console.log(`Dashboard listo en http://127.0.0.1:${port}`);
});

async function loadDotEnv() {
  try {
    const text = await fs.readFile(path.join(rootDir, ".env"), "utf8");
    const parsed = readEnvFile(text);
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}

function publicConfig(config) {
  return {
    hasUpstash: Boolean(config.upstashUrl && config.upstashToken),
    stateKey: config.stateKey || defaultStateKey,
    githubRepo: config.githubRepo || defaultRepo
  };
}

async function getConfig() {
  const fileConfig = await readJson(configPath, {});
  return {
    upstashUrl: fileConfig.upstashUrl || process.env.UPSTASH_REDIS_REST_URL,
    upstashToken: fileConfig.upstashToken || process.env.UPSTASH_REDIS_REST_TOKEN,
    stateKey: fileConfig.stateKey || process.env.STATE_KEY || defaultStateKey,
    githubRepo: fileConfig.githubRepo || process.env.GITHUB_REPO || defaultRepo
  };
}

async function saveConfig(config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function loadMonitorState(config) {
  if (!config.upstashUrl || !config.upstashToken) {
    return { state: null, error: "Faltan credenciales locales de Upstash. Cargalas en Configuracion." };
  }
  try {
    const result = await upstashCommand(config, ["GET", config.stateKey || defaultStateKey]);
    return { state: result ? JSON.parse(result) : { seen: {}, pages: {}, runs: [] }, error: null };
  } catch (error) {
    return { state: null, error: error.message };
  }
}

async function loadDashboardState(config) {
  if (config.upstashUrl && config.upstashToken) {
    return loadMonitorState(config);
  }

  const repo = config.githubRepo || defaultRepo;
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/main/data/dashboard-status.json`, {
      headers: { "user-agent": "barcelona-rental-dashboard" }
    });
    if (!response.ok) {
      throw new Error(`GitHub status devolvio ${response.status}`);
    }
    const status = await response.json();
    return {
      state: {
        runs: status.runs || [],
        sourceStats: status.sourceStats || {},
        alertLog: status.alertLog || [],
        seen: Object.fromEntries(Array.from({ length: status.seenCount || 0 }, (_, index) => [`seen-${index}`, true])),
        pages: Object.fromEntries(Array.from({ length: status.pageCount || 0 }, (_, index) => [`page-${index}`, true]))
      },
      error: null
    };
  } catch (error) {
    return {
      state: null,
      error: "Todavía no hay estado publicado en GitHub. El próximo run lo va a generar."
    };
  }
}

async function upstashCommand(config, command) {
  const response = await fetch(config.upstashUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.upstashToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error || `Upstash devolvio ${response.status}`);
  }
  return body.result;
}

async function loadGithubRuns(repo) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=12`, {
      headers: { "user-agent": "barcelona-rental-dashboard" }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `GitHub devolvio ${response.status}`);
    return {
      runs: body.workflow_runs.map((run) => ({
        id: run.id,
        name: run.name,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        url: run.html_url
      })),
      error: null
    };
  } catch (error) {
    return { runs: [], error: error.message };
  }
}

async function sendFile(response, filePath, contentType) {
  const content = await fs.readFile(filePath);
  response.writeHead(200, { "content-type": contentType });
  response.end(content);
}

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
