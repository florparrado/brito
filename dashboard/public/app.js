const refreshButton = document.querySelector("#refresh");
const setupPanel = document.querySelector("#setup");
const configForm = document.querySelector("#config-form");

refreshButton.addEventListener("click", loadDashboard);
configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(configForm);
  await fetch("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.fromEntries(form.entries()))
  });
  await loadDashboard();
});

loadDashboard();
setInterval(loadDashboard, 60_000);

async function loadDashboard() {
  const response = await fetch("/api/summary");
  const data = await response.json();
  document.querySelector("#last-refresh").textContent = `Actualizado ${formatDate(data.generatedAt)}`;
  setupPanel.classList.toggle("hidden", data.config?.hasUpstash);

  const state = data.state || {};
  const lastRun = state.runs?.[0];
  setText("#checked-sources", lastRun?.checkedSources ?? "-");
  setText("#successful-sources", lastRun?.successfulSources ?? "-");
  setText("#partial-sources", lastRun?.partialSources ?? "-");
  setText("#failed-sources", lastRun?.failedSources ?? "-");
  setText("#new-alerts", lastRun?.newAlerts ?? "-");

  renderLastRun(lastRun, data.stateError);
  renderGithub(data.github || [], data.githubError);
  renderSources(state.sourceStats || {});
  renderErrors(lastRun?.errors || [], data.stateError);
  renderHistory(state.runs || []);
}

function renderLastRun(run, error) {
  const target = document.querySelector("#last-run");
  if (error) {
    target.innerHTML = detailRows({ Estado: "Configurar Upstash", Error: error });
    return;
  }
  if (!run) {
    target.innerHTML = detailRows({ Estado: "Sin historial todavia" });
    return;
  }
  target.innerHTML = detailRows({
    Inicio: formatDate(run.startedAt),
    Fin: formatDate(run.finishedAt),
    URLs: `${run.successfulUrls}/${run.attemptedUrls} exitosas`,
    Alertas: run.newAlerts,
    Errores: run.errors?.length || 0
  });
}

function renderGithub(runs, error) {
  const target = document.querySelector("#github-runs");
  if (error) {
    target.innerHTML = item("No pude leer GitHub Actions", error, "failed");
    return;
  }
  target.innerHTML = runs.slice(0, 5).map((run) => {
    const status = run.conclusion || run.status;
    return item(
      run.name,
      `${formatDate(run.createdAt)} · ${run.event} · <a href="${run.url}" target="_blank" rel="noreferrer">abrir</a>`,
      status
    );
  }).join("") || item("Sin runs", "Todavia no hay ejecuciones.", "partial");
}

function renderSources(sourceStats) {
  const target = document.querySelector("#sources");
  const rows = Object.values(sourceStats)
    .sort((a, b) => statusWeight(a.lastStatus) - statusWeight(b.lastStatus) || a.name.localeCompare(b.name))
    .map((source) => `
      <tr>
        <td><strong>${escapeHtml(source.name)}</strong><br><span class="muted">${escapeHtml(source.type || "")}</span></td>
        <td><span class="badge ${escapeHtml(source.lastStatus || "partial")}">${escapeHtml(source.lastStatus || "sin datos")}</span></td>
        <td>${escapeHtml(source.zone || "")}</td>
        <td>${source.totalNewAlerts || 0}</td>
        <td>${escapeHtml(source.lastError || "")}</td>
      </tr>
    `);
  target.innerHTML = rows.join("") || `<tr><td colspan="5">Sin datos de fuentes todavia.</td></tr>`;
}

function renderErrors(errors, stateError) {
  const target = document.querySelector("#errors");
  if (stateError) {
    target.innerHTML = item("Pendiente", stateError, "partial");
    return;
  }
  target.innerHTML = errors.slice(0, 12).map((error) => item("Error", escapeHtml(error), "failed")).join("") ||
    item("Sin errores en el ultimo run", "Buen signo.", "success");
}

function renderHistory(runs) {
  const target = document.querySelector("#history");
  target.innerHTML = runs.slice(0, 10).map((run) => item(
    `${formatDate(run.finishedAt)} · ${run.newAlerts} alertas`,
    `${run.successfulSources} ok · ${run.partialSources} parciales · ${run.failedSources} fallidas`,
    run.failedSources ? "partial" : "success"
  )).join("") || item("Sin historial", "El proximo run guardara datos.", "partial");
}

function detailRows(values) {
  return Object.entries(values).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`).join("");
}

function item(title, body, status) {
  return `<div class="item"><strong><span class="badge ${escapeHtml(status || "partial")}">${escapeHtml(title || "")}</span></strong><span>${body || ""}</span></div>`;
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function statusWeight(status) {
  return { failed: 0, partial: 1, success: 2 }[status] ?? 3;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
