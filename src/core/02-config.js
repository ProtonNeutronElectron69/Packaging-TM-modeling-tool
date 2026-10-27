// ===== Configuration model, defaults (Section 12), presets, hashing ======

/** JEITA ED-7306 (2007) Table 1 limits by ball pitch (mm). */
const JEITA_TABLE = [
  { pitch: 0.4, ballH: 0.20, hot: 0.10, rt: 0.08 },
  { pitch: 0.5, ballH: 0.25, hot: 0.11, rt: 0.08 },
  { pitch: 0.65, ballH: 0.33, hot: 0.14, rt: 0.10 },
  { pitch: 0.8, ballH: 0.35, hot: 0.17, rt: 0.10 },
  { pitch: 1.0, ballH: 0.50, hot: 0.22, rt: 0.20 },
  { pitch: 1.27, ballH: 0.60, hot: 0.25, rt: 0.20 },
];

const CYCLING_CONDITIONS = {
  G: { label: 'JESD22-A104 G (-40/125 °C)', Tmin: -40, Tmax: 125 },
  B: { label: 'JESD22-A104 B (-55/125 °C)', Tmin: -55, Tmax: 125 },
  J: { label: 'JESD22-A104 J (0/100 °C)', Tmin: 0, Tmax: 100 },
};

/**
 * N-2-N style stack generator (rows listed top to bottom).
 * Outer pad layers use their own residual ratio; inner layers alternate
 * plane / signal moving inward from the pad layer.
 */
function generateStack(o) {
  const p = Object.assign({
    n: 6, dielT: 0.025, cuT: 0.015, coreT: 0.8, coreCuT: 0.018, srT: 0.020, pth: 0.02,
    rPlane: 0.75, rSignal: 0.45, rTopPad: 0.35, rBottomPad: 0.55, rCoreCu: 0.70,
    diel: 'abf_gl', core: 'mcl_e_795g', sr: 'psr4000',
  }, o || {});
  const side = (padR, top) => {
    const rows = [];
    for (let k = 0; k < p.n; k++) {
      const pad = k === 0;
      const kind = pad ? 'signal' : (k % 2 === 1 ? 'plane' : 'signal');
      const r = pad ? padR : (kind === 'plane' ? p.rPlane : p.rSignal);
      rows.push({ type: 'cu', name: '', t: p.cuT, r, kind, fill: p.diel });
      rows.push({ type: 'diel', t: p.dielT, mat: p.diel, via: 0 });
    }
    return rows; // outer to inner
  };
  const top = side(p.rTopPad, true);
  const bot = side(p.rBottomPad, false).reverse(); // inner to outer
  const rows = [{ type: 'sr', t: p.srT, mat: p.sr }];
  rows.push(...top);
  if (p.coreT > 0) {
    rows.push({ type: 'cu', name: '', t: p.coreCuT, r: p.rCoreCu, kind: 'plane', fill: p.diel });
    rows.push({ type: 'core', t: p.coreT, mat: p.core, pth: p.pth });
    rows.push({ type: 'cu', name: '', t: p.coreCuT, r: p.rCoreCu, kind: 'plane', fill: p.diel });
  }
  rows.push(...bot);
  rows.push({ type: 'sr', t: p.srT, mat: p.sr });
  // name Cu layers L1..Ln top to bottom
  let li = 1;
  for (const r of rows) if (r.type === 'cu') r.name = 'L' + (li++);
  return rows;
}

function defaultDie(id, x, y) {
  return {
    id, name: 'Die ' + id.replace(/^D/, ''), x, y, sx: 20.0, sy: 20.0, t: 0.775, rot: 0, si: 'aniso',
    bump: { type: 'full', rows: 3, px: 0.150, py: 0.150, keepout: 0.150, ubm: 0.085, sro: 0.090, dmax: 0.105 },
  };
}

/**
 * Organic RDL interposer stack (rows listed top to bottom, chiplet side first):
 * n Cu layers between n + 1 dielectric layers, Cu alternating signal and plane
 * from the top. Row types and homogenization as in the substrate stack.
 */
function generateRdlStack(o) {
  const p = Object.assign({ n: 4, dielT: 0.005, cuT: 0.004, rSignal: 0.35, rPlane: 0.70, diel: 'hd4100' }, o || {});
  const rows = [{ type: 'diel', t: p.dielT, mat: p.diel, via: 0 }];
  for (let k = 0; k < p.n; k++) {
    const kind = k % 2 === 0 ? 'signal' : 'plane';
    rows.push({ type: 'cu', name: 'R' + (k + 1), t: p.cuT, r: kind === 'plane' ? p.rPlane : p.rSignal, kind, fill: p.diel });
    rows.push({ type: 'diel', t: p.dielT, mat: p.diel, via: 0 });
  }
  return rows;
}

/** Chiplet on a module base; x, y are relative to the module centre (module axes, before the module rotation). */
function defaultChiplet(id, x, y, sx, sy) {
  return { id, name: 'Chiplet ' + id.replace(/^C/, ''), x, y, sx: sx || 10.0, sy: sy || 10.0, rot: 0, si: 'aniso', ddi: { type: 'full', rows: 3, keepout: 0.050 } };
}

/**
 * Stacked module: one base (Si base die or interposer, or organic RDL
 * interposer) on the substrate's flip chip (C4) bumps, with one layer of
 * chiplets on die-to-die (DDI) microbumps. Wafer mold fills the module to the
 * base edge up to the chiplet backsides.
 */
function defaultModule(id, x, y, base) {
  const rdl = base === 'rdl';
  return {
    id, name: 'Module ' + id.replace(/^M/, ''), x, y, sx: 22.0, sy: 16.0, rot: 0,
    base: rdl ? 'rdl' : 'si', tBase: 0.100, si: 'aniso', tsv: 0.01, rdl: generateRdlStack({}),
    bump: { type: 'full', rows: 3, px: 0.150, py: 0.150, keepout: 0.150, ubm: 0.085, sro: 0.090, dmax: 0.105 },
    chiplets: [defaultChiplet('C1', -5.4, 0, 10.0, 14.0), defaultChiplet('C2', 5.4, 0, 10.0, 14.0)],
  };
}

/**
 * Package-wide stacked-module technology: one chiplet thickness, one DDI
 * microbump (Cu pillar plus solder cap, global pitch), the DDI fill ('wcuf':
 * wafer capillary underfill in the DDI gap plus wafer mold; 'mold': wafer mold
 * as a molded underfill) and the module process temperatures.
 */
function defaultStack() {
  return {
    chipletT: 0.700,
    ddi: { standoff: 0.025, pillarH: 0.012, d: 0.025, px: 0.040, py: 0.040, solder: 'sn35ag' },
    fill: 'wcuf',
    wcuf: { mat: 'cv5300', Wf: 0.30, Hf: 0.5 },
    moldMat: 'ei6042',
    process: { Tddi: 221, Twcuf: 150, Tmold: 180 },
  };
}

/**
 * Fill in what a configuration from an earlier version lacks (no stacked
 * modules) and add default materials it does not carry, so a saved file keeps
 * loading. Returns the same object.
 */
function normalizeConfig(cfg, db) {
  if (!Array.isArray(cfg.modules)) cfg.modules = [];
  const st = defaultStack();
  if (!cfg.stack) cfg.stack = st;
  else {
    for (const k of Object.keys(st)) if (cfg.stack[k] == null) cfg.stack[k] = st[k];
    for (const k of ['ddi', 'wcuf', 'process']) for (const q of Object.keys(st[k])) if (cfg.stack[k][q] == null) cfg.stack[k][q] = st[k][q];
  }
  if (db && Array.isArray(cfg.materials)) {
    const have = new Set(cfg.materials.map(m => m.id));
    for (const m of buildMaterialLibrary(db)) if (!have.has(m.id)) cfg.materials.push(m);
  }
  return cfg;
}

/** Section 12.1 default package (lidded, single die). */
function defaultConfig(db) {
  return {
    schema: 'fcbga-tm-config', version: 1,
    name: 'Default lidded single die',
    substrate: { sx: 45.0, sy: 45.0, layers: generateStack({}) },
    bga: { pitch: 1.0, ballH: 0.50, inset: 1.0, depop: { on: false, sx: 10, sy: 10 } },
    packageType: 'lid',
    bump: { standoff: 0.075, solder: 'sac305' },
    dies: [defaultDie('D1', 0, 0)],
    modules: [],
    stack: defaultStack(),
    underfill:{ mat: 'uf9000ae', Wf: 0.8, Hf: 0.7 },
    lid: { mat: 'cu', ox: 43.0, oy: 43.0, tPlate: 1.0, footW: 3.0, adhMat: 'eccobond3005', adhT: 0.100, timMat: 'tim_gel', blt: 0.050 },
    stiffener: { mat: 'cu', ox: 53.0, oy: 53.0, ringW: 4.0, t: 0.8, adhMat: 'eccobond3005', adhT: 0.050 },
    process: { Tsub: 217, Tjoin: 217, Tuf: 165, Tattach: 150 },
    reflow: { peak: 260, reportTemps: [25, 150, 220, 260] },
    cycling: { cond: 'G', Tmin: -40, Tmax: 125, ramp: 10, dwell: 15, cycles: 3 },
    mesh: { preset: 'standard' },
    submodel: { nxy: 16, nz: 14, bumps: [] },
    limits: {
      jeita: JEITA_TABLE.map(r => Object.assign({}, r)),
      dieStrength: null, bumpAxialN: null, bumpShearN: null,
    },
    fatigue: { CW: CONST.SYED_CW, Cstrain: CONST.SYED_CSTRAIN, K1: null, K2: null, K3: null, K4: null },
    materials: buildMaterialLibrary(db),
  };
}

/** Section 12.2 presets. */
function presetConfig(db, which, variant) {
  const c = defaultConfig(db);
  switch (which) {
    case 'default': break;
    case 'bare':
      c.name = 'Bare die'; c.packageType = 'bare'; break;
    case 'stiffener2': {
      c.name = 'Stiffener, two dies side by side';
      c.packageType = 'stiffener';
      c.substrate.sx = 55; c.substrate.sy = 55;
      const gap = 0.20, w = 16.0;
      const d1 = defaultDie('D1', -(w + gap) / 2, 0), d2 = defaultDie('D2', (w + gap) / 2, 0);
      d1.sx = d2.sx = 16.0; d1.sy = d2.sy = 24.0;
      c.dies = [d1, d2];
      c.stiffener = { mat: 'cu', ox: 53.0, oy: 53.0, ringW: 4.0, t: 0.8, adhMat: 'eccobond3005', adhT: 0.050 };
      break;
    }
    case 'offset': {
      c.name = 'Offset die (asymmetry demo)'; c.packageType = 'bare';
      c.dies[0].sx = 15; c.dies[0].sy = 15; c.dies[0].x = 8; c.dies[0].y = 6;
      break;
    }
    case 'coreStudy': {
      const v = variant === 'A' ? 'A' : 'B';
      c.name = 'Core thickness study, variant ' + v + (v === 'A' ? ' (0.4 mm core)' : ' (0.8 mm core)');
      c.packageType = 'bare';
      c.substrate.sx = 40; c.substrate.sy = 40;
      c.substrate.layers = generateStack({ n: 3, dielT: 0.020, cuT: 0.015, srT: 0.019, coreT: v === 'A' ? 0.4 : 0.8, coreCuT: 0.015 });
      c.bga.inset = 1.0;
      break;
    }
    case 'foveros': {
      // illustrative Foveros-S-like package: one Si base die with three chiplets, lidded (dimensions are not a product's)
      c.name = 'Foveros-S-like: Si base die with chiplets (lidded)';
      const m = defaultModule('M1', 0, 0, 'si');
      Object.assign(m, { name: 'Base die 1', sx: 21.0, sy: 16.0, tBase: 0.150, tsv: 0.01 });
      m.chiplets = [defaultChiplet('C1', -5.15, 3.85, 10.0, 7.2), defaultChiplet('C2', 5.15, 3.85, 10.0, 7.2), defaultChiplet('C3', 0, -3.85, 20.3, 7.2)];
      c.dies = []; c.modules = [m];
      c.stack.chipletT = 0.700;
      break;
    }
    case 'cowosr': {
      // illustrative CoWoS-R-like package: organic RDL interposer with an SoC and two memory stacks, lidded
      c.name = 'CoWoS-R-like: organic RDL interposer with chiplets (lidded)';
      c.substrate.sx = 55; c.substrate.sy = 55;
      c.lid = Object.assign(c.lid, { ox: 53.0, oy: 53.0 });
      const m = defaultModule('M1', 0, 0, 'rdl');
      Object.assign(m, { name: 'RDL interposer 1', sx: 30.0, sy: 24.0 });
      const soc = defaultChiplet('C1', -5.5, 0, 17.0, 22.0); soc.name = 'SoC';
      const m1 = defaultChiplet('C2', 9.0, 5.5, 11.0, 10.5); m1.name = 'Memory 1';
      const m2 = defaultChiplet('C3', 9.0, -5.5, 11.0, 10.5); m2.name = 'Memory 2';
      m.chiplets = [soc, m1, m2];
      c.dies = []; c.modules = [m];
      c.stack.chipletT = 0.720;
      break;
    }
    case 'mixed': {
      // Si-base module, RDL module and a monolithic die on one substrate, with a stiffener ring
      c.name = 'Mixed: Si base module, RDL module and monolithic die (stiffener)';
      c.packageType = 'stiffener';
      c.substrate.sx = 60; c.substrate.sy = 60;
      c.stiffener = { mat: 'cu', ox: 58.0, oy: 58.0, ringW: 4.0, t: 0.8, adhMat: 'eccobond3005', adhT: 0.050 };
      const a = defaultModule('M1', -11, 9, 'si'), b = defaultModule('M2', 11, 9, 'rdl');
      for (const m of [a, b]) {
        Object.assign(m, { sx: 18.0, sy: 14.0 });
        m.chiplets = [defaultChiplet('C1', -4.4, 0, 8.0, 12.0), defaultChiplet('C2', 4.4, 0, 8.0, 12.0)];
      }
      a.name = 'Si base module'; b.name = 'RDL module';
      const d = defaultDie('D1', 0, -10); Object.assign(d, { sx: 16.0, sy: 12.0 });
      c.dies = [d]; c.modules = [a, b];
      break;
    }
    default: throw new Error('Unknown preset ' + which);
  }
  return c;
}

const PRESET_LIST = [
  { id: 'default', label: '1. Default lidded single die' },
  { id: 'bare', label: '2. Bare die' },
  { id: 'stiffener2', label: '3. Stiffener, two dies side by side' },
  { id: 'offset', label: '4. Offset die (asymmetry demo)' },
  { id: 'coreStudy:A', label: '5A. Core study, 0.4 mm core' },
  { id: 'coreStudy:B', label: '5B. Core study, 0.8 mm core' },
  { id: 'foveros', label: '6. Foveros-S-like (Si base die, chiplets, lid)' },
  { id: 'cowosr', label: '7. CoWoS-R-like (RDL interposer, chiplets, lid)' },
  { id: 'mixed', label: '8. Mixed: Si module, RDL module, monolithic die' },
];

/** Hashes of the configuration sections used for result caching. */
function configHashes(cfg) {
  const geometry = { substrate: cfg.substrate, bga: cfg.bga, packageType: cfg.packageType, bump: cfg.bump, dies: cfg.dies, underfill: cfg.underfill,
    lid: cfg.packageType === 'lid' ? cfg.lid : null, stiffener: cfg.packageType === 'stiffener' ? cfg.stiffener : null };
  // stacked modules enter the hashes only when present, so a configuration without them keeps its earlier hashes
  const mods = cfg.modules && cfg.modules.length ? cfg.modules : null;
  if (mods) geometry.modules = { modules: mods, stack: Object.assign({}, cfg.stack, { process: null }) };
  const h = {
    geometry: hashObject(geometry),
    materials: hashObject(cfg.materials),
    process: hashObject(mods ? { process: cfg.process, modules: cfg.stack.process } : cfg.process),
    loads: hashObject({ reflow: cfg.reflow, cycling: cfg.cycling }),
    mesh: hashObject(cfg.mesh),
    post: hashObject({ limits: cfg.limits, fatigue: cfg.fatigue, submodel: cfg.submodel }),
  };
  h.model = hashString(h.geometry + h.materials + h.process + h.mesh);
  h.all = hashObject(cfg);
  return h;
}

/** JSON save / load with schema check. */
function serializeConfig(cfg) { return JSON.stringify(cfg, null, 1); }
function parseConfig(text, db) {
  const c = JSON.parse(text);
  if (!c || c.schema !== 'fcbga-tm-config') throw new Error('Not an FCBGA screening tool configuration file.');
  return normalizeConfig(c, db);
}

/** Materials referenced by a configuration (role -> id). */
function materialRoles(cfg) {
  const roles = [];
  const add = (role, id) => { if (id) roles.push({ role, id }); };
  add('Solder bumps', cfg.bump.solder);
  add('Underfill', cfg.underfill.mat);
  add('Silicon die', 'si');
  const seen = new Set();
  for (const r of cfg.substrate.layers) {
    for (const id of [r.mat, r.fill]) if (id && !seen.has(id)) { seen.add(id); add('Substrate (' + r.type + ')', id); }
  }
  add('Substrate Cu', 'cu');
  if (cfg.packageType === 'lid') { add('Lid', cfg.lid.mat); add('Lid adhesive', cfg.lid.adhMat); add('TIM1', cfg.lid.timMat); }
  if (cfg.packageType === 'stiffener') { add('Stiffener', cfg.stiffener.mat); add('Stiffener adhesive', cfg.stiffener.adhMat); }
  if (cfg.modules && cfg.modules.length) {
    const st = cfg.stack;
    add('DDI microbump solder', st.ddi.solder);
    if (st.fill === 'wcuf') add('Wafer underfill (wCUF)', st.wcuf.mat);
    add('Wafer mold', st.moldMat);
    for (const m of cfg.modules) if (m.base === 'rdl') for (const r of m.rdl) for (const id of [r.mat, r.fill]) if (id && !seen.has(id)) { seen.add(id); add('RDL interposer (' + r.type + ')', id); }
  }
  return roles;
}
