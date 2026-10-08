// ===== Sensitivity analysis: tornado charts (Section 10) ===================

/**
 * Default sensitivity inputs. Each entry has an id, a label, a getter and a
 * setter on a configuration, and a range rule: 'range' (datasheet range from
 * the material record), 'rel' (+-10 %), 'dT' (+-10 degC).
 */
function sensitivityInputs(cfg) {
  const mat = id => findMaterial(cfg.materials, id);
  const coreRow = cfg.substrate.layers.find(r => r.type === 'core');
  const coreId = coreRow ? coreRow.mat : 'mcl_e_795g';
  const abfRow = cfg.substrate.layers.find(r => r.type === 'diel');
  const abfId = abfRow ? abfRow.mat : 'abf_gl';
  const srRow = cfg.substrate.layers.find(r => r.type === 'sr');
  const srId = srRow ? srRow.mat : 'psr4000';
  const ufId = cfg.underfill.mat;
  const list = [];
  const add = (id, label, path, rule, extra) => list.push(Object.assign({ id, label, path, rule }, extra || {}));
  // paths: 'mat:<id>:<param path>' or 'cfg:<path>' or special
  add('coreCTE', 'Core CTE x,y', 'mat:' + coreId + ':cteXY.a', 'range');
  add('coreE', 'Core modulus', 'mat:' + coreId + ':elastic.Ex', 'range', { also: ['mat:' + coreId + ':elastic.Ey'] });
  if (coreRow) add('coreT', 'Core thickness', 'cfg:substrate.layers.' + cfg.substrate.layers.indexOf(coreRow) + '.t', 'rel');
  add('abfA1', 'ABF α1', 'mat:' + abfId + ':cte.a1', 'rel');
  add('abfA2', 'ABF α2', 'mat:' + abfId + ':cte.a2', 'rel');
  add('abfE', 'ABF modulus (glassy)', 'mat:' + abfId + ':elastic.E.Eg', 'rel');
  add('abfEr', 'ABF rubbery modulus', 'mat:' + abfId + ':elastic.E.Er', 'rel');
  add('abfTg', 'ABF Tg', 'mat:' + abfId + ':cte.TgTMA', 'dT', { also: ['mat:' + abfId + ':elastic.E.TgDMA'] });
  add('cuRatio', 'Residual Cu ratio (all layers)', 'special:cuRatio', 'rel');
  add('cuCTE', 'Cu CTE', 'special:cuCTE', 'rel');
  add('ufA1', 'Underfill α1', 'mat:' + ufId + ':cte.a1', 'rel');
  add('ufA2', 'Underfill α2', 'mat:' + ufId + ':cte.a2', 'rel');
  add('ufE', 'Underfill E (glassy)', 'mat:' + ufId + ':elastic.E.Eg', 'rel');
  add('ufTg', 'Underfill Tg', 'mat:' + ufId + ':cte.TgTMA', 'dT', { also: ['mat:' + ufId + ':elastic.E.TgDMA'] });
  add('ufTsf', 'Underfill stress-free T', 'cfg:process.Tuf', 'dT');
  add('dieT', 'Die thickness', 'special:dieT', 'rel');
  add('standoff', 'Bump standoff', 'cfg:bump.standoff', 'rel');
  add('Wf', 'Fillet width', 'cfg:underfill.Wf', 'rel');
  if (cfg.packageType === 'lid') {
    add('lidCTE', 'Lid material CTE', 'special:matCTE:' + cfg.lid.mat, 'rel');
    add('lidT', 'Lid plate thickness', 'cfg:lid.tPlate', 'rel');
    add('adhE', 'Lid adhesive modulus', 'special:matE:' + cfg.lid.adhMat, 'rel');
    add('Tattach', 'Lid attach stress-free T', 'cfg:process.Tattach', 'dT');
  } else if (cfg.packageType === 'stiffener') {
    add('stiffCTE', 'Stiffener material CTE', 'special:matCTE:' + cfg.stiffener.mat, 'rel');
    add('stiffT', 'Stiffener thickness', 'cfg:stiffener.t', 'rel');
    add('adhE', 'Stiffener adhesive modulus', 'special:matE:' + cfg.stiffener.adhMat, 'rel');
    add('Tattach', 'Stiffener attach stress-free T', 'cfg:process.Tattach', 'dT');
  }
  add('srA1', 'Solder resist α1', 'mat:' + srId + ':cte.a1', 'rel');
  if (srRow) add('srT', 'Solder resist thickness', 'special:srT', 'rel');
  return list;
}

/** Value and datasheet range of a sensitivity input on a configuration. */
function sensitivityValue(cfg, inp) {
  const p = inp.path.split(':');
  if (p[0] === 'cfg') { const v = getPath(cfg, p[1]); return { v, range: null }; }
  if (p[0] === 'mat') {
    const m = findMaterial(cfg.materials, p[1]);
    const par = getPath(m, p[2]);
    return { v: pv(par), range: par && par.r ? par.r : null };
  }
  switch (p[1]) {
    case 'cuRatio': return { v: 1, range: null };
    case 'cuCTE': return { v: 1, range: null };
    case 'dieT': return { v: 1, range: null };
    case 'srT': return { v: 1, range: null };
    case 'matCTE': return { v: 1, range: null };
    case 'matE': return { v: 1, range: null };
    default: return { v: NaN, range: null };
  }
}

/** Apply a perturbed value (absolute for cfg/mat paths, factor for specials) to a configuration copy. */
function applySensitivity(cfg, inp, value) {
  const c = deepClone(cfg);
  const p = inp.path.split(':');
  const setMat = (id, path, v) => { const m = findMaterial(c.materials, id); const par = getPath(m, path); if (par && typeof par === 'object' && 'v' in par) par.v = v; else setPath(m, path, v); };
  if (p[0] === 'cfg') setPath(c, p[1], value);
  else if (p[0] === 'mat') {
    setMat(p[1], p[2], value);
    const base = sensitivityValue(cfg, inp).v;
    for (const a of inp.also || []) { const q = a.split(':'); const cur = pv(getPath(findMaterial(cfg.materials, q[1]), q[2])); setMat(q[1], q[2], inp.rule === 'dT' ? cur + (value - base) : cur * value / base); }
  } else {
    const f = value;
    switch (p[1]) {
      case 'cuRatio': for (const r of c.substrate.layers) { if (r.type === 'cu') r.r = clamp(r.r * f, 0.01, 1); } break;
      case 'cuCTE': { const m = findMaterial(c.materials, 'cu'); if (m.cte.type === 'table') m.cte.v = m.cte.v.map(x => x * f); else m.cte.a.v *= f; break; }
      case 'dieT': for (const d of c.dies) d.t *= f; break;
      case 'srT': for (const r of c.substrate.layers) if (r.type === 'sr') r.t *= f; break;
      case 'matCTE': { const m = findMaterial(c.materials, p[2]); const scaleDef = def => { if (def.type === 'const') def.a.v *= f; else if (def.type === 'bilinear') { def.a1.v *= f; def.a2.v *= f; } else if (def.type === 'table' || def.type === 'secant') def.v = def.v.map(x => x * f); }; if (m.cte) scaleDef(m.cte); if (m.cteXY) scaleDef(m.cteXY); if (m.cteZ) scaleDef(m.cteZ); break; }
      case 'matE': { const m = findMaterial(c.materials, p[2]); const E = m.elastic.E; if (E.type === 'const') E.E.v *= f; else if (E.type === 'table') E.v = E.v.map(x => x * f); else if (E.type === 'sigmoid') { E.Eg.v *= f; E.Er.v *= f; } break; }
    }
  }
  return c;
}

/** Low and high values of an input. */
function sensitivityBounds(cfg, inp) {
  const { v, range } = sensitivityValue(cfg, inp);
  if (inp.rule === 'range' && range) return { lo: range[0], hi: range[1], base: v };
  if (inp.rule === 'dT') return { lo: v - CONST.SENS_DT, hi: v + CONST.SENS_DT, base: v };
  return { lo: v * (1 - CONST.SENS_REL), hi: v * (1 + CONST.SENS_REL), base: v };
}

/**
 * Sensitivity outputs of one Draft analysis: RT signed warpage, warpage at the
 * reflow peak, die backside interior peak stress, worst-bump dW proxy.
 */
function sensitivityOutputs(an) {
  const cfg = an.cfg, g = an.mesh.geom;
  const u25 = an.fields.get(25);
  const w25 = warpageJEITA(an.mesh, g, u25, cfg).signed;
  const peakT = cfg.reflow.peak;
  const wPeak = an.fields.has(peakT) ? warpageJEITA(an.mesh, g, an.fields.get(peakT), cfg).signed : NaN;
  let sPeak = -Infinity;
  for (let d = 0; d < g.dies.length; d++) sPeak = Math.max(sPeak, dieSurfaceStress(an.model, g, d, 'top', 25, an.finalStage, u25).peakInterior);
  let dW = -Infinity;
  if (an.temps.cycling.length > 1) for (let d = 0; d < g.dies.length; d++) { const sc = screenBumps(an, d); if (sc.top.length) dW = Math.max(dW, sc.top[0].dW); }
  return { warpRT: w25, warpPeak: wPeak, dieStress: sPeak, dW };
}

/** Evaluation set for sensitivity runs: 25, reflow peak and a sparse cycling set. */
function sensitivityTemps(cfg) {
  const cyc = [];
  for (let T = cfg.cycling.Tmin; T <= cfg.cycling.Tmax + 1e-9; T += 2 * CONST.CYCLE_DT_STEP) cyc.push(T);
  if (cyc[cyc.length - 1] !== cfg.cycling.Tmax) cyc.push(cfg.cycling.Tmax);
  if (!cyc.includes(25)) cyc.push(25);
  cyc.sort((a, b) => a - b);
  return { cycling: cyc, reflow: [25, cfg.reflow.peak], all: Array.from(new Set(cyc.concat([cfg.reflow.peak]))).sort((a, b) => a - b) };
}

/** One sensitivity case (base, low or high) at the Draft preset. */
function runSensitivityCase(cfg, opts) {
  const an = new Analysis(cfg, Object.assign({ preset: 'draft', evaluations: 'sensitivity' }, opts || {}));
  an.build();
  const temps = sensitivityTemps(cfg);
  an.evaluationTemperatures = () => temps;
  an.run();
  return sensitivityOutputs(an);
}

/** Tornado data from base and perturbed outputs. */
function tornadoFromCases(inputs, base, cases) {
  const keys = ['warpRT', 'warpPeak', 'dieStress', 'dW'];
  const out = {};
  for (const k of keys) {
    const rows = inputs.map(inp => {
      const c = cases[inp.id];
      if (!c) return null;
      const lo = c.lo[k] - base[k], hi = c.hi[k] - base[k];
      return { id: inp.id, label: inp.label, lo, hi, loValue: c.loValue, hiValue: c.hiValue, baseValue: c.baseValue, swing: Math.abs(hi - lo) };
    }).filter(Boolean).sort((a, b) => b.swing - a.swing);
    out[k] = { base: base[k], rows: rows.slice(0, 10), all: rows };
  }
  return out;
}
