// ===== Global analysis driver: stages, evaluations (Section 6.5, 9.2) ====

/** Plane segment ids for the shell coarse space: substrate / die stack / lid. */
function planeSegments(mesh) {
  const g = mesh.geom, seg = new Int32Array(mesh.nz);
  const zDie = g.dies.reduce((m, d) => Math.max(m, d.ztop), g.zaf);
  for (let k = 0; k < mesh.nz; k++) {
    const z = mesh.zs[k];
    seg[k] = z <= g.zt + 1e-9 ? 0 : (z <= zDie + 1e-9 ? 1 : 2);
  }
  // compress unused ids
  const used = Array.from(new Set(Array.from(seg))).sort((a, b) => a - b);
  for (let k = 0; k < mesh.nz; k++) seg[k] = used.indexOf(seg[k]);
  return seg;
}

/** Tg values (degC) of every material used by the model. */
function modelTgs(cfg, groups) {
  const out = [];
  const seen = new Set();
  const add = m => { if (seen.has(m.id)) return; seen.add(m.id); for (const t of materialTgs(m)) out.push(t.T); };
  for (const g of groups) if (g.material) add(g.material);
  for (const r of cfg.substrate.layers) for (const id of [r.mat, r.fill]) if (id) add(findMaterial(cfg.materials, id));
  return out;
}

/** Temperature samples: every `step`, refined to `fine` within +-band of any Tg, plus extras. */
function temperatureSamples(Tmin, Tmax, tgs, extras) {
  const set = new Set();
  const add = T => { if (T >= Tmin - 1e-9 && T <= Tmax + 1e-9) set.add(Math.round(T * 1000) / 1000); };
  add(Tmin); add(Tmax);
  for (let T = Math.ceil(Tmin / CONST.CYCLE_DT_STEP) * CONST.CYCLE_DT_STEP; T <= Tmax; T += CONST.CYCLE_DT_STEP) add(T);
  for (const tg of tgs) {
    const lo = Math.ceil((tg - CONST.CYCLE_TG_BAND) / CONST.CYCLE_DT_FINE) * CONST.CYCLE_DT_FINE;
    for (let T = lo; T <= tg + CONST.CYCLE_TG_BAND; T += CONST.CYCLE_DT_FINE) add(T);
  }
  for (const T of extras || []) add(T);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Global thermomechanical analysis of a configuration at a fidelity preset.
 * opts: {preset, hmin, hmax, cap, progress(fn), cancelled(fn), precond,
 *        evaluations: 'full' | 'preview' | 'sensitivity'}
 */
class Analysis {
  constructor(cfg, opts) {
    this.cfg = cfg;
    this.opts = Object.assign({ evaluations: 'full', precond: 'mg' }, opts || {});
    this.timings = {};
    this.log = [];
    this.notes = [];
  }

  progress(frac, msg) { if (this.opts.progress) this.opts.progress(frac, msg); }
  checkCancel() { if (this.opts.cancelled && this.opts.cancelled()) throw new Error('cancelled'); }

  build() {
    const t0 = nowMs();
    this.mesh = buildPackageMesh(this.cfg, this.opts);
    this.timings.mesh = nowMs() - t0;
    const t1 = nowMs();
    this.model = new FEModel(this.mesh, this.cfg);
    this.timings.model = nowMs() - t1;
    this.planeSeg = planeSegments(this.mesh);
    this.solver = new LinearSolver(this.model, { precond: this.opts.precond, tol: this.opts.quick ? CONST.PREVIEW_TOL : CONST.PCG_TOL, mg: { planeSeg: this.planeSeg }, log: r => this.log.push(r) });
    this.rhs = new Float64Array(this.model.ndof);
    this.finalStage = this.cfg.packageType === 'bare' ? 2 : 3;
    this.tgs = modelTgs(this.cfg, this.model.groups);
    this.solidus = pv(findMaterial(this.cfg.materials, this.cfg.bump.solder).solidus || { v: 217 });
    return this;
  }

  /** One linear solve: assemble at T for the given stage and solve. */
  solveAt(T, stage, label) {
    this.checkCancel();
    const ta = nowMs();
    this.model.assemble(T, stage, this.rhs);
    const tb = nowMs();
    // preconditioner key: process stage and solder regime (the solidus changes the matrix abruptly)
    const key = stage + (T > this.solidus ? 'm' : 's');
    const res = this.solver.solve(this.rhs, label || ('T=' + T + ' stage ' + stage), key);
    res.assembleMs = tb - ta;
    res.T = T; res.stage = stage;
    this.timings.assemble = (this.timings.assemble || 0) + res.assembleMs;
    this.timings.solve = (this.timings.solve || 0) + res.ms;
    if (!res.converged) throw new Error('Linear solver did not converge (' + label + '): relative residual ' + res.relres.toExponential(2));
    return res;
  }

  /** Process sequence: birth states of stages 1..finalStage. */
  runStages() {
    const p = this.cfg.process, m = this.model;
    const t0 = nowMs();
    // S1: die and solder born at T_join from the substrate state at T_join
    this.progress(0.02, 'Stage S0: substrate at T_join');
    if (Math.abs(p.Tsub - p.Tjoin) > 1e-9) {
      const r = this.solveAt(p.Tjoin, 0, 'S0 substrate at T_join');
      m.recordBirth(1, p.Tjoin, r.u);
    } else {
      this.notes.push('T_sub = T_join: the free substrate is strain-free at chip join, so the die and solder birth strains are zero.');
    }
    this.progress(0.08, 'Stage S1: chip join state at T_UF');
    const r1 = this.solveAt(p.Tuf, 1, 'S1 chip-join state at T_UF');
    m.recordBirth(2, p.Tuf, r1.u);
    if (this.finalStage === 3) {
      this.progress(0.14, 'Stage S2: underfilled state at T_attach');
      const r2 = this.solveAt(p.Tattach, 2, 'S2 underfilled state at T_attach');
      m.recordBirth(3, p.Tattach, r2.u);
    }
    this.timings.stages = nowMs() - t0;
  }

  /** Evaluation temperature list for the as-assembled stage. */
  evaluationTemperatures() {
    const c = this.cfg, kind = this.opts.evaluations;
    if (kind === 'preview') return { all: [25], cycling: [], reflow: [25] };
    const cyc = temperatureSamples(c.cycling.Tmin, c.cycling.Tmax, this.tgs, [25]);
    const solidus = pv(findMaterial(c.materials, c.bump.solder).solidus || { v: 217 });
    // reflow sweep: 15 degC steps above the cycling range, refined to 10 degC near a Tg, plus report temperatures and the solidus
    const ref = [];
    const set = new Set([25, c.reflow.peak, solidus, solidus + 1].concat(c.reflow.reportTemps));
    for (let T = Math.ceil(c.cycling.Tmax / CONST.REFLOW_DT) * CONST.REFLOW_DT; T <= c.reflow.peak; T += CONST.REFLOW_DT) set.add(T);
    for (const tg of this.tgs) for (let T = Math.ceil((tg - CONST.CYCLE_TG_BAND) / CONST.REFLOW_DT_FINE) * CONST.REFLOW_DT_FINE; T <= tg + CONST.CYCLE_TG_BAND; T += CONST.REFLOW_DT_FINE) set.add(T);
    for (const T of set) if (T >= 25 && T <= c.reflow.peak) ref.push(T);
    ref.sort((a, b) => a - b);
    const all = Array.from(new Set(cyc.concat(ref))).sort((a, b) => a - b);
    return { all, cycling: cyc, reflow: ref };
  }

  /** Run everything: stages, evaluations, CPI state. */
  run() {
    const tAll = nowMs();
    if (!this.mesh) this.build();
    this.runStages();
    const temps = this.evaluationTemperatures();
    this.temps = temps;
    this.fields = new Map(); // T -> displacement field (as-assembled stage)
    const n = temps.all.length;
    // evaluate 25 first (best warm start for the rest), then ascending from 25 up, then descending below 25
    const order = [25].concat(temps.all.filter(T => T > 25), temps.all.filter(T => T < 25).reverse());
    order.forEach((T, i) => {
      this.progress(0.18 + 0.7 * i / n, 'As-assembled state at ' + T + ' °C (' + (i + 1) + '/' + n + ')');
      const r = this.solveAt(T, this.finalStage, 'as-assembled ' + T + ' °C');
      this.fields.set(T, r.u);
    });
    if (!this.opts.quick) {
      this.progress(0.9, 'Chip-join state at 25 °C (CPI proxy)');
      this.uCPI = this.solveAt(25, 1, 'chip join only, 25 °C').u;
    }
    this.timings.total = nowMs() - tAll;
    this.progress(0.92, 'Post-processing');
    return this;
  }

  /** Displacement field at any T of the cycle by piecewise-linear interpolation in T. */
  fieldAt(T, out) {
    const ts = this.temps.all;
    const i = findInterval(ts, T);
    const a = this.fields.get(ts[i]), b = this.fields.get(ts[i + 1]);
    const t = clamp((T - ts[i]) / (ts[i + 1] - ts[i]), 0, 1);
    out = out || new Float64Array(a.length);
    for (let q = 0; q < a.length; q++) out[q] = a[q] + t * (b[q] - a[q]);
    return out;
  }
}
