'use strict';
// ===== UI: application state, worker management, helpers ====================
// The physics core is loaded from the <script type="text/plain" id="core"> block
// both here (for geometry, validation, hashing) and in the Web Worker.

const CORE_SRC = document.getElementById('core').textContent;
const WORKER_SRC = document.getElementById('worker-driver').textContent;
const MATERIALS_DB = JSON.parse(document.getElementById('materials-db').textContent);
// eslint-disable-next-line no-new-func
const CORE = new Function(CORE_SRC + '\nreturn (name) => eval(name);')();
const C = new Proxy({}, { get: (_, name) => CORE(name) });

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  return el;
}
const fmt = (v, d) => (v === null || v === undefined || !isFinite(v)) ? '–' : Number(v).toFixed(d === undefined ? 2 : d);
const fmtE = (v, d) => (v === null || v === undefined || !isFinite(v)) ? '–' : Number(v).toExponential(d === undefined ? 2 : d);
const um = v => fmt(v * 1000, 1);
const gf = v => fmt(v * C.CONST.GF_PER_N, 1);

/** Per-viewer conveniences only (theme, last step); everything else is explicit JSON files. */
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('fcbga.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('fcbga.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

/** Most parallel workers offered: total CPU cores / 1.5, rounded down (at least 1), so the page and the OS keep some headroom. */
const maxWorkers = () => Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 1.5));

const app = {
  cfg: null, results: null, baseline: null, fieldsCache: new Map(), screening: null, submodels: [], sensitivity: null, verification: null,
  step: 1, centerTab: 'floorplan', selectedDie: 0, selectedChiplet: -1, resultsView: 'warpage', selectedT: 25, exaggeration: 5, cutLine: { axis: 'x', pos: 0 },
  job: null, analysisLost: false, analysisLostWhy: null, desktop: null, mesh: null, validation: { errors: [], warnings: [] }, geom: null, dirty: true,
  workers: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, maxWorkers())), nestedWorkers: true,
  decisions: [], showOverlay: 'warpage', cutDirty: true,
  // submodel cross-section view: submodel key (die:ix:iy), stored moment, cut direction and grid-line index, display options
  subSection: { key: null, snap: null, axis: 'x', pos: null, qty: 'vm', focus: 'uf', mesh: false, total: false },
  // cross-section stress view: line {axis, c, a0, a1}, first click while drawing, display options, worker results by temperature and line
  section: null, sectionDraft: null, sectionQty: 'vm', sectionPhase: 'uf', sectionMesh: false, sectionExag: 'fit', sectionRange: 'all', sectionResize: false, sectionCache: new Map(), sectionPending: null,
  colorMap: prefs.get('colorMap', 'rainbow') === 'colorblind' ? 'colorblind' : 'rainbow',  // contour colours: rainbow or colorblind-safe
};

// ---- theme ----
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  prefs.set('theme', t);
  app.theme = t;
  document.dispatchEvent(new Event('themechange'));
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// ---- toasts and modal ----
function toast(text, kind, ms) {
  const el = h('div', { class: 'toast ' + (kind || '') }, text);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms || 5000);
}
function showModal(title, body) {
  $('#modal-title').textContent = title;
  const mb = $('#modal-body'); mb.innerHTML = '';
  if (typeof body === 'string') mb.innerHTML = body; else mb.appendChild(body);
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

// ---- help texts for inputs (Section 4.9) ----
const HELP = {
  sx: 'Substrate outline in x. The BGA field, lid and dies must fit inside it.',
  sy: 'Substrate outline in y.',
  pitch: 'BGA ball pitch. Balls are not modeled; the pitch sets the measuring zone and the JEITA warpage limit.',
  ballH: 'Nominal ball height, used only for the JEITA limit lookup.',
  inset: 'Distance from the substrate edge to the outermost ball centers. Defines the warpage measuring zone.',
  dieSize: 'Die outline. Larger dies increase the mismatch moment and the warpage.',
  dieT: 'Die thickness. Thicker dies stiffen the package and change the warpage sign balance between die and substrate.',
  siModel: 'Anisotropic cubic silicon (default) gives 169 GPa along <110> die edges; isotropic 130 GPa / 0.28 gives the same equal-biaxial modulus.',
  bumpPitch: 'Bump pitch sets the solder area fraction of the homogenized bump layer and the per-bump force scaling.',
  keepout: 'Distance from the die edge to the first bump row center. The keep-out band contains underfill only.',
  ubm: 'Die-side under-bump metallization diameter; defines the top of the truncated-sphere joint.',
  sro: 'Substrate-side solder resist opening diameter; defines the bottom of the joint.',
  dmax: 'Maximum (equatorial) bump diameter. With UBM, SRO and standoff it fixes the joint volume and d_eff.',
  standoff: 'Bump height after chip join. Thinner standoffs raise the bump shear strain for the same mismatch.',
  Wf: 'Underfill fillet width at the substrate surface, measured from the die edge.',
  Hf: 'Fillet height at the die sidewall as a fraction of the die thickness (for a stacked module, of its height above the bumps: base, DDI gap and chiplet).',
  Tuf: 'Effective stress-free temperature of the underfill. Default is the cure temperature; lower it toward Tg to emulate relaxation.',
  Tsub: 'Temperature at which the substrate is assumed stress-free (solder solidus or ABF cure).',
  Tjoin: 'Chip join: solder solidification temperature at which the die and bumps are born stress-free.',
  Tattach: 'Stress-free temperature of the lid or stiffener, TIM and adhesive (cure).',
  lidOuter: 'Lid outer size. The foot ring sits inside this outline.',
  tPlate: 'Lid plate thickness; a thicker plate pulls the package harder as it cools.',
  footW: 'Width of the continuous lid foot ring bonded to the substrate.',
  adhT: 'Adhesive bond line under the foot (or ring). Softer, thicker adhesives decouple the lid.',
  blt: 'TIM1 bond line over the thickest die. Thinner dies get a derived, thicker BLT.',
  ringW: 'Stiffener ring width.',
  stiffT: 'Stiffener thickness.',
  peak: 'Reflow peak temperature of the warpage sweep.',
  reportTemps: 'Temperatures reported in the warpage table (JEITA ED-7306 practice: 25, 150, 220, 260 °C).',
  cycling: 'JESD22-A104 condition used for the solder fatigue screening and the bump submodel.',
  ramp: 'Temperature ramp rate of the cycle.',
  dwell: 'Dwell time at each extreme.',
  cycles: 'Simulated cycles for the submodel; the last cycle is reported as the stabilized one.',
  preset: 'Mesh fidelity. Draft for previews and sensitivity, Standard for normal use, Fine for convergence checks. Every region except the TIM gets at least 1 (Draft), 2 (Standard) or 4 (Fine) element layers through its thickness.',
  snap: 'Grid snap for die dragging.',
  residual: 'Residual Cu ratio of the pattern layer after etching; used in the Voigt / Reuss mixture rules.',
  via: 'Area fraction of Cu vias in the dielectric layer.',
  pth: 'Plated through hole Cu area fraction of the core.',
  kind: 'Plane layers use the Voigt (parallel) rule in-plane; signal layers use the mean of Voigt and Reuss.',
};
function help(key) { const text = key && (HELP[key] || (typeof TIPS !== 'undefined' && TIPS[key])); return text ? h('span', { class: 'help', 'data-tip': text, tabindex: '0', 'aria-label': text }, '?') : null; }

/** Numeric input with hard bounds (error) and plausibility range (warning). */
function numField(label, get, set, opts) {
  opts = opts || {};
  const scale = opts.scale || 1; // display = value * scale
  const inp = h('input', { type: 'number', step: opts.step || 'any', value: fmtInput(get() * scale, opts.digits) });
  const wrap = h('div', { class: 'field' }, h('label', null, label, help(opts.help)), inp, h('span', { class: 'unit' }, opts.unit || ''));
  const check = () => {
    const v = parseFloat(inp.value) / scale;
    wrap.classList.remove('warn', 'err');
    if (!isFinite(v) || (opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)) { wrap.classList.add('err'); inp.setAttribute('data-tip', 'Allowed range: ' + (opts.min !== undefined ? opts.min * scale : '') + ' to ' + (opts.max !== undefined ? opts.max * scale : '')); return false; }
    if ((opts.plo !== undefined && v < opts.plo) || (opts.phi !== undefined && v > opts.phi)) { wrap.classList.add('warn'); inp.setAttribute('data-tip', 'Outside the usual range ' + opts.plo * scale + ' to ' + opts.phi * scale + '; check the value.'); }
    else inp.setAttribute('data-tip', (opts.min !== undefined || opts.max !== undefined) ? 'Allowed ' + (opts.min !== undefined ? opts.min * scale : '…') + ' to ' + (opts.max !== undefined ? opts.max * scale : '…') + (opts.plo !== undefined ? '; usual ' + opts.plo * scale + ' to ' + opts.phi * scale : '') : '');
    return true;
  };
  inp.addEventListener('change', () => { if (check()) { set(parseFloat(inp.value) / scale); if (opts.onSet) opts.onSet(); else onConfigChanged(opts.section || 'geometry'); } });
  check();
  wrap.refresh = () => { inp.value = fmtInput(get() * scale, opts.digits); check(); };
  return wrap;
}
function fmtInput(v, digits) { if (!isFinite(v)) return ''; const s = Number(v.toPrecision(digits || 6)); return String(s); }
function selectField(label, get, set, options, opts) {
  opts = opts || {};
  const tiered = options.some(o => o.cls);  // material lists: options coloured by data quality (materialOptions)
  const sel = h('select', tiered ? tip('matTier') : null, ...options.map(o => h('option', Object.assign({ value: o.value, selected: o.value === String(get()) ? '' : null }, o.cls ? { class: o.cls } : {}), o.label)));
  if (tiered) paintMaterialSelect(sel);
  sel.addEventListener('change', () => { if (tiered) paintMaterialSelect(sel); set(sel.value); onConfigChanged(opts.section || 'geometry'); });
  return h('div', { class: 'field' }, h('label', null, label, help(opts.help)), sel, h('span', { class: 'unit' }, opts.unit || ''));
}
function checkField(label, get, set, opts) {
  opts = opts || {};
  const inp = h('input', { type: 'checkbox' });
  inp.checked = !!get();
  inp.addEventListener('change', () => { set(inp.checked); onConfigChanged(opts.section || 'geometry'); });
  return h('div', { class: 'field' }, h('label', null, label, help(opts.help)), inp, h('span'));
}

// ---- worker pool ----
/** Desktop app (window.fcbgaDesktop from desktop/preload.js): set when the page runs inside the app. */
const DESKTOP = window.fcbgaDesktop || null;
const DESKTOP_MEM_WARN = 0.8;  // the run panel warns when the estimate passes this fraction of the computer's memory

/**
 * Desktop app: a compute process of its own (desktop/compute-worker.js) with the Web Worker interface
 * WorkerClient uses. It runs the same core and driver outside the browser engine, so its memory is
 * limited by the computer, not by a browser tab. An unexpected stop (most often memory running out)
 * arrives as onerror with exited set.
 */
class DesktopWorker {
  constructor() {
    this.onmessage = null; this.onerror = null;
    this.handle = DESKTOP.spawn(msg => { if (this.onmessage) this.onmessage({ data: msg }); },
      info => { if (this.onerror) this.onerror({ exited: true, message: 'The compute process stopped unexpectedly (' + (info.signal ? 'signal ' + info.signal : 'exit code ' + info.code) + '); the computer most likely ran out of memory. Results already shown are kept; fewer parallel workers or a coarser mesh need less memory.' }); });
  }
  postMessage(msg) { this.handle.post(msg); }
  terminate() { this.handle.terminate(); }
}

class WorkerClient {
  constructor() {
    this.worker = null; this.pending = new Map(); this.nextId = 1; this.busy = false; this.dead = false;
    this.uid = WorkerClient.count = (WorkerClient.count || 0) + 1;  // keys this client's live reports in the progress panel
    this.ports = [];  // helpers' live-report ports (browser), closed when the client goes idle
    this.start();
  }
  _closePorts() { for (const p of this.ports) p.close(); this.ports = []; }
  start() {
    if (this.worker) this.worker.terminate();
    this._closePorts();
    this.dead = false;
    this.worker = DESKTOP ? new DesktopWorker() : new Worker(URL.createObjectURL(new Blob([CORE_SRC, '\n', WORKER_SRC], { type: 'text/javascript' })));
    this.worker.onmessage = ev => this._onMessage(ev.data);
    this.worker.onerror = ev => {
      // the worker itself died (browser worker error, or the desktop compute process exited): a crash, not a job error
      for (const p of this.pending.values()) p.reject(Object.assign(new Error(ev.message || 'The worker stopped unexpectedly.'), { crashed: true }));
      this.pending.clear(); this.busy = false;
      if (ev.exited) {
        // the desktop compute process is gone, and with it any analysis it held: restart on the next request
        this.dead = true;
        if (this === worker && app.results) { app.analysisLost = 'stopped'; renderAll(); }
      }
    };
    this.pending.clear();
    // the browser's helpers are built from the source text; the desktop compute process brings its own
    this.send({ type: 'init', db: MATERIALS_DB, src: DESKTOP ? null : CORE_SRC + '\n' + WORKER_SRC }).then(r => { if (r && r.nested === false) app.nestedWorkers = false; }).catch(() => {});
  }
  _onMessage(m) {
    if (m.type === 'live') { progressLive(this.uid + ':' + m.w, m.info); return; }
    if (m.type === 'liveport') { m.port.onmessage = ev => this._onMessage(ev.data); this.ports.push(m.port); return; }
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') { if (p.onProgress) p.onProgress(m.frac, m.msg); return; }
    if (m.type === 'partial') { if (p.onPartial) p.onPartial(m.payload); return; }
    this.pending.delete(m.id);
    if (!this.pending.size) this._closePorts();
    if (m.type === 'error') p.reject(Object.assign(new Error(m.message), { stack: m.stack }));
    else p.resolve(m.payload);
  }
  send(msg, onProgress, onPartial) {
    if (this.dead) this.start();
    const id = this.nextId++;
    msg.id = id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, onProgress, onPartial }); this.worker.postMessage(msg); });
  }
  /** Terminate and restart (cancels everything in flight). */
  cancel() {
    for (const p of this.pending.values()) p.reject(new Error('cancelled'));
    this.pending.clear();
    this.start();
  }
  /** Terminate for good (one-shot side workers); idempotent. */
  stop() {
    for (const p of this.pending.values()) p.reject(new Error('cancelled'));
    this.pending.clear();
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this._closePorts();
  }
}
const worker = new WorkerClient();

/** Status bar text and progress; a running job's record (src/ui/00e-progress.js) adds the dot, times and details. */
function setStatus(text, frac) {
  $('#status-text').textContent = text;
  const pr = $('#status-progress');
  if (frac === null || frac === undefined) { pr.hidden = true; $('#btn-cancel').hidden = true; }
  else { pr.hidden = false; pr.firstChild.style.width = (100 * Math.max(0, Math.min(1, frac))).toFixed(1) + '%'; $('#btn-cancel').hidden = false; }
  if (runProgress.job) progressStatusbar();
}

const RUN_S_PER_STEP = 2.7;  // s per step solve of the thermal path per 28k DOF (Draft lidded default, 76.9k DOF: full analysis 187 s on 3 workers, headless Chromium, 4-core container)
const RUN_MODULE_FACTOR = 2.4;  // stacked modules: PCG iterations per step against a monolithic package of the same size (Standard, first solves of stage 1 and stage 3: 265 / 121 and 135 / 54)
// Peak memory of a full analysis, fitted to the desktop compute process on the lidded default package (67 thermal-path
// steps, peak resident memory): Draft 76.9k DOF 367 MB on 1 worker and 811 MB on 3; Standard 505.7k DOF 2876 MB on 2
// and 3632 MB on 3. The main worker holds the model and its preconditioner, every step's increment (single precision,
// counted apart so the step count enters), the fields at every evaluation temperature and the post-processing states;
// each helper holds its own model and preconditioner only.
const MEM_MAIN_MB = 53, MEM_MAIN_MB_PER_DOF = 3.83e-3;      // without the step increments
const MEM_HELPER_MB = 126, MEM_HELPER_MB_PER_DOF = 1.245e-3;

/** Estimated DOF, memory and runtime for the current configuration and preset. */
function estimateRun(cfg, preset) {
  try {
    const mesh = C.buildPackageMesh(cfg, { preset });
    const inf = mesh.info;
    // one solve per step of the thermal path, planned here without solving and split over the workers; the preview
    // solves the process chain only
    const plan = new C.Analysis(cfg, { preset, evaluations: 'full' }).setupPath(mesh.groups);
    const nSteps = plan.buildPath().length, nChain = plan.path.chain.length;
    const mainMB = MEM_MAIN_MB + inf.nDof * (MEM_MAIN_MB_PER_DOF + 4 * nSteps / 1048576);
    const helperMB = MEM_HELPER_MB + inf.nDof * MEM_HELPER_MB_PER_DOF;
    const nw = Math.max(1, app.workers || 1);
    const memMB = mainMB + (nw - 1) * helperMB;
    const perSolve = inf.nDof / 28000 * RUN_S_PER_STEP * (cfg.modules && cfg.modules.length ? RUN_MODULE_FACTOR : 1);
    return { info: inf, warnings: C.meshWarnings(mesh), memMB, mainMB, helperMB, nSteps, previewS: Math.ceil(nChain / nw) * perSolve, fullS: Math.ceil(nSteps / nw) * perSolve + 8 };
  } catch (e) { return { error: e.message }; }
}

/** Configuration changed in a section: revalidate, refresh dependent views, schedule preview. */
function onConfigChanged(section, opts) {
  opts = opts || {};
  app.dirty = true;
  app.fieldsCache.clear();
  try { app.geom = C.deriveGeometry(app.cfg); } catch (e) { app.geom = null; }
  app.validation = C.validateConfig(app.cfg, app.geom);
  document.dispatchEvent(new CustomEvent('configchange', { detail: { section, opts } }));
}
