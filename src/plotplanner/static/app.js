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
  $(`.steps button[data-step="${step}"]`).disabled = false;
  $$(".steps button").forEach((b) => b.classList.toggle("active", b.dataset.step === step));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== step));
  if (step === "plot") enterPlot();
  else if (step === "prepare" && state.original) {
    if (state.layout) showLayout();
    else {
      render(state.current);
      previewLayout();
    }
  } else if (step === "load" && state.original) render(state.original);
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
  Object.assign(state, { original: text, current: text, prepared: false, optimized: false, fileName: name, layers: [], plotId: null, completed: 0, layout: null });
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

function paperValue() {
  const f = $("#optimize-form");
  if (f.paper.value === "source") return null;
  if (f.paper.value === "custom") return `${Number(f.paper_w.value) || 0}x${Number(f.paper_h.value) || 0}mm`;
  return f.paper.value;
}

function optimizeOptions() {
  const f = $("#optimize-form");
  return {
    paper: paperValue(),
    orientation: f.orientation.value,
    layers_from: f.layers_from.value,
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

// Layout preview: the sheet at the chosen size with the drawing placed on it, exactly as it will
// plot. Changing a layout field re-runs only vpype's layout (quick); Optimize adds the sorting.
const PX_PER_MM = 96 / 25.4;
const LAYOUT_FIELDS = ["paper", "paper_w", "paper_h", "orientation", "margin", "fit", "layers_from"];

function showLayout() {
  render(state.current);
  const result = state.layout;
  const svg = $("svg", canvas);
  if (!result?.page_mm || !svg) return;
  const opts = result.options;
  if (opts.paper && opts.fit && opts.margin > 0) {
    const [w, h] = result.page_mm;
    const m = opts.margin;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [k, v] of Object.entries({ x: m, y: m, width: w - 2 * m, height: h - 2 * m })) rect.setAttribute(k, v * PX_PER_MM);
    rect.setAttribute("class", "guide");
    svg.append(rect);
  }
  layoutInfo();
}

function fmtMm([w, h]) {
  return `${Math.round(w)} × ${Math.round(h)} mm`;
}

function layoutInfo() {
  const result = state.layout;
  if (!result?.page_mm) {
    $("#layout-info").hidden = $("#layout-warnings").hidden = true;
    return;
  }
  const [pw, ph] = result.page_mm;
  const orientation = pw > ph ? "landscape" : pw < ph ? "portrait" : "square";
  const paperName = result.options.paper ? $("#paper").selectedOptions[0].textContent.replace("…", "") : "Source page";
  const rows = [["Paper", `${paperName} ${orientation} · ${fmtMm(result.page_mm)}`]];
  if (result.bounds_mm) rows.push(["Drawing", fmtMm(result.bounds_mm.slice(2))]);
  kv($("#layout-info"), rows);

  const warnings = [];
  const b = result.bounds_mm;
  if (b && (b[0] < -0.5 || b[1] < -0.5 || b[0] + b[2] > pw + 0.5 || b[1] + b[3] > ph + 0.5)) {
    warnings.push("The drawing runs off the paper; anything outside the sheet is clipped.");
  }
  const settings = state.status?.settings ?? state.info?.settings ?? {};
  const reach = state.info?.machine_travel_mm?.[settings.model];
  if (reach) {
    // Portrait pages are plotted rotated onto the long axis when auto-rotate is on.
    const plotted = settings.auto_rotate && ph > pw ? [ph, pw] : [pw, ph];
    if (plotted[0] > reach[0] + 0.5 || plotted[1] > reach[1] + 0.5) {
      warnings.push(`This paper is bigger than the plotter reaches (${fmtMm(reach)}, the Machine size setting). ` +
        "Drawing beyond that from the home corner is clipped.");
    }
  }
  const list = $("#layout-warnings");
  list.replaceChildren(...warnings.map((w) => Object.assign(document.createElement("li"), { textContent: w })));
  list.hidden = !warnings.length;
}

let layoutTimer;
let layoutRequest = 0;

function previewLayout() {
  clearTimeout(layoutTimer);
  if (!state.original || !state.online) return;
  layoutTimer = setTimeout(async () => {
    const request = ++layoutRequest;
    const options = { ...optimizeOptions(), merge: false, sort: false, reloop: false, simplify: false };
    canvas.classList.add("updating");
    try {
      const result = await api("/optimize", { method: "POST", body: { svg: state.original, options } });
      if (request !== layoutRequest) return; // a newer change is on its way
      applyPrepared(result, false);
      state.layout = { ...result, options };
      $("#optimize-stats").hidden = true;
      if (state.step === "prepare") showLayout();
    } catch (err) {
      if (request === layoutRequest) toast(err.message, true);
    } finally {
      if (request === layoutRequest) canvas.classList.remove("updating");
      updateControls();
    }
  }, 300);
}

$("#optimize-form").addEventListener("input", (e) => {
  if (e.target.name === "paper") $("#custom-size").hidden = e.target.value !== "custom";
  if (LAYOUT_FIELDS.includes(e.target.name)) previewLayout();
});

$("#optimize-form").addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(layoutTimer);
  layoutRequest++;
  const button = $("#optimize-button");
  button.textContent = "Optimizing…";
  guarded(async () => {
    const options = optimizeOptions();
    const result = await api("/optimize", { method: "POST", body: { svg: state.original, options } });
    applyPrepared(result, true);
    state.layout = { ...result, options };
    showLayout();
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
  $("#optimize-stats").hidden = true;
  Object.assign(state, { optimized: false });
  previewLayout(); // back to the plain layout, unsorted
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
  updateControls();
});

$("#plot-button").addEventListener("click", (e) =>
  guarded(async () => {
    const layer = $("#layer").value;
    const s = await api("/plot", {
      method: "POST",
      body: {
        svg: state.current,
        layer: layer ? Number(layer) : null,
        pen_changes: $("#pen-changes").checked,
        settings: readSettings(),
      },
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

// Fill the form from the server. Skips the control being edited, so another client's (or the
// server's) values never yank a slider out from under you.
function fillSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    const input = settingsForm.elements[key];
    if (!input || input === document.activeElement) continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (String(input.value) !== String(value)) input.value = value;
    else continue;
    input.dispatchEvent(new Event("input"));
  }
}

function settingValue(input) {
  return input.type === "checkbox" ? input.checked : input.type === "text" ? input.value : Number(input.value);
}

function readSettings() {
  const out = {};
  for (const input of settingsForm.elements) if (input.name) out[input.name] = settingValue(input);
  return out;
}

$$('input[type="range"]', settingsForm).forEach((input) => {
  const output = input.parentElement.querySelector("output");
  input.addEventListener("input", () => (output.textContent = input.value));
});

// Every control applies when you let go of it; during a plot the server hands speed and pen
// changes to the plot thread, which applies them from the next move.
settingsForm.addEventListener("change", (e) => {
  const input = e.target;
  if (!input.name) return;
  guarded(async () => {
    try {
      const settings = await api("/settings", { method: "POST", body: { [input.name]: settingValue(input) } });
      fillSettings(settings);
      if (state.status) state.status.settings = settings;
      layoutInfo(); // the reach warning depends on machine size and auto-rotate
      const label = input.closest("label").textContent.replace(/\s+/g, " ").trim();
      if (state.status?.state === "plotting") toast(`Applied: ${label}`);
    } catch (err) {
      input.blur();
      if (state.status?.settings) fillSettings(state.status.settings);
      throw err;
    }
  });
});
settingsForm.addEventListener("submit", (e) => e.preventDefault());

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
  if (s.settings) fillSettings(s.settings);
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
  const penChange = $("#pen-change");
  penChange.hidden = !(s.state === "paused" && s.pen_change);
  if (!penChange.hidden) {
    const [id, ...name] = s.pen_change.split(" ");
    const title = Object.assign(document.createElement("strong"), { textContent: "Pen change" });
    penChange.replaceChildren(title, `Put in the pen for layer ${id}${name.length ? ` (${name.join(" ")})` : ""}, then Resume.`);
  }
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
  $("#pen-changes").disabled = busy || state.layers.length < 2 || Boolean($("#layer").value);
  for (const b of $$("[data-manual]")) {
    b.disabled = !state.online || !(s === "idle" || (s === "paused" && b.dataset.manual !== "disable_xy"));
  }
  const live = new Set(state.info?.live_settings ?? []);
  for (const input of settingsForm.elements) {
    if (input.name) input.disabled = !state.online || (busy && !live.has(input.name));
  }
  $("#settings-reset").disabled = busy || !state.online;
  $("#settings-hint").textContent = busy
    ? "Speed and pen changes apply from the next move. Machine size, resolution, rotation and port are locked until the plot ends."
    : "Changes are saved on the server as you make them.";
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
    new Option("Custom…", "custom"),
    new Option("Keep source page", "source"),
  );
  paper.value = selected;
  fillSettings(state.info.settings);
  poll();
}

connect();
