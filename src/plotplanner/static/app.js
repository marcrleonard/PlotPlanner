// PlotPlanner control page. Plain ES module, no build step; talks to the server's /api.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

const AS_IS = { paper: null, merge: false, sort: false, reloop: false, simplify: false };
const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";

const state = {
  server: store.get("pp.server", location.protocol.startsWith("http") ? location.origin : "http://localhost:5001"),
  token: store.get("pp.token", ""),
  info: null,
  online: false,
  fileName: "drawing.svg",
  original: null, // SVG text as loaded
  current: null, // SVG text that will be plotted
  prepared: false, // current carries pp_ ids from the server
  optimized: false,
  layers: [],
  step: "load",
  status: null,
  plotId: null, // plot whose document is on screen
  completed: 0, // completed path ids already applied to the drawing
  currentEl: null,
};

// ------------------------------------------------------------------ api

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${state.server.replace(/\/+$/, "")}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), isError ? 6000 : 3000);
}

async function guarded(fn, button) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (button) button.disabled = false;
    updateControls();
  }
}

// ------------------------------------------------------------------ drawing

const canvas = $("#canvas");

function render(svgText, { tracking = false } = {}) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName !== "svg" || doc.querySelector("parsererror")) throw new Error("That file is not a valid SVG.");

  if (!svg.getAttribute("viewBox")) {
    const w = parseFloat(svg.getAttribute("width")) || 1000;
    const h = parseFloat(svg.getAttribute("height")) || 1000;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  canvas.replaceChildren(document.importNode(svg, true));
  canvas.classList.remove("empty");
  canvas.classList.toggle("tracking", tracking);
  state.currentEl = null;
  fitDrawing();
  return svg;
}

function fitDrawing() {
  const svg = $("svg", canvas);
  if (!svg) return;
  const [, , vw, vh] = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
  const box = canvas.getBoundingClientRect();
  const maxH = Math.min(box.height || Infinity, window.innerHeight - 120);
  const scale = Math.min(box.width / vw, maxH / vh);
  svg.setAttribute("width", Math.max(1, Math.floor(vw * scale)));
  svg.setAttribute("height", Math.max(1, Math.floor(vh * scale)));
}

new ResizeObserver(fitDrawing).observe(canvas);

function describe(svgText) {
  const svg = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
  const count = svg.querySelectorAll("path, line, polyline, polygon, rect, circle, ellipse").length;
  const layers = $$("g", svg)
    .filter((g) => g.getAttributeNS(INKSCAPE, "groupmode") === "layer")
    .map((g) => g.getAttributeNS(INKSCAPE, "label") || g.id);
  return { width: svg.getAttribute("width") || "–", height: svg.getAttribute("height") || "–", count, layers };
}

function kv(el, rows) {
  el.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    return [dt, dd];
  }));
  el.hidden = false;
}

// ------------------------------------------------------------------ steps

function showStep(step) {
  state.step = step;
  $$(".steps button").forEach((b) => b.classList.toggle("active", b.dataset.step === step));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== step));
  if (step === "plot") enterPlot();
  else if (state.current) render(state.current);
  updateControls();
}

$$(".steps button").forEach((b) => b.addEventListener("click", () => showStep(b.dataset.step)));
$("#to-prepare").addEventListener("click", () => showStep("prepare"));
$("#to-plot").addEventListener("click", () => showStep("plot"));

// ------------------------------------------------------------------ load

function loadText(text, name) {
  try {
    render(text);
  } catch (err) {
    toast(err.message, true);
    return;
  }
  Object.assign(state, { original: text, current: text, prepared: false, optimized: false, fileName: name, layers: [], plotId: null, completed: 0 });
  const d = describe(text);
  kv($("#doc-info"), [
    ["File", name],
    ["Size", `${d.width} × ${d.height}`],
    ["Elements", d.count],
    ["Layers", d.layers.length ? d.layers.join(", ") : "none"],
  ]);
  $("#to-prepare").hidden = false;
  $("#optimize-stats").hidden = true;
  $$('.steps button[data-step="prepare"], .steps button[data-step="plot"]').forEach((b) => (b.disabled = false));
  updateControls();
}

function readFile(file) {
  if (!file) return;
  file.text().then((text) => loadText(text, file.name));
}

$("#file").addEventListener("change", (e) => readFile(e.target.files[0]));
const drop = $("#drop");
for (const type of ["dragenter", "dragover"]) {
  window.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
}
for (const type of ["dragleave", "drop"]) window.addEventListener(type, () => drop.classList.remove("over"));
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (state.status && state.status.state !== "idle") return toast("The plotter is busy.", true);
  readFile(e.dataTransfer.files[0]);
  showStep("load");
});

// ------------------------------------------------------------------ prepare

function optimizeOptions() {
  const f = $("#optimize-form");
  const paper = f.paper.value;
  return {
    paper: paper === "source" ? null : paper,
    orientation: f.orientation.value,
    margin: Number(f.margin.value) || 0,
    fit: f.fit.checked,
    merge: f.merge.checked,
    sort: f.sort.checked,
    two_opt: f.two_opt.checked,
    reloop: f.reloop.checked,
    simplify: f.simplify.checked,
  };
}

function applyPrepared(result, optimized) {
  Object.assign(state, { current: result.svg, prepared: true, optimized, layers: result.layers });
  const layerSelect = $("#layer");
  layerSelect.replaceChildren(new Option("All layers", ""));
  for (const layer of result.layers) layerSelect.add(new Option(`${layer.id}${layer.name ? ` – ${layer.name}` : ""}`, layer.id));
  layerSelect.disabled = result.layers.length < 2;
}

$("#optimize-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const button = $("#optimize-button");
  button.textContent = "Optimizing…";
  guarded(async () => {
    const result = await api("/optimize", { method: "POST", body: { svg: state.original, options: optimizeOptions() } });
    applyPrepared(result, true);
    render(state.current);
    const { before: b, after: a } = result;
    const pct = b.travel_mm ? Math.round((100 * (b.travel_mm - a.travel_mm)) / b.travel_mm) : 0;
    kv($("#optimize-stats"), [
      ["Paths", `${b.paths} → ${a.paths}`],
      ["Pen-up travel", `${b.travel_mm} → ${a.travel_mm} mm${pct ? ` (${pct > 0 ? "−" : "+"}${Math.abs(pct)}%)` : ""}`],
      ["Drawing", `${(a.draw_mm / 1000).toFixed(1)} m`],
      ["Layers", result.layers.map((l) => l.name || l.id).join(", ")],
    ]);
  }, button).finally(() => (button.textContent = "Optimize"));
});

$("#revert-button").addEventListener("click", () => {
  Object.assign(state, { current: state.original, prepared: false, optimized: false, layers: [] });
  $("#optimize-stats").hidden = true;
  render(state.current);
  updateControls();
});

$("#download-button").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([state.current], { type: "image/svg+xml" }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: state.fileName.replace(/\.svg$/i, "") + (state.optimized ? "-optimized.svg" : ".svg"),
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ------------------------------------------------------------------ plot

async function enterPlot() {
  const s = state.status;
  if (s && (s.state !== "idle" || s.plot_id === state.plotId) && state.plotId) {
    return showServerDocument();
  }
  if (!state.current) return;
  if (!state.prepared) {
    // Number the paths (server-side, no reordering) so progress can be drawn.
    await guarded(async () => applyPrepared(await api("/optimize", { method: "POST", body: { svg: state.current, options: AS_IS } }), false));
  }
  render(state.current, { tracking: true });
  markSkippedLayers(Number($("#layer").value) || null);
}

async function showServerDocument() {
  const doc = await api("/document");
  if (!doc.svg) return;
  render(doc.svg, { tracking: true });
  markSkippedLayers(doc.layer);
  state.completed = 0;
}

function markSkippedLayers(layer) {
  if (!layer) return;
  for (const g of $$("svg > g", canvas)) {
    const label = g.getAttributeNS(INKSCAPE, "label") || "";
    if (parseInt(label, 10) !== Number(layer)) $$("[id^='pp_']", g).forEach((el) => el.classList.add("skipped"));
  }
}

$("#layer").addEventListener("change", () => {
  if (state.step === "plot" && (!state.status || state.status.state === "idle")) {
    render(state.current, { tracking: true });
    markSkippedLayers(Number($("#layer").value) || null);
  }
});

$("#plot-button").addEventListener("click", (e) =>
  guarded(async () => {
    const layer = $("#layer").value;
    const s = await api("/plot", {
      method: "POST",
      body: { svg: state.current, layer: layer ? Number(layer) : null, settings: readSettings() },
    });
    state.plotId = s.plot_id;
    await showServerDocument();
    poll();
  }, e.currentTarget),
);

$("#pause-button").addEventListener("click", (e) =>
  guarded(async () => {
    await api(state.status?.state === "paused" ? "/resume" : "/pause", { method: "POST" });
    poll();
  }, e.currentTarget),
);

$("#stop-button").addEventListener("click", (e) => {
  if (!confirm("Stop the plot and send the pen home?")) return;
  guarded(async () => {
    await api("/stop", { method: "POST" });
    poll();
  }, e.currentTarget);
});

$$("[data-manual]").forEach((button) =>
  button.addEventListener("click", () =>
    guarded(async () => {
      const result = await api("/manual", { method: "POST", body: { command: button.dataset.manual } });
      if (result.output?.length) toast(result.output.join(" "));
    }, button),
  ),
);

// ------------------------------------------------------------------ settings

const settingsForm = $("#settings-form");

function fillSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    const input = settingsForm.elements[key];
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value;
    input.dispatchEvent(new Event("input"));
  }
}

function readSettings() {
  const out = {};
  for (const input of settingsForm.elements) {
    if (!input.name) continue;
    out[input.name] = input.type === "checkbox" ? input.checked : input.type === "text" ? input.value : Number(input.value);
  }
  return out;
}

$$('input[type="range"]', settingsForm).forEach((input) => {
  const output = input.parentElement.querySelector("output");
  input.addEventListener("input", () => (output.textContent = input.value));
});

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    fillSettings(await api("/settings", { method: "POST", body: readSettings() }));
    toast("Settings saved on the server.");
  });
});

$("#settings-reset").addEventListener("click", () =>
  guarded(async () => fillSettings(await api("/settings", { method: "POST", body: { reset: true } }))),
);

// ------------------------------------------------------------------ status

function fmtTime(seconds) {
  if (seconds == null || !isFinite(seconds)) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

function applyStatus(s) {
  state.status = s;
  const total = s.paths_total || 0;
  const done = s.paths_done || 0;
  $("#progress-bar").style.width = total ? `${(100 * done) / total}%` : "0";
  $("#progress-count").textContent = `${done} / ${total} paths`;
  let time = s.elapsed != null ? fmtTime(s.elapsed) : "";
  if (s.state === "plotting" && done > 0 && done < total) time += ` · ~${fmtTime((s.elapsed / done) * (total - done))} left`;
  $("#progress-time").textContent = time;
  const label = $("#plot-state");
  label.textContent = s.preview ? `${s.state} (preview)` : s.state;
  label.className = `state ${s.state}`;
  $("#messages").replaceChildren(...[...s.messages].reverse().map((m) => Object.assign(document.createElement("li"), { textContent: m })));
  if (s.error) $("#messages").prepend(Object.assign(document.createElement("li"), { textContent: `Error: ${s.error}` }));

  if (state.step !== "plot" || s.plot_id !== state.plotId) return;
  for (const id of s.completed) {
    const el = canvas.querySelector(`#${CSS.escape(id)}`);
    if (el) el.classList.add("done");
  }
  state.completed = s.completed_since + s.completed.length;
  state.currentEl?.classList.remove("current");
  state.currentEl = s.current_path ? canvas.querySelector(`#${CSS.escape(s.current_path)}`) : null;
  state.currentEl?.classList.add("current");
}

function updateControls() {
  const s = state.status?.state ?? "idle";
  const busy = s !== "idle";
  $("#plot-button").disabled = busy || !state.current || !state.online;
  $("#pause-button").disabled = !(s === "plotting" || s === "paused");
  $("#pause-button").textContent = s === "paused" ? "Resume" : "Pause";
  $("#stop-button").disabled = !(s === "plotting" || s === "paused");
  $("#layer").disabled = busy || state.layers.length < 2;
  for (const b of $$("[data-manual]")) {
    b.disabled = !state.online || !(s === "idle" || (s === "paused" && b.dataset.manual !== "disable_xy"));
  }
  $("#optimize-button").disabled = !state.original || !state.online;
  $("#revert-button").disabled = !state.optimized;
  $("#download-button").disabled = !state.current;
}

function setConnection(kind, text) {
  $("#conn-dot").className = `dot ${kind}`;
  $("#conn-label").textContent = text;
}

let pollTimer;
let lastConnectionCheck = 0;

async function poll() {
  clearTimeout(pollTimer);
  try {
    let s = await api(`/status?since=${state.plotId === null ? 0 : state.completed}`);
    if (s.plot_id !== state.plotId && s.state !== "idle") {
      // A plot is running that this page didn't start (another client, or this page was reloaded).
      state.plotId = s.plot_id;
      state.status = s;
      if (state.step !== "plot") showStep("plot");
      else await showServerDocument();
      s = await api("/status?since=0");
    }
    state.online = true;
    applyStatus(s);

    const host = state.server.replace(/^https?:\/\//, "");
    if (s.state !== "idle") {
      setConnection("busy", `${host} · ${s.state}`);
    } else if (Date.now() - lastConnectionCheck > 5000) {
      lastConnectionCheck = Date.now();
      const c = await api("/connection");
      setConnection(c.connected ? "ok" : "warn", c.connected ? `${host} · ${c.ports.join(", ")}` : `${host} · no plotter`);
    }
  } catch (err) {
    state.online = false;
    setConnection("", err.status === 401 ? "Token needed" : "Server unreachable");
  }
  updateControls();
  const s = state.status?.state;
  pollTimer = setTimeout(poll, s === "plotting" || s === "stopping" ? 1000 : 3000);
}

// ------------------------------------------------------------------ server

const dialog = $("#server-dialog");

$("#server-button").addEventListener("click", () => {
  $("#server-url").value = state.server;
  $("#server-token").value = state.token;
  dialog.showModal();
});

dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "save") return;
  state.server = $("#server-url").value.trim();
  state.token = $("#server-token").value;
  store.set("pp.server", state.server);
  store.set("pp.token", state.token);
  connect();
});

async function connect() {
  lastConnectionCheck = 0;
  try {
    state.info = await api("/info");
  } catch (err) {
    state.online = false;
    setConnection("", err.status === 401 ? "Token needed" : "Server unreachable");
    if (err.status === 401 || !location.protocol.startsWith("http") || new URL(state.server).origin !== location.origin) {
      $("#server-url").value = state.server;
      $("#server-token").value = state.token;
      dialog.showModal();
    }
    updateControls();
    pollTimer = setTimeout(connect, 5000);
    return;
  }
  const paper = $("#paper");
  const selected = paper.value || state.info.optimize_defaults.paper;
  paper.replaceChildren(
    ...state.info.paper_sizes.map((p) => new Option(p.toUpperCase(), p)),
    new Option("Keep source page", "source"),
  );
  paper.value = selected;
  fillSettings(state.info.settings);
  poll();
}

connect();
