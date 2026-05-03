import fs from "node:fs/promises";
import path from "node:path";

const stateKey = process.env.STATE_KEY || "barcelona-rental-monitor:state";
const outputPath = process.env.DASHBOARD_STATUS_FILE || "data/dashboard-status.json";

const state = await loadUpstashState();
const payload = sanitizeState(state);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Dashboard status exported to ${outputPath}`);

async function loadUpstashState() {
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
    body: JSON.stringify(["GET", stateKey])
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error || `Upstash devolvio ${response.status}`);
  }
  return body.result ? JSON.parse(body.result) : {};
}

function sanitizeState(state) {
  const runs = (state.runs || []).slice(0, 80).map((run) => ({
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    checkedSources: run.checkedSources,
    successfulSources: run.successfulSources,
    partialSources: run.partialSources,
    failedSources: run.failedSources,
    attemptedUrls: run.attemptedUrls,
    successfulUrls: run.successfulUrls,
    failedUrls: run.failedUrls,
    newAlerts: run.newAlerts,
    errors: run.errors || [],
    sourceReports: (run.sourceReports || []).map((report) => ({
      name: report.name,
      type: report.type,
      zone: report.zone,
      status: report.status,
      checkedAt: report.checkedAt,
      attemptedUrls: report.attemptedUrls,
      successfulUrls: report.successfulUrls,
      failedUrls: report.failedUrls,
      candidatesFound: report.candidatesFound,
      newAlerts: report.newAlerts,
      errors: report.errors || []
    }))
  }));

  return {
    generatedAt: new Date().toISOString(),
    source: "github-actions",
    seenCount: Object.keys(state.seen || {}).length,
    pageCount: Object.keys(state.pages || {}).length,
    sourceStats: state.sourceStats || {},
    alertLog: (state.alertLog || []).slice(0, 80),
    runs
  };
}
