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

const AS_IS = { paper: null, fit: false, merge: false, sort: false, reloop: false, simplify: false };
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
  const scroll = [canvas.scrollLeft, canvas.scrollTop];
  canvas.replaceChildren(document.importNode(svg, true));
  canvas.classList.remove("empty");
  canvas.classList.toggle("tracking", tracking);
  canvas.classList.toggle("pen", !tracking); // Prepare/Load show true pen width; Plot shows progress
  state.currentEl = null;
  $("#viewbar").hidden = false;
  for (const id of ["#ruler-x", "#ruler-y", "#ruler-unit"]) $(id).hidden = false;
  $(".stage").classList.add("rulers");
  view.apply();
  [canvas.scrollLeft, canvas.scrollTop] = scroll; // keep your place when the layout preview refreshes
  return svg;
}

// ------------------------------------------------------------------ viewer

// Length attribute -> millimetres. Unitless and px are CSS pixels (96 per inch).
const MM_PER = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25, px: 25.4 / 96, "": 25.4 / 96 };
function lengthMm(value) {
  const m = /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(value || "");
  return m && m[2].toLowerCase() in MM_PER ? Number(m[1]) * MM_PER[m[2].toLowerCase()] : null;
}

const DEFAULT_PX_PER_MM = 96 / 25.4; // what browsers assume; real screens differ, hence calibration

const view = {
  mode: "fit", // "fit" follows the window; "zoom" holds `scale`
  scale: 1, // screen px per mm of paper
  pxPerMm: Number(store.get("pp.pxPerMm", DEFAULT_PX_PER_MM)) || DEFAULT_PX_PER_MM, // 1:1 on this screen

  // Paper size in mm, read once from the file's own width/height (apply() overwrites those
  // attributes with screen pixels).
  page(svg) {
    if (!svg.dataset.mmW) {
      const [, , vw, vh] = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
      svg.dataset.mmW = lengthMm(svg.getAttribute("width")) ?? vw * MM_PER.px;
      svg.dataset.mmH = lengthMm(svg.getAttribute("height")) ?? vh * MM_PER.px;
      svg.dataset.unitsPerMm = vw / svg.dataset.mmW;
    }
    return { w: Number(svg.dataset.mmW), h: Number(svg.dataset.mmH), unitsPerMm: Number(svg.dataset.unitsPerMm) };
  },

  fitScale(page) {
    const box = canvas.getBoundingClientRect();
    return Math.max(0.05, Math.min((box.width - 48) / page.w, (box.height - 48) / page.h));
  },

  apply() {
    const svg = $("svg", canvas);
    if (!svg) return;
    const page = this.page(svg);
    if (this.mode === "fit") this.scale = this.fitScale(page);
    svg.setAttribute("width", Math.max(1, Math.round(page.w * this.scale)));
    svg.setAttribute("height", Math.max(1, Math.round(page.h * this.scale)));
    svg.style.setProperty("--pen", `${penWidth() * this.scale}px`);
    $("#zoom-label").textContent = `${Math.round((100 * this.scale) / this.pxPerMm)}%`;
    drawOverlay(svg, page);
    requestAnimationFrame(drawRulers);
    $$("[data-zoom]").forEach((b) => b.classList.toggle("active",
      (b.dataset.zoom === "fit" && this.mode === "fit") ||
      (b.dataset.zoom === "actual" && this.mode === "zoom" && Math.abs(this.scale - this.pxPerMm) < 1e-6)));
  },

  // Zoom to `scale`, keeping the paper point under (clientX, clientY) where it is.
  zoomTo(scale, clientX, clientY) {
    const svg = $("svg", canvas);
    if (!svg) return;
    const box = canvas.getBoundingClientRect();
    clientX ??= box.left + box.width / 2;
    clientY ??= box.top + box.height / 2;
    const before = svg.getBoundingClientRect();
    const fx = (clientX - before.left) / before.width;
    const fy = (clientY - before.top) / before.height;
    this.mode = "zoom";
    this.scale = Math.min(Math.max(scale, this.pxPerMm * 0.05), this.pxPerMm * 16);
    this.apply();
    const after = svg.getBoundingClientRect();
    canvas.scrollLeft += after.left + fx * after.width - clientX;
    canvas.scrollTop += after.top + fy * after.height - clientY;
  },

  fit() {
    this.mode = "fit";
    this.apply();
  },
};

new ResizeObserver(() => view.mode === "fit" && view.apply()).observe(canvas);

$$("[data-zoom]").forEach((button) => button.addEventListener("click", () => {
  const z = button.dataset.zoom;
  if (z === "fit") view.fit();
  else if (z === "actual") view.zoomTo(view.pxPerMm);
  else view.zoomTo(view.scale * (z === "in" ? 1.25 : 0.8));
}));

// Pinch (reported as ctrl+wheel) or Cmd/Ctrl+scroll zooms around the pointer; plain scroll pans.
canvas.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey) || !$("svg", canvas)) return;
  e.preventDefault();
  view.zoomTo(view.scale * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
}, { passive: false });

// Click and drag to pan.
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !$("svg", canvas)) return;
  drag = { x: e.clientX, y: e.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("dragging");
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  canvas.scrollLeft = drag.left - (e.clientX - drag.x);
  canvas.scrollTop = drag.top - (e.clientY - drag.y);
});
for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, () => {
    drag = null;
    canvas.classList.remove("dragging");
  });
}

window.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea, dialog") || e.metaKey || e.ctrlKey || !$("svg", canvas)) return;
  if (e.key === "f" || e.key === "0") view.fit();
  else if (e.key === "1") view.zoomTo(view.pxPerMm);
  else if (e.key === "+" || e.key === "=") view.zoomTo(view.scale * 1.25);
  else if (e.key === "-") view.zoomTo(view.scale * 0.8);
  else return;
  e.preventDefault();
});

// Rulers, like an image editor's: zero is the sheet's top-left corner, which is where the pen
// starts. They follow zoom and scroll; the drawing's extent is shaded once its layout is known.
const RULER_STEPS = {
  mm: { perMm: 1, steps: [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500] },
  in: { perMm: 1 / 25.4, steps: [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10, 20] },
};
let rulerUnit = store.get("pp.rulerUnit", "mm") === "in" ? "in" : "mm";
$("#ruler-unit").textContent = rulerUnit;
$("#ruler-unit").addEventListener("click", () => {
  rulerUnit = rulerUnit === "mm" ? "in" : "mm";
  store.set("pp.rulerUnit", rulerUnit);
  $("#ruler-unit").textContent = rulerUnit;
  drawRulers();
});

function fmtRuler(value) {
  if (rulerUnit === "mm" || Number.isInteger(value)) return String(Math.round(value * 100) / 100);
  return String(Math.round(value * 1000) / 1000).replace(/^0\./, ".");
}

function drawRuler(el, horizontal, originPx, extent) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = el.getBoundingClientRect();
  el.width = Math.round(width * dpr);
  el.height = Math.round(height * dpr);
  const ctx = el.getContext("2d");
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const length = horizontal ? width : height;
  const thick = horizontal ? height : width;
  const { perMm, steps } = RULER_STEPS[rulerUnit];
  const pxPerUnit = view.scale / perMm;
  const label = steps.find((s) => s * pxPerUnit >= 48) ?? steps.at(-1);
  const minor = steps.find((s) => s * pxPerUnit >= 6 && s <= label) ?? label;

  if (extent) { // the drawing, shaded
    ctx.fillStyle = "rgb(57 168 201 / 0.18)";
    const a = originPx + extent[0] * view.scale;
    const b = a + extent[1] * view.scale;
    horizontal ? ctx.fillRect(a, 0, b - a, thick) : ctx.fillRect(0, a, thick, b - a);
  }
  ctx.strokeStyle = css.getPropertyValue("--muted").trim();
  ctx.fillStyle = css.getPropertyValue("--muted").trim();
  ctx.font = "9px system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const first = Math.floor(-originPx / pxPerUnit / minor) * minor;
  for (let v = first; v * pxPerUnit + originPx <= length; v += minor) {
    const p = Math.round(originPx + v * pxPerUnit) + 0.5;
    const isLabel = Math.abs(v / label - Math.round(v / label)) < 1e-6;
    const isHalf = Math.abs((2 * v) / label - Math.round((2 * v) / label)) < 1e-6;
    const tick = isLabel ? thick : isHalf ? thick * 0.5 : thick * 0.28;
    if (horizontal) { ctx.moveTo(p, thick); ctx.lineTo(p, thick - tick); }
    else { ctx.moveTo(thick, p); ctx.lineTo(thick - tick, p); }
    if (isLabel) {
      const text = fmtRuler(v);
      if (horizontal) ctx.fillText(text, p + 3, 9);
      else { ctx.save(); ctx.translate(9, p + 3); ctx.rotate(Math.PI / 2); ctx.fillText(text, 0, 0); ctx.restore(); }
    }
  }
  ctx.stroke();
}

function drawRulers() {
  const svg = $("svg", canvas);
  if (!svg || $("#ruler-x").hidden) return;
  const r = svg.getBoundingClientRect();
  const x = $("#ruler-x").getBoundingClientRect();
  const y = $("#ruler-y").getBoundingClientRect();
  const l = state.step === "prepare" ? state.layout : null;
  const b = l && (l.options?.reference === "page" && l.box_mm ? l.box_mm : l.bounds_mm);
  drawRuler($("#ruler-x"), true, r.left - x.left, b && [b[0], b[2]]);
  drawRuler($("#ruler-y"), false, r.top - y.top, b && [b[1], b[3]]);
}

canvas.addEventListener("scroll", () => requestAnimationFrame(drawRulers));
window.addEventListener("resize", () => requestAnimationFrame(drawRulers));

// Size overlay: a dashed outline of a common size from the sheet's corner.
const overlaySelect = $("#overlay");
overlaySelect.value = store.get("pp.overlay", "");
overlaySelect.addEventListener("change", () => {
  store.set("pp.overlay", overlaySelect.value);
  view.apply();
});

function drawOverlay(svg, page) {
  svg.querySelectorAll(".overlay, .overlay-label").forEach((el) => el.remove());
  if (!overlaySelect.value) return;
  const [w, h] = overlaySelect.value.split("x").map(Number);
  const u = page.unitsPerMm;
  const NS = "http://www.w3.org/2000/svg";
  const rect = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w * u, height: h * u })) rect.setAttribute(k, v);
  rect.setAttribute("class", "overlay");
  const text = document.createElementNS(NS, "text");
  text.setAttribute("class", "overlay-label");
  text.setAttribute("x", (w - 2) * u);
  text.setAttribute("y", (h - 2) * u);
  text.setAttribute("text-anchor", "end");
  text.setAttribute("font-size", 3.5 * u);
  text.textContent = overlaySelect.selectedOptions[0].textContent;
  svg.append(rect, text);
}

// Calibration: size a bank card outline to match a real one; that gives this screen's px per mm.
const CARD_MM = [85.6, 53.98];
const calibrateDialog = $("#calibrate-dialog");
const calibrateRange = $("#calibrate-range");

function drawCalibrationCard() {
  const v = Number(calibrateRange.value);
  Object.assign($("#calibrate-card").style, {
    width: `${CARD_MM[0] * v}px`,
    height: `${CARD_MM[1] * v}px`,
    borderRadius: `${3.18 * v}px`,
  });
}

calibrateRange.addEventListener("input", drawCalibrationCard);
$("#calibrate-button").addEventListener("click", () => {
  calibrateRange.value = view.pxPerMm;
  drawCalibrationCard();
  calibrateDialog.showModal();
});
calibrateDialog.addEventListener("close", () => {
  const value = calibrateDialog.returnValue;
  if (value !== "save" && value !== "reset") return;
  const old = view.pxPerMm;
  view.pxPerMm = value === "reset" ? DEFAULT_PX_PER_MM : Number(calibrateRange.value);
  store.set("pp.pxPerMm", view.pxPerMm);
  if (view.mode === "zoom") view.scale *= view.pxPerMm / old; // stay at the same percentage
  view.apply();
});

// Pen width (mm): drawn at that width in the preview, and the "auto" merge gap.
function penWidth() {
  return Math.min(Math.max(Number($("#optimize-form").pen_width.value) || 0.35, 0.05), 3);
}

{
  const input = $("#optimize-form").pen_width;
  input.value = store.get("pp.penWidth", input.value);
  input.addEventListener("input", () => {
    store.set("pp.penWidth", input.value);
    syncPenPreset();
    view.apply();
  });
  // A preset just fills in the width; any other width shows as Custom.
  $("#pen-preset").addEventListener("change", (e) => {
    if (!e.target.value) return input.focus();
    input.value = e.target.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function syncPenPreset() {
  const width = Number($("#optimize-form").pen_width.value);
  const preset = [...$("#pen-preset").options].find((o) => o.value && Math.abs(Number(o.value) - width) < 1e-6);
  $("#pen-preset").value = preset ? preset.value : "";
}

function describe(svgText) {
  const svg = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
  const count = svg.querySelectorAll("path, line, polyline, polygon, rect, circle, ellipse").length;
  const layers = $$("g", svg)
    .filter((g) => g.getAttributeNS(INKSCAPE, "groupmode") === "layer")
    .map((g) => g.getAttributeNS(INKSCAPE, "label") || g.id);
  const physical = /\d\s*(mm|cm|in|pt|pc|q)\s*$/i.test(svg.getAttribute("width") || "");
  const pageMm = [lengthMm(svg.getAttribute("width")), lengthMm(svg.getAttribute("height"))];
  return { width: svg.getAttribute("width") || "–", height: svg.getAttribute("height") || "–", count, layers, physical,
    pageMm: pageMm.every(Boolean) ? pageMm : null };
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
  // A file with a real size (mm, cm, in, ...) is already laid out: keep it as it is. Unitless
  // (pixel) files have no size to keep, so they default to the paper presets.
  const paper = $("#paper");
  paper.value = d.physical ? "source" : savedPaper() ?? state.info?.optimize_defaults.paper ?? "a3";
  // A file with a real size plots at that size; a unitless one has no size to keep, so it is
  // scaled to the margins instead.
  $("#optimize-form").fit.checked = !d.physical;
  if (!d.physical) $("#optimize-form").size_mode.value = "width";
  // A file with a real size was designed on its page (a card with its padding, say): size and place
  // by that page. A unitless file's page means nothing, so use its lines.
  state.docPageMm = d.pageMm;
  const reference = $("#optimize-form").reference;
  reference.value = d.physical ? "page" : "lines";
  reference.options[0].textContent = d.physical
    ? `The file's page (${d.width} × ${d.height})` : "The file's page";
  showMode();
  $("#custom-size").hidden = paper.value !== "custom";
  $("#layout-info").hidden = $("#layout-warnings").hidden = true; // the new file's layout is on its way
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

function prepareMode() {
  return $("#optimize-form").mode.value;
}

// The machine's reach for the Machine size setting; Quick plot uses it as the sheet, so nothing is
// rotated or clipped beyond what the plotter can draw.
function machineReach() {
  const settings = state.status?.settings ?? state.info?.settings ?? {};
  const model = state.info?.machine_travel_mm?.[settings.model] ?? [430, 297];
  return [settings.reach_x || model[0], settings.reach_y || model[1]];
}

function overridePlaceholders() {
  const f = settingsForm.elements;
  const model = state.info?.machine_travel_mm?.[f.model.value] ?? [];
  f.reach_x.placeholder = model[0] ? `${model[0]} (machine size)` : "machine size";
  f.reach_y.placeholder = model[1] ? `${model[1]} (machine size)` : "machine size";
  f.steps_per_inch.placeholder = `${state.info?.default_steps_per_inch ?? ""} (driver)`;
}

function placementOptions() {
  const f = $("#optimize-form");
  if (prepareMode() === "quick") {
    const [w, h] = machineReach();
    return {
      paper: `${w}x${h}mm`,
      orientation: "landscape",
      margin: Number(f.quick_offset.value) || 0,
      fit: false,
      position: "top-left",
      width: f.size_mode.value === "width" ? Number(f.quick_width.value) || null : null,
    };
  }
  return {
    paper: paperValue(),
    orientation: f.orientation.value,
    margin: Number(f.margin.value) || 0,
    fit: f.fit.checked,
    position: f.position.value,
    width: null,
  };
}

function optimizeOptions() {
  const f = $("#optimize-form");
  return {
    ...placementOptions(),
    reference: f.reference.value,
    layers_from: f.layers_from.value,
    merge: f.merge.checked,
    sort: f.sort.checked,
    two_opt: f.two_opt.checked,
    reloop: f.reloop.checked,
    simplify: f.simplify.checked,
    merge_tolerance: Number(f.merge_tolerance.value),
    simplify_tolerance: Number(f.simplify_tolerance.value),
    min_length: Number(f.min_length.value),
  };
}

// Advanced optimize sliders: start at the server's defaults ("auto"), tweakable, Auto resets them.
const ADVANCED = ["merge_tolerance", "simplify_tolerance", "min_length"];

// "Auto" for the merge gap is the pen width: gaps narrower than the line don't show.
function autoValue(name) {
  return name === "merge_tolerance" ? Math.round(penWidth() * 100) / 100 : Number(state.info?.optimize_defaults[name]);
}

function showAdvancedValue(input) {
  const auto = Math.abs(Number(input.value) - autoValue(input.name)) < 0.026;
  input.dataset.auto = auto ? "1" : "";
  const value = Number(input.value) === 0 ? "off" : `${Number(input.value)} mm`;
  const note = input.name === "merge_tolerance" ? " (auto: pen width)" : " (auto)";
  input.parentElement.querySelector("output").textContent = auto ? `${value}${note}` : value;
}

function resetAdvanced() {
  const f = $("#optimize-form");
  for (const name of ADVANCED) {
    f[name].value = autoValue(name);
    showAdvancedValue(f[name]);
  }
}

for (const name of ADVANCED) {
  const input = $("#optimize-form")[name];
  input.addEventListener("input", () => showAdvancedValue(input));
  // Once optimized, re-run on release so the line count follows the slider.
  input.addEventListener("change", () => state.optimized && $("#optimize-form").requestSubmit());
}

{
  // A new pen width moves an "auto" merge gap along with it.
  const f = $("#optimize-form");
  f.pen_width.addEventListener("input", () => {
    if (f.merge_tolerance.dataset.auto) f.merge_tolerance.value = autoValue("merge_tolerance");
    showAdvancedValue(f.merge_tolerance);
  });
  f.pen_width.addEventListener("change", () => {
    if (state.optimized && f.merge_tolerance.dataset.auto) f.requestSubmit();
  });
}

$("#advanced-auto").addEventListener("click", () => {
  resetAdvanced();
  saveOptimize();
  if (state.optimized) $("#optimize-form").requestSubmit();
});

function applyPrepared(result, optimized) {
  Object.assign(state, { current: result.svg, prepared: true, optimized, layers: result.layers });
  $("#layer-list").replaceChildren(...result.layers.map((layer) => {
    const label = Object.assign(document.createElement("label"), { className: "check" });
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: true, value: layer.id });
    label.append(box, `${layer.id}${layer.name ? ` – ${layer.name}` : ""}`);
    return label;
  }));
  $("#layer-pick").hidden = result.layers.length < 2;
  layerSummary();
}

const layerBoxes = () => $$("#layer-list input");

// The ticked layers, or null when that is all of them.
function selectedLayers() {
  const boxes = layerBoxes();
  const ticked = boxes.filter((b) => b.checked).map((b) => Number(b.value));
  return ticked.length === boxes.length ? null : ticked;
}

function layerSummary() {
  const chosen = selectedLayers();
  const total = layerBoxes().length;
  $("#layer-summary").textContent = !chosen ? `All ${total} layers`
    : !chosen.length ? "No layers ticked" : `${chosen.length} of ${total} layers`;
}

// Layout preview: the sheet at the chosen size with the drawing placed on it, exactly as it will
// plot. Changing a layout field re-runs only vpype's layout (quick); Optimize adds the sorting.
const PX_PER_MM = 96 / 25.4;
const LAYOUT_FIELDS = ["mode", "reference", "size_mode", "quick_width", "quick_offset",
  "paper", "paper_w", "paper_h", "orientation", "margin", "fit", "position", "layers_from"];

function showMode() {
  const f = $("#optimize-form");
  $$("[data-mode]", f).forEach((el) => (el.hidden = el.dataset.mode !== prepareMode()));
  $("[data-size=width]", f).hidden = f.size_mode.value !== "width";
}

{
  const f = $("#optimize-form");
  const saved = store.get("pp.mode", "quick");
  for (const radio of f.mode) radio.checked = radio.value === saved;
  showMode();
  f.addEventListener("change", (e) => {
    if (e.target.name === "mode") store.set("pp.mode", prepareMode());
    if (e.target.name === "size_mode" && f.size_mode.value === "width") {
      // Start from the current width of whatever sizing is measured by.
      const width = f.reference.value === "page" && state.docPageMm ? state.docPageMm[0] : state.layout?.bounds_mm?.[2];
      if (width) f.quick_width.value = Math.round(width);
    }
    if (e.target.name === "mode" || e.target.name === "size_mode") showMode();
  });
}

function showLayout() {
  render(state.current);
  const result = state.layout;
  const svg = $("svg", canvas);
  if (!result?.page_mm || !svg) return;
  const opts = result.options;
  // When sizing by the file's page, outline where that page (the card) lands.
  if (opts.reference === "page" && result.box_mm) {
    const [x, y, w, h] = result.box_mm;
    const card = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [k, v] of Object.entries({ x, y, width: w, height: h })) card.setAttribute(k, v * PX_PER_MM);
    card.setAttribute("class", "guide card");
    svg.append(card);
  }
  // Margin guide wherever the margin matters: scaling to fit, or anchoring to an edge.
  if (prepareMode() === "layout" && opts.margin > 0 && (opts.fit || !["keep", "center"].includes(opts.position))) {
    const [w, h] = result.page_mm;
    const m = opts.margin;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [k, v] of Object.entries({ x: m, y: m, width: w - 2 * m, height: h - 2 * m })) rect.setAttribute(k, v * PX_PER_MM);
    rect.setAttribute("class", "guide");
    svg.append(rect);
  }
  layoutInfo();
  drawRulers();
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
  const paperName = prepareMode() === "quick" ? "Plotter reach"
    : result.options.paper ? $("#paper").selectedOptions[0].textContent.replace("…", "") : "Source page";
  const rows = [["Paper", `${paperName} ${orientation} · ${fmtMm(result.page_mm)}`]];
  if (result.options.reference === "page" && result.box_mm) {
    const [x, y, w, h] = result.box_mm;
    rows.push(["Page", `${fmtMm([w, h])} at ${Math.round(x)}, ${Math.round(y)} mm`]);
  }
  if (result.bounds_mm) rows.push(["Drawing size", fmtMm(result.bounds_mm.slice(2))]);
  kv($("#layout-info"), rows);

  const warnings = [];
  const b = result.bounds_mm;
  if (b && (b[0] < -0.5 || b[1] < -0.5 || b[0] + b[2] > pw + 0.5 || b[1] + b[3] > ph + 0.5)) {
    warnings.push("The drawing runs off the paper; anything outside the sheet is clipped.");
  }
  const settings = state.status?.settings ?? state.info?.settings ?? {};
  const reach = state.info?.machine_travel_mm?.[settings.model];
  if (reach && b) {
    // How far from the home corner the pen has to go. Portrait pages are plotted rotated onto
    // the long axis when auto-rotate is on: machine x = page y, machine y = page width - page x.
    const far = settings.auto_rotate && ph > pw ? [b[1] + b[3], pw - b[0]] : [b[0] + b[2], b[1] + b[3]];
    if (far[0] > reach[0] + 0.5 || far[1] > reach[1] + 0.5) {
      warnings.push(`The drawing goes past what the plotter reaches (${fmtMm(reach)} from the home corner, ` +
        "the Machine size setting). The part beyond that is clipped.");
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
      showStats(result, false);
      if (state.step === "prepare") showLayout();
    } catch (err) {
      if (request === layoutRequest) toast(err.message, true);
    } finally {
      if (request === layoutRequest) canvas.classList.remove("updating");
      updateControls();
    }
  }, 300);
}

{
  const position = $("#optimize-form").position;
  position.value = store.get("pp.position", "keep");
  if (!position.value) position.value = "keep";
  position.addEventListener("change", () => store.set("pp.position", position.value));
}

// Every Prepare setting is remembered in this browser. Loading a file still picks what that file
// needs (its own page when it has a real size, scale to fit when it has none).
const OPTIMIZE_KEY = "pp.optimize";

function savedOptimize() {
  try {
    return JSON.parse(store.get(OPTIMIZE_KEY, "null")) || {};
  } catch {
    return {};
  }
}

function saveOptimize() {
  const f = $("#optimize-form");
  const out = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === "radio") {
      if (el.checked) out[el.name] = el.value;
    } else out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  for (const name of ADVANCED) if (f[name].dataset.auto) out[name] = "auto";
  store.set(OPTIMIZE_KEY, JSON.stringify(out));
}

// The saved paper, when it is a choice for a file without a size of its own.
function savedPaper() {
  const paper = savedOptimize().paper;
  return paper && paper !== "source" && [...$("#paper").options].some((o) => o.value === paper) ? paper : null;
}

// names: which fields to restore (all but the paper and the advanced sliders, which need the server's
// paper list and defaults first).
function restoreOptimize(names) {
  const f = $("#optimize-form");
  const saved = savedOptimize();
  for (const name of names) {
    if (!(name in saved)) continue;
    const field = f.elements[name];
    if (!field) continue;
    if (field instanceof RadioNodeList) {
      for (const radio of field) radio.checked = radio.value === saved[name];
    } else if (field.type === "checkbox") field.checked = Boolean(saved[name]);
    else if (ADVANCED.includes(name)) {
      if (saved[name] !== "auto") field.value = saved[name];
      showAdvancedValue(field);
    } else field.value = saved[name];
  }
}

{
  const f = $("#optimize-form");
  const later = ["paper", ...ADVANCED];
  restoreOptimize(Object.keys(savedOptimize()).filter((name) => !later.includes(name)));
  showMode();
  syncPenPreset();
  // Only what you change is saved (not what loading a file picks for it).
  for (const type of ["input", "change"]) {
    f.addEventListener(type, (e) => e.isTrusted && e.target.name && saveOptimize());
  }
  $("#pen-preset").addEventListener("change", saveOptimize);
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
  const request = layoutRequest;
  guarded(async () => {
    const options = optimizeOptions();
    // Always from the file as loaded, never from an earlier result.
    const result = await api("/optimize", { method: "POST", body: { svg: state.original, options } });
    if (request !== layoutRequest) return; // a newer optimize or layout change is on its way
    applyPrepared(result, true);
    state.layout = { ...result, options };
    showLayout();
    showStats(result, true);
  }, button).finally(() => {
    if (request === layoutRequest) button.textContent = "Optimize";
  });
});

// Line counts for the drawing as loaded (laid out, nothing merged or sorted), and once
// optimized, what optimizing made of it.
function showStats(result, optimized) {
  const { before: b, after: a } = result;
  const change = (from, to) => {
    const pct = from ? Math.round((100 * (from - to)) / from) : 0;
    return pct ? ` (${pct > 0 ? "−" : "+"}${Math.abs(pct)}%)` : "";
  };
  kv($("#optimize-stats"), optimized ? [
    ["Lines (pen lifts)", `${b.paths} → ${a.paths}${change(b.paths, a.paths)}`],
    ["Pen-up travel", `${b.travel_mm} → ${a.travel_mm} mm${change(b.travel_mm, a.travel_mm)}`],
    ["Pen-down length", `${(a.draw_mm / 1000).toFixed(1)} m`],
    ["Layers", result.layers.map((l) => l.name || l.id).join(", ")],
  ] : [
    ["Lines (pen lifts)", `${b.paths} (not optimized)`],
    ["Pen-up travel", `${b.travel_mm} mm`],
    ["Pen-down length", `${(b.draw_mm / 1000).toFixed(1)} m`],
    ["Layers", result.layers.map((l) => l.name || l.id).join(", ")],
  ]);
}

$("#revert-button").addEventListener("click", () => {
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
  markSkippedLayers(selectedLayers());
  showProgress(state.status);
}

async function showServerDocument() {
  const doc = await api("/document");
  if (!doc.svg) return;
  render(doc.svg, { tracking: true });
  markSkippedLayers(doc.layers ?? (doc.layer ? [doc.layer] : null));
  state.completed = 0;
}

// layers: the layers being plotted (null for all); the rest are dimmed.
function markSkippedLayers(layers) {
  if (!layers) return;
  const keep = new Set(layers.map(Number));
  for (const g of $$("svg > g", canvas)) {
    const label = g.getAttributeNS(INKSCAPE, "label") || "";
    if (!keep.has(parseInt(label, 10))) $$("[id^='pp_']", g).forEach((el) => el.classList.add("skipped"));
  }
}

function layersChanged() {
  layerSummary();
  if (state.step === "plot" && (!state.status || state.status.state === "idle") && state.current) {
    render(state.current, { tracking: true });
    markSkippedLayers(selectedLayers());
    showProgress(state.status);
  }
  updateControls();
}

$("#layer-list").addEventListener("change", layersChanged);
$$("[data-layers]").forEach((button) => button.addEventListener("click", () => {
  for (const box of layerBoxes()) box.checked = button.dataset.layers === "all";
  layersChanged();
}));

$("#plot-button").addEventListener("click", (e) =>
  guarded(async () => {
    const layers = selectedLayers();
    const s = await api("/plot", {
      method: "POST",
      body: {
        svg: state.current,
        ...(layers ? { layers } : {}),
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

$("#home-button").addEventListener("click", (e) =>
  guarded(async () => {
    await api("/home", { method: "POST" });
    poll();
  }, e.currentTarget),
);

// ------------------------------------------------------------------ drive and calibrate

async function drive(body, button) {
  return guarded(async () => applyStatus(await api("/jog", { method: "POST", body })), button);
}

$$("[data-jog]").forEach((button) => button.addEventListener("click", () => {
  const [sx, sy] = button.dataset.jog.split(",").map(Number);
  const step = Number($("#jog-step").value);
  drive({ dx: sx * step, dy: sy * step }, button);
}));
$("#jog-back").addEventListener("click", (e) =>
  guarded(async () => {
    await api("/jog", { method: "POST", body: { action: "back" } });
    poll(); // while paused this goes home in the background; follow it
  }, e.currentTarget),
);
$("#jog-set").addEventListener("click", (e) => drive({ action: "set_start" }, e.currentTarget));

$("#jog-reach").addEventListener("click", (e) => {
  const at = state.status?.jog;
  if (!at || !(at[0] > 0 && at[1] > 0)) return toast("Drive to the far corner first (both X and Y away from the start).", true);
  if (!confirm(`Save ${at[0]} × ${at[1]} mm as the furthest the plotter can reach?`)) return;
  guarded(async () => {
    fillSettings(await api("/settings", { method: "POST", body: { reach_x: at[0], reach_y: at[1] } }));
    toast(`Reach set to ${at[0]} × ${at[1]} mm.`);
    if (prepareMode() === "quick") previewLayout();
  }, e.currentTarget);
});

$("#scale-draw").addEventListener("click", (e) =>
  guarded(async () => {
    await api("/manual", { method: "POST", body: { command: "lower_pen" } });
    await api("/jog", { method: "POST", body: { dx: 100, dy: 0 } });
    await api("/manual", { method: "POST", body: { command: "raise_pen" } });
    toast("Drew a 100 mm line. Measure it and enter the length.");
    poll();
  }, e.currentTarget),
);

$("#scale-apply").addEventListener("click", (e) => {
  const measured = Number($("#scale-measured").value);
  if (!(measured > 10)) return toast("Enter the measured length of the 100 mm line, in mm.", true);
  const settings = state.status?.settings ?? state.info.settings;
  const current = settings.steps_per_inch || state.info.default_steps_per_inch;
  const corrected = Math.round(((current * 100) / measured) * 10) / 10;
  guarded(async () => {
    fillSettings(await api("/settings", { method: "POST", body: { steps_per_inch: corrected } }));
    $("#scale-info").textContent = `Steps per inch ${current} → ${corrected}. Draw another line to check.`;
  }, e.currentTarget);
});

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
      applyStatus(result.status); // e.g. motors off: the position becomes unknown
    }, button),
  ),
);

// ------------------------------------------------------------------ settings

const settingsForm = $("#settings-form");

// Fill the form from the server. Skips the control being edited, so another client's (or the
// server's) values never yank a slider out from under you.
// Pen positions are shown as heights (higher number, higher pen). On the iDraw the servo works the
// other way round (a lower position number is a higher pen), so those two are mirrored.
const PEN_FIELDS = ["pen_pos_up", "pen_pos_down"];
const OVERRIDES = ["reach_x", "reach_y", "steps_per_inch"];

function penHeight(name, value) {
  return PEN_FIELDS.includes(name) && state.info?.pen_reversed ? 100 - value : value;
}

// Plotter settings are remembered in this browser too, and handed back to the server on connect,
// so they survive a server restart (or a server without --settings-file). The port belongs to
// the server's computer, so that one stays on the server.
const SETTINGS_KEY = "pp.settings";
let settingsRestored = false; // until then, the server's values aren't this browser's to save

async function restoreSettings() {
  let settings = state.info.settings;
  let saved = null;
  try {
    saved = JSON.parse(store.get(SETTINGS_KEY, "null"));
  } catch { /* corrupt: ignore */ }
  if (saved && typeof saved === "object") {
    const changed = Object.fromEntries(Object.entries(saved).filter(([k, v]) => k !== "port" && k in settings && settings[k] !== v));
    try {
      if (Object.keys(changed).length) {
        const status = await api("/status");
        if (status.state !== "idle") {
          // Mid-plot: only the settings that may change during a plot.
          const live = new Set(state.info.live_settings ?? []);
          for (const k of Object.keys(changed)) if (!live.has(k)) delete changed[k];
        }
        if (Object.keys(changed).length) settings = await api("/settings", { method: "POST", body: changed });
      }
    } catch (err) {
      toast(`Couldn't restore saved plotter settings: ${err.message}`, true);
    }
  }
  settingsRestored = true;
  fillSettings(settings);
}

function fillSettings(settings) {
  if (settingsRestored) store.set(SETTINGS_KEY, JSON.stringify(settings));
  for (const [key, raw] of Object.entries(settings)) {
    const input = settingsForm.elements[key];
    if (!input || input === document.activeElement) continue;
    // Calibration overrides of 0 mean "use the default": show them blank, with the default as placeholder.
    const value = OVERRIDES.includes(key) && !raw ? "" : penHeight(key, raw);
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (String(input.value) !== String(value)) input.value = value;
    else continue;
    input.dispatchEvent(new Event("input"));
  }
  penWarning();
}

function settingValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "text") return input.value;
  return penHeight(input.name, Number(input.value)); // mirrored back for the plotter
}

function penWarning() {
  const f = settingsForm.elements;
  $("#pen-warning").hidden = Number(f.pen_pos_up.value) > Number(f.pen_pos_down.value);
}

function readSettings() {
  const out = {};
  for (const input of settingsForm.elements) if (input.name) out[input.name] = settingValue(input);
  return out;
}

$$('input[type="range"]', settingsForm).forEach((input) => {
  const output = input.parentElement.querySelector("output");
  input.addEventListener("input", () => {
    output.textContent = input.value;
    if (PEN_FIELDS.includes(input.name)) penWarning();
  });
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
      overridePlaceholders();
      if (["reach_x", "reach_y"].includes(input.name) && prepareMode() === "quick") previewLayout();
      if (input.name === "model" && prepareMode() === "quick") previewLayout(); // the sheet is the reach
      const label = input.closest("label").textContent.replace(/\s+/g, " ").trim();
      const s = state.status?.state ?? "idle";
      if (s === "plotting") toast(`Applied: ${label}`);
      // Idle or paused: move the pen to the height just set, so it can be dialled in by eye.
      if (PEN_FIELDS.includes(input.name) && (s === "idle" || s === "paused")) {
        await api("/manual", { method: "POST", body: { command: input.name === "pen_pos_up" ? "raise_pen" : "lower_pen" } });
      }
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

// ------------------------------------------------------------------ tips

// An "i" after a setting's name: hover for the explanation, click (or tap) to keep it open below.
const TIPS = {
  // Prepare
  reference: "What gets sized and placed. The file's page moves the whole page (blank padding and all), " +
    "so the drawing keeps its place on it. The lines only uses the outline of the drawing itself.",
  size_mode: "As drawn keeps the size in the file. Set width scales it to the width you give, keeping its proportions.",
  quick_width: "How wide the page or the lines (whichever you size by) end up, in mm.",
  quick_offset: "Gap from the plotter's start corner to the drawing, on both the top and left edges.",
  paper: "The sheet you're plotting on. Keep source page uses the page size in the file.",
  orientation: "Follow the drawing turns the sheet to match the drawing's shape. Follow the source page matches the file's page.",
  position: "Where the drawing sits on the sheet. As placed in the file keeps its position from the file.",
  margin: "Space kept clear around the edge of the sheet when scaling to fit or placing against an edge.",
  fit: "Scale the drawing up or down to fill the sheet inside the margins.",
  layers_from: "How the drawing splits into layers, one per pen. Top-level groups uses the file's groups " +
    "(Inkscape layers). Stroke colour makes one layer per colour.",
  "#pen-preset": "Fills in the width for a pen you use. Pick Custom to type any width.",
  pen_width: "Your pen's line width. The preview draws lines this wide, and the Auto merge gap follows it.",
  merge: "Joins lines whose ends meet (within the merge gap) into one, so the pen draws them without lifting.",
  sort: "Reorders the lines so the pen travels less in the air between them. Usually the biggest time saver.",
  two_opt: "Another pass that untangles the travel route. A little less travel, but much slower on big drawings.",
  reloop: "Closed shapes (circles, outlines) can start anywhere. This picks start points that the sort can " +
    "link up with less travel.",
  simplify: "Removes points that barely change a line (within the simplify tolerance), so the plotter makes " +
    "fewer, smoother moves.",
  merge_tolerance: "Line ends closer than this get joined. Auto uses your pen width, because gaps narrower " +
    "than the line don't show.",
  simplify_tolerance: "How far a simplified line may move from the original. Keep it well under the pen width.",
  min_length: "Drops lines shorter than this: specks and dots that cost a pen lift each but barely show.",
  // Plot
  "#pen-changes": "When plotting all layers, pause before each new layer so you can swap pens, then Resume.",
  // Plotter settings
  pen_pos_up: "How high the pen lifts for travel. Just enough to clear the paper is fastest.",
  pen_pos_down: "How far the pen drops to draw. Lower presses harder.",
  speed_pendown: "How fast the pen moves while drawing. Slower gives cleaner lines with wet or fine pens.",
  speed_penup: "How fast the pen moves between lines with the pen up.",
  accel: "How quickly it speeds up and slows down. Lower is smoother on a wobbly machine; higher is faster.",
  pen_rate_lower: "How fast the pen drops. Slower stops it bouncing on the paper.",
  pen_rate_raise: "How fast the pen lifts.",
  pen_delay_down: "Extra wait after the pen drops before it moves, so the ink starts flowing.",
  pen_delay_up: "Extra wait after the pen lifts before it moves, so it doesn't drag.",
  model: "Which machine you have. It sets how far the plotter can reach (unless you set Reach below).",
  reach_x: "How far the plotter can travel left to right from the start corner. Blank uses the machine size.",
  reach_y: "How far the plotter can travel top to bottom from the start corner. Blank uses the machine size.",
  steps_per_inch: "Motor steps per inch of travel. Correct it with Check scale if a 100 mm line comes out a different length.",
  resolution: "High is smoother and more precise. Low moves faster.",
  const_speed: "Draw at one steady speed instead of speeding up on straight runs. Can look more even with some pens.",
  auto_rotate: "Plot portrait pages turned sideways, so they run along the plotter's longer axis.",
  port: "The plotter's serial port. Blank uses the first plotter found.",
};

for (const [key, text] of Object.entries(TIPS)) {
  const field = key.startsWith("#") ? $(key) : $(`.panel [name="${key}"]`);
  const label = field?.closest("label");
  if (!label) continue;
  const button = Object.assign(document.createElement("button"), {
    type: "button", className: "tip", textContent: "i", title: text,
  });
  button.setAttribute("aria-label", "About this setting");
  button.setAttribute("aria-expanded", "false");
  if (label.classList.contains("check")) label.append(button);
  else {
    // Keep the name and its button on one line above the control.
    const textNode = [...label.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    const head = Object.assign(document.createElement("span"), { className: "label-head" });
    label.insertBefore(head, textNode);
    head.append(textNode.textContent.trim(), button);
    textNode.remove();
  }
  const note = Object.assign(document.createElement("p"), { className: "hint tip-text", textContent: text, hidden: true });
  if (label.parentElement.classList.contains("pair")) label.append(note);
  else label.after(note);
  button.addEventListener("click", (e) => {
    e.preventDefault();
    note.hidden = !note.hidden;
    button.setAttribute("aria-expanded", String(!note.hidden));
  });
}

// ------------------------------------------------------------------ status

function fmtTime(seconds) {
  if (seconds == null || !isFinite(seconds)) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

function layerLabel(id, name) {
  return id == null ? "Ungrouped" : `Layer ${id}${name ? ` – ${name}` : ""}`;
}

// Progress by work (drawn length plus a per-path overhead), so a few long lines and many short
// ones both estimate fairly. The rate comes from the whole plot so far, paused time left out.
// What the progress shows before this page's drawing has been plotted: nothing done yet, out of
// the paths that will plot (the server's last plot was of something else).
function notPlotted() {
  const chosen = selectedLayers();
  const paths = $$("[id^='pp_']:not(.skipped)", canvas).length;
  return {
    state: "idle", paths_total: paths, paths_done: 0, work_total: 0, work_done: 0, elapsed: null,
    layers: chosen, layer_names: Object.fromEntries(state.layers.map((l) => [l.id, l.name])), layer_progress: null,
  };
}

function showProgress(s) {
  if (!s) return;
  if (s.state === "idle" && (state.plotId === null || s.plot_id !== state.plotId)) s = notPlotted();
  const running = s.state === "plotting" || s.state === "paused";
  const rate = s.work_done > 0 ? s.elapsed / s.work_done : null;
  const row = (prefix, p, elapsed) => {
    const fraction = p.work_total ? p.work_done / p.work_total : p.paths_total ? p.paths_done / p.paths_total : 0;
    $(`#${prefix}-bar`).style.width = `${100 * fraction}%`;
    $(`#${prefix}-pct`).textContent = p.paths_total ? `${Math.floor(100 * fraction)}%` : "";
    $(`#${prefix}-count`).textContent = `${p.paths_done || 0} / ${p.paths_total || 0} paths`;
    let time = elapsed != null ? fmtTime(elapsed) : "";
    if (running && rate && p.work_done < p.work_total) time += ` · ~${fmtTime(rate * (p.work_total - p.work_done))} left`;
    $(`#${prefix}-time`).textContent = time;
  };
  const chosen = s.layers ?? (s.layer != null ? [s.layer] : null);
  $("#progress-name").textContent = !chosen ? "Whole plot"
    : chosen.length === 1 ? layerLabel(chosen[0], s.layer_names?.[chosen[0]]) : `Layers ${chosen.join(", ")}`;
  row("progress", s, s.elapsed);
  const lp = s.layer_progress;
  $("#layer-progress").hidden = !(lp && s.layers_total > 1);
  if (!$("#layer-progress").hidden) {
    $("#layer-name").textContent = `${layerLabel(lp.id, lp.name)} · ${lp.number} of ${s.layers_total}`;
    row("layer", lp, lp.elapsed);
  }
}

function applyStatus(s) {
  state.status = s;
  if (s.settings) fillSettings(s.settings);
  showProgress(s);
  const label = $("#plot-state");
  label.textContent = s.preview ? `${s.state} (preview)` : s.state;
  label.className = `state ${s.state}`;
  const jog = s.jog;
  $("#drive-pos").textContent = !jog ? "Position unknown (motors were off): move it to the start and Set start here"
    : jog[0] || jog[1] ? `X ${jog[0]} mm, Y ${jog[1]} mm from the start corner` : "At the start corner";
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
  $("#stop-button").disabled = !(s === "plotting" || s === "paused" || s === "homing");
  $("#home-button").disabled = s !== "paused";
  const canDrive = state.online && s === "idle";
  $$("#drive button, #jog-step, #scale-measured").forEach((el) => (el.disabled = !canDrive));
  if (canDrive && !state.status?.jog) $("#jog-back").disabled = true;
  // Paused: Back to start is Home (resume data kept); jogging would lose the resume position.
  if (state.online && s === "paused") $("#jog-back").disabled = false;
  $("#drive-paused").hidden = s !== "paused";
  const chosen = selectedLayers();
  const count = chosen ? chosen.length : state.layers.length;
  $$("#layer-pick input, #layer-pick button").forEach((el) => (el.disabled = busy));
  if (!count) $("#plot-button").disabled = true;
  $("#pen-changes").disabled = busy || count < 2;
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
    : "Changes are saved on the server and in this browser as you make them.";
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
  pollTimer = setTimeout(poll, s === "plotting" || s === "stopping" || s === "homing" ? 1000 : 3000);
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
  const selected = paper.value;
  paper.replaceChildren(
    ...state.info.paper_sizes.map((p) => new Option(p.toUpperCase(), p)),
    new Option("Custom…", "custom"),
    new Option("Keep source page", "source"),
  );
  paper.value = selected || savedPaper() || state.info.optimize_defaults.paper;
  $("#custom-size").hidden = paper.value !== "custom";
  await restoreSettings();
  overridePlaceholders();
  resetAdvanced();
  restoreOptimize(ADVANCED);
  poll();
}

connect();
