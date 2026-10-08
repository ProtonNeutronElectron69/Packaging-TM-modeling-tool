// ===== Materials: data model, property evaluation, 1 degC tables ========
//
// Database leaf parameters are {v, u, c, s, r, n}: value, unit, confidence,
// sources, datasheet range, note. Moduli are stored in GPa (or MPa where the
// unit says so) and CTEs in ppm/degC; this module converts to MPa and 1/degC.

function getPath(obj, path) {
  const ks = path.split('.');
  let o = obj;
  for (const k of ks) { if (o == null) return undefined; o = o[k]; }
  return o;
}
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = val;
}

/** Modulus parameter to MPa according to its unit. */
function modMPa(p) {
  const v = pv(p);
  const u = (p && p.u) || 'GPa';
  return u === 'MPa' ? v : v * CONST.GPA;
}

/** Visit every leaf parameter {v: ...} of a material record. */
function forEachParam(obj, fn, prefix) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('v' in v) fn(v, p); else forEachParam(v, fn, p);
    } else if (v && typeof v === 'object' && Array.isArray(v.T)) {
      fn(v, p);
    }
  }
}

/**
 * Resolve the database into a flat list of complete material records:
 * presets (presetOf + override) and placeholders (placeholderOf) are expanded.
 */
function buildMaterialLibrary(db) {
  const byId = {};
  for (const m of db.materials) byId[m.id] = m;
  const out = [];
  for (const m of db.materials) {
    let r;
    if (m.presetOf) {
      const base = deepClone(byId[m.presetOf]);
      r = Object.assign(base, deepClone(m));
      delete r.override;
      for (const p of Object.keys(m.override || {})) setPath(r, p, deepClone(m.override[p]));
    } else if (m.placeholderOf) {
      const base = deepClone(byId[m.placeholderOf]);
      r = Object.assign(base, deepClone(m));
      const note = 'Placeholder copied from ' + byId[m.placeholderOf].name + '; enter alloy data.';
      forEachParam(r.elastic, p => { p.c = 'Estimated'; p.n = note; delete p.s; });
      forEachParam(r.cte, p => { p.c = 'Estimated'; p.n = note; delete p.s; });
      if (r.cte && r.cte.type) { r.cte.c = 'Estimated'; }
      if (r.elastic && r.elastic.E && r.elastic.E.type === 'table') { r.elastic.E.c = 'Estimated'; r.elastic.E.n = note; delete r.elastic.E.s; }
      forEachParam(r.anand, p => { p.c = 'Estimated'; p.n = note; delete p.s; });
      if (r.solidus) { r.solidus.c = 'Estimated'; r.solidus.n = note; }
    } else {
      r = deepClone(m);
    }
    r.defaultOf = m.id;
    out.push(r);
  }
  return out;
}

function findMaterial(lib, id) {
  for (const m of lib) if (m.id === id) return m;
  throw new Error('Unknown material id "' + id + '"');
}

// ---- E(T) ------------------------------------------------------------------

/**
 * E(T) in MPa for an isotropic modulus definition (no solidus rule):
 *  const:   E
 *  table:   linear (metals) or log-linear (polymers) interpolation in T
 *  sigmoid: E(T) = E_r + (E_g - E_r) / (1 + exp((T - Tg_DMA) / w))
 */
function evalEdef(def, T) {
  switch (def.type) {
    case 'const': return modMPa(def.E);
    case 'table': {
      const scale = (def.u === 'MPa') ? 1 : CONST.GPA;
      if (def.interp === 'log') {
        const ly = def.v.map(Math.log);
        return Math.exp(interpTable(def.T, ly, T, def.extrap)) * scale;
      }
      return interpTable(def.T, def.v, T, def.extrap) * scale;
    }
    case 'sigmoid': {
      const Eg = modMPa(def.Eg), Er = modMPa(def.Er);
      const w = pv(def.w) || CONST.SIGMOID_W_DEFAULT;
      return Er + (Eg - Er) / (1 + Math.exp((T - pv(def.TgDMA)) / w));
    }
    default: throw new Error('Unknown E(T) type ' + def.type);
  }
}

/** Isotropic Young's modulus (MPa) including the solder solidus floor. */
function isoE(mat, T) {
  const def = mat.elastic.E;
  if (mat.solidus) {
    const Ts = pv(mat.solidus);
    if (T > Ts) return CONST.SOLDER_MOLTEN_FRACTION * evalEdef(def, Ts);
  }
  return evalEdef(def, T);
}

/** Temperature factor applied to all orthotropic moduli (glass transition sigmoid). */
function orthoFactor(el, T) {
  const r = pv(el.rubberyRatio);
  const Tg = pv(el.TgDMA);
  if (r == null || Tg == null) return 1;
  const w = pv(el.w) || CONST.SIGMOID_W_DEFAULT;
  return r + (1 - r) / (1 + Math.exp((T - Tg) / w));
}

// ---- CTE ---------------------------------------------------------------------

function softplus(x) { return x > 30 ? x : Math.log1p(Math.exp(x)); }

/** Silicon instantaneous CTE (1/K), Okada and Tokumaru (1984), T in degC. */
function siliconAlpha(T) {
  const TK = T + CONST.KELVIN;
  return (3.725 * (1 - Math.exp(-5.88e-3 * (TK - 124))) + 5.548e-4 * TK) * 1e-6;
}

/** Instantaneous CTE alpha(T) in 1/degC. */
function cteAlpha(def, T) {
  switch (def.type) {
    case 'const': return pv(def.a) * CONST.PPM;
    case 'bilinear': {
      // alpha(T) = a1 + (a2 - a1) / (1 + exp(-(T - Tg_TMA) / delta))
      const a1 = pv(def.a1) * CONST.PPM, a2 = pv(def.a2) * CONST.PPM;
      const d = pv(def.delta) || CONST.CTE_SMOOTH_DELTA;
      return a1 + (a2 - a1) / (1 + Math.exp(-(T - pv(def.TgTMA)) / d));
    }
    case 'table': return interpTable(def.T, def.v, T, def.extrap || 'linear') * CONST.PPM;
    case 'silicon': return siliconAlpha(T);
    case 'secant': {
      const h = 0.01;
      return (secantStrain(def, T + h) - secantStrain(def, T - h)) / (2 * h);
    }
    default: throw new Error('Unknown CTE type ' + def.type);
  }
}

/** Secant (mean) CTE referenced to Tref: eps(T) = alpha_sec(T) (T - Tref). */
function secantStrain(def, T) {
  const a = interpTable(def.T, def.v, T, def.extrap || 'linear') * CONST.PPM;
  return a * (T - def.Tref);
}

/**
 * Cumulative thermal strain F(T) = integral of alpha from T0 = 25 degC to T,
 * evaluated exactly (closed forms) or by Simpson / exact trapezoids.
 */
function thermalStrain(def, T) {
  const T0 = CONST.T_STRAIN_ORIGIN;
  switch (def.type) {
    case 'const': return pv(def.a) * CONST.PPM * (T - T0);
    case 'bilinear': {
      const a1 = pv(def.a1) * CONST.PPM, a2 = pv(def.a2) * CONST.PPM;
      const d = pv(def.delta) || CONST.CTE_SMOOTH_DELTA, Tg = pv(def.TgTMA);
      // integral of the logistic term: (a2 - a1) d ln(1 + exp((T - Tg)/d))
      return a1 * (T - T0) + (a2 - a1) * d * (softplus((T - Tg) / d) - softplus((T0 - Tg) / d));
    }
    case 'table': {
      // piecewise-linear alpha: trapezoids between break points are exact
      const lo = Math.min(T, T0), hi = Math.max(T, T0);
      const pts = [lo];
      for (const t of def.T) if (t > lo && t < hi) pts.push(t);
      pts.push(hi);
      let s = 0;
      for (let i = 0; i + 1 < pts.length; i++) s += 0.5 * (pts[i + 1] - pts[i]) * (cteAlpha(def, pts[i]) + cteAlpha(def, pts[i + 1]));
      return T >= T0 ? s : -s;
    }
    case 'silicon': {
      const n = Math.max(2, 2 * Math.ceil(Math.abs(T - T0) * CONST.CTE_INTEGRATION_SUBSTEPS / 2));
      return simpson(siliconAlpha, T0, T, n);
    }
    case 'secant': return secantStrain(def, T) - secantStrain(def, T0);
    default: throw new Error('Unknown CTE type ' + def.type);
  }
}

/** The CTE definition(s) of a material: {xy, z}. */
function materialCte(mat) {
  if (mat.cteXY) return { xy: mat.cteXY, z: mat.cteZ || mat.cteXY };
  return { xy: mat.cte, z: mat.cte };
}

/** Tg values present in a material (for refining the cycling samples). */
function materialTgs(mat) {
  const out = [];
  const add = (p, label) => { const v = pv(p); if (typeof v === 'number') out.push({ T: v, label }); };
  const el = mat.elastic || {};
  if (el.E && el.E.type === 'sigmoid') add(el.E.TgDMA, 'Tg DMA');
  if (el.type === 'ortho') add(el.TgDMA, 'Tg DMA');
  const c = materialCte(mat);
  if (c.xy && c.xy.type === 'bilinear') add(c.xy.TgTMA, 'Tg TMA');
  if (c.z && c.z !== c.xy && c.z.type === 'bilinear') add(c.z.TgTMA, 'Tg TMA');
  return out;
}

// ---- elastic matrices ----------------------------------------------------------

/**
 * Orthotropic stiffness (6x6, Voigt order xx, yy, zz, xy, yz, zx with
 * engineering shear strains) from engineering constants, by inverting the
 * compliance. Poisson ratios are clamped to nuMax.
 */
function orthoD(ec, nuMax, out) {
  out = out || new Float64Array(36);
  out.fill(0);
  const cl = v => Math.min(v, nuMax == null ? 0.499 : nuMax);
  const nxy = cl(ec.nuxy), nxz = cl(ec.nuxz), nyz = cl(ec.nuyz);
  const S = new Float64Array(9);
  S[0] = 1 / ec.Ex; S[4] = 1 / ec.Ey; S[8] = 1 / ec.Ez;
  S[1] = S[3] = -nxy / ec.Ex;
  S[2] = S[6] = -nxz / ec.Ex;
  S[5] = S[7] = -nyz / ec.Ey;
  const C = invDense(S, 3);
  out[0] = C[0]; out[1] = C[1]; out[2] = C[2];
  out[6] = C[3]; out[7] = C[4]; out[8] = C[5];
  out[12] = C[6]; out[13] = C[7]; out[14] = C[8];
  out[21] = ec.Gxy; out[28] = ec.Gyz; out[35] = ec.Gxz;
  return out;
}

/** Isotropic engineering constants record. */
function isoEC(E, nu, a) {
  const G = E / (2 * (1 + nu));
  return { Ex: E, Ey: E, Ez: E, Gxy: G, Gxz: G, Gyz: G, nuxy: nu, nuxz: nu, nuyz: nu, ax: a, ay: a, az: a };
}

/** Isotropic stiffness for E = 1 (unit) or given E. */
function isoD(E, nu, nuMax, out) {
  return orthoD(isoEC(E, Math.min(nu, nuMax == null ? 0.499 : nuMax), 0), nuMax, out);
}

/**
 * Cubic stiffness of (100) silicon rotated by theta about z (theta = 45 deg puts
 * the x axis along <110>). Full tensor rotation C'_ijkl = R_ip R_jq R_kr R_ls C_pqrs.
 */
function cubicRotatedD(C11, C12, C44, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const R = [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  const C4 = (i, j, k, l) => {
    if (i === j && k === l) return i === k ? C11 : C12;
    if ((i === k && j === l) || (i === l && j === k)) return i !== j ? C44 : 0;
    return 0;
  };
  const voigt = [[0, 0], [1, 1], [2, 2], [0, 1], [1, 2], [2, 0]];
  const D = new Float64Array(36);
  for (let a = 0; a < 6; a++) {
    for (let b = 0; b < 6; b++) {
      const [i, j] = voigt[a], [k, l] = voigt[b];
      let sum = 0;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) for (let r = 0; r < 3; r++) for (let t = 0; t < 3; t++) {
        const cv = C4(p, q, r, t);
        if (cv !== 0) sum += R[i][p] * R[j][q] * R[k][r] * R[l][t] * cv;
      }
      D[a * 6 + b] = sum;
    }
  }
  return D;
}

/** Young's modulus along unit direction n from a 6x6 stiffness (via compliance). */
function directionalModulus(D, n) {
  const S = invDense(D, 6);
  // strain = S stress; uniaxial stress along n: stress Voigt = [n1^2, n2^2, n3^2, n1n2, n2n3, n3n1]
  const sv = [n[0] * n[0], n[1] * n[1], n[2] * n[2], n[0] * n[1], n[1] * n[2], n[2] * n[0]];
  const ev = new Float64Array(6);
  for (let i = 0; i < 6; i++) { let t = 0; for (let j = 0; j < 6; j++) t += S[i * 6 + j] * sv[j]; ev[i] = t; }
  // normal strain along n: n.eps.n with engineering shears
  const e = ev[0] * n[0] * n[0] + ev[1] * n[1] * n[1] + ev[2] * n[2] * n[2]
    + ev[3] * n[0] * n[1] + ev[4] * n[1] * n[2] + ev[5] * n[2] * n[0];
  return 1 / e;
}

/** Silicon stiffness (MPa) per the die setting: 'aniso' (cubic, <110> edges) or 'iso'. */
function siliconD(mat, model) {
  const el = mat.elastic;
  if (model === 'iso') return isoD(modMPa(el.E_iso), pv(el.nu_iso), CONST.NU_MAX_GLOBAL);
  return cubicRotatedD(modMPa(el.C11), modMPa(el.C12), modMPa(el.C44), Math.PI / 4);
}

/** Engineering constants of a material at T (for homogenization). */
function materialEC(mat, T) {
  const el = mat.elastic;
  const ctes = materialCte(mat);
  const axy = cteAlpha(ctes.xy, T), az = cteAlpha(ctes.z, T);
  if (el.type === 'iso') {
    const ec = isoEC(isoE(mat, T), pv(el.nu), axy);
    ec.az = az;
    return ec;
  }
  if (el.type === 'ortho') {
    const f = orthoFactor(el, T);
    return {
      Ex: f * modMPa(el.Ex), Ey: f * modMPa(el.Ey), Ez: f * modMPa(el.Ez),
      Gxy: f * modMPa(el.Gxy), Gxz: f * modMPa(el.Gxz), Gyz: f * modMPa(el.Gyz),
      nuxy: pv(el.nuxy), nuxz: pv(el.nuxz), nuyz: pv(el.nuyz), ax: axy, ay: axy, az,
    };
  }
  if (el.type === 'cubic') {
    const ec = isoEC(modMPa(el.E_iso), pv(el.nu_iso), axy);
    ec.az = az;
    return ec;
  }
  throw new Error('Unknown elastic type ' + el.type);
}

// ---- 1 degC property tables ---------------------------------------------------

const TGRID_N = CONST.TGRID_MAX - CONST.TGRID_MIN + 1;

/** Linear interpolation in a 1 degC grid table (optionally strided). */
function gridAt(arr, T, stride, comp) {
  stride = stride || 1; comp = comp || 0;
  let x = T - CONST.TGRID_MIN;
  if (x <= 0) return arr[comp];
  if (x >= TGRID_N - 1) return arr[(TGRID_N - 1) * stride + comp];
  const i = Math.floor(x), t = x - i;
  const a = arr[i * stride + comp], b = arr[(i + 1) * stride + comp];
  return a + t * (b - a);
}

/**
 * Precompute E(T) (MPa) and F(T) on the 1 degC grid for an isotropic or cubic
 * material used by single-material elements. Returns {E, F, nu}.
 */
function isoTables(mat) {
  const E = new Float64Array(TGRID_N), F = new Float64Array(TGRID_N);
  const cte = materialCte(mat).xy;
  for (let i = 0; i < TGRID_N; i++) {
    const T = CONST.TGRID_MIN + i;
    E[i] = mat.elastic.type === 'iso' ? isoE(mat, T) : 1;
    F[i] = thermalStrain(cte, T);
  }
  return { E, F, nu: mat.elastic.type === 'iso' ? pv(mat.elastic.nu) : null };
}

const _tableCache = new Map();
/** Cached isoTables keyed by the material content hash. */
function materialTables(mat) {
  const key = hashObject([mat.elastic, mat.cte, mat.cteXY, mat.cteZ, mat.solidus]);
  let t = _tableCache.get(key);
  if (!t) {
    t = isoTables(mat);
    if (_tableCache.size > 200) _tableCache.clear();
    _tableCache.set(key, t);
  }
  return t;
}
