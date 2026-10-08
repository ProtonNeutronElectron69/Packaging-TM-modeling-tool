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
    underfill: { mat: 'uf9000ae', Wf: 0.8, Hf: 0.7 },
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
];

/** Hashes of the configuration sections used for result caching. */
function configHashes(cfg) {
  const geometry = { substrate: cfg.substrate, bga: cfg.bga, packageType: cfg.packageType, bump: cfg.bump, dies: cfg.dies, underfill: cfg.underfill,
    lid: cfg.packageType === 'lid' ? cfg.lid : null, stiffener: cfg.packageType === 'stiffener' ? cfg.stiffener : null };
  const h = {
    geometry: hashObject(geometry),
    materials: hashObject(cfg.materials),
    process: hashObject(cfg.process),
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
function parseConfig(text) {
  const c = JSON.parse(text);
  if (!c || c.schema !== 'fcbga-tm-config') throw new Error('Not an FCBGA screening tool configuration file.');
  return c;
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
  return roles;
}
