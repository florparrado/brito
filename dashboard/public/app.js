const refreshButton = document.querySelector("#refresh");
const configForm = document.querySelector("#config-form");
const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
});

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
  selectTab("panel");
});

loadDashboard();
setInterval(loadDashboard, 60_000);

function selectTab(name) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  views.forEach((view) => view.classList.toggle("active", view.id === `${name}-view`));
}

async function loadDashboard() {
  const response = await fetch("/api/summary");
  const data = await response.json();
  document.querySelector("#last-refresh").textContent = `Actualizado ${formatDate(data.generatedAt)}`;

  const state = data.state || {};
  const lastRun = state.runs?.[0];
  setText("#checked-sources", lastRun?.checkedSources ?? "-");
  setText("#successful-sources", lastRun?.successfulSources ?? "-");
  setText("#partial-sources", lastRun?.partialSources ?? "-");
  setText("#failed-sources", lastRun?.failedSources ?? "-");
  setText("#new-alerts", lastRun?.newAlerts ?? "-");

  renderQuickSummary(lastRun, state);
  renderRecentActivity(lastRun, state.sourceStats || {});
  renderLastRun(lastRun, data.stateError);
  renderGithub(data.github || [], data.githubError);
  renderSources(state.sourceStats || {});
  renderErrors(lastRun?.errors || [], data.stateError);
  renderHistory(state.runs || []);
}

function renderQuickSummary(run, state) {
  const seenCount = Object.keys(state.seen || {}).length;
  const sourceCount = Object.keys(state.sourceStats || {}).length;
  const values = run
    ? {
        "Última pasada": formatDate(run.finishedAt),
        "URLs revisadas": `${run.successfulUrls}/${run.attemptedUrls} exitosas`,
        "Fuentes con historial": sourceCount,
        "Anuncios recordados": seenCount
      }
    : { Estado: "Sin historial todavía" };
  document.querySelector("#quick-summary").innerHTML = detailRows(values);
}

function renderRecentActivity(run, sourceStats) {
  const target = document.querySelector("#recent-activity");
  const reports = run?.sourceReports?.length
    ? run.sourceReports
    : Object.values(sourceStats).map((source) => ({
        name: source.name,
        type: source.type,
        zone: source.zone,
        status: source.lastStatus,
        checkedAt: source.lastCheckedAt,
        newAlerts: source.lastNewAlerts,
        errors: source.lastError ? [source.lastError] : []
      }));

  target.innerHTML = reports
    .slice(0, 12)
    .map((source) => activityItem(source))
    .join("") || `<div class="empty">Sin actividad reciente.</div>`;
}

function activityItem(source) {
  const status = source.status || "partial";
  const error = source.errors?.[0] || "";
  return `
    <article class="activity-item ${escapeHtml(status)}">
      <div>
        <strong>${escapeHtml(source.name)}</strong>
        <span>${escapeHtml(source.zone || "")} · ${formatDate(source.checkedAt)}</span>
      </div>
      <div class="activity-meta">
        <span class="badge ${escapeHtml(status)}">${labelForStatus(status)}</span>
        <span>${source.newAlerts || 0} alertas</span>
      </div>
      ${error ? `<p>${escapeHtml(error)}</p>` : ""}
    </article>
  `;
}

function renderLastRun(run, error) {
  const target = document.querySelector("#last-run");
  if (error) {
    target.innerHTML = detailRows({ Estado: "Configurar Upstash", Error: error });
    return;
  }
  if (!run) {
    target.innerHTML = detailRows({ Estado: "Sin historial todavía" });
    return;
  }
  target.innerHTML = detailRows({
    Inicio: formatDate(run.startedAt),
    Fin: formatDate(run.finishedAt),
    Fuentes: `${run.successfulSources} ok · ${run.partialSources} parciales · ${run.failedSources} fallidas`,
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
  target.innerHTML = runs.slice(0, 6).map((run) => {
    const status = run.conclusion || run.status;
    return item(
      run.name,
      `${formatDate(run.createdAt)} · ${run.event} · <a href="${run.url}" target="_blank" rel="noreferrer">abrir</a>`,
      status
    );
  }).join("") || item("Sin runs", "Todavía no hay ejecuciones.", "partial");
}

function renderSources(sourceStats) {
  const target = document.querySelector("#sources");
  const rows = Object.values(sourceStats)
    .sort((a, b) => statusWeight(a.lastStatus) - statusWeight(b.lastStatus) || a.name.localeCompare(b.name))
    .map((source) => `
      <tr>
        <td><strong>${escapeHtml(source.name)}</strong><br><span class="muted">${escapeHtml(source.type || "")}</span></td>
        <td><span class="badge ${escapeHtml(source.lastStatus || "partial")}">${labelForStatus(source.lastStatus)}</span></td>
        <td>${escapeHtml(source.zone || "")}</td>
        <td>${source.totalNewAlerts || 0}</td>
        <td>${escapeHtml(source.lastError || "")}</td>
      </tr>
    `);
  target.innerHTML = rows.join("") || `<tr><td colspan="5">Sin datos de fuentes todavía.</td></tr>`;
}

function renderErrors(errors, stateError) {
  const target = document.querySelector("#errors");
  if (stateError) {
    target.innerHTML = item("Pendiente", stateError, "partial");
    return;
  }
  target.innerHTML = errors.slice(0, 12).map((error) => item("Error", escapeHtml(error), "failed")).join("") ||
    item("Sin errores en el último run", "Buen signo.", "success");
}

function renderHistory(runs) {
  const target = document.querySelector("#history");
  target.innerHTML = runs.slice(0, 12).map((run) => item(
    `${formatDate(run.finishedAt)} · ${run.newAlerts} alertas`,
    `${run.successfulSources} ok · ${run.partialSources} parciales · ${run.failedSources} fallidas`,
    run.failedSources ? "partial" : "success"
  )).join("") || item("Sin historial", "El próximo run guardará datos.", "partial");
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
    timeStyle: "short"
  }).format(new Date(value));
}

function statusWeight(status) {
  return { failed: 0, partial: 1, success: 2 }[status] ?? 3;
}

function labelForStatus(status) {
  return { success: "ok", partial: "parcial", failed: "falló", failure: "falló", queued: "cola", in_progress: "corriendo" }[status] || "sin datos";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
