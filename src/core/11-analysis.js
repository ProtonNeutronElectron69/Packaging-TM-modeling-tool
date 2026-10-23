// ===== Global analysis driver: thermal path, evaluations (Section 6.5, 9.2) ====

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

/** Tg values (degC) of every material used by the model (mesh or model groups). */
function modelTgs(cfg, groups) {
  const out = [];
  const seen = new Set();
  const add = id => { if (!id || seen.has(id)) return; seen.add(id); for (const t of materialTgs(findMaterial(cfg.materials, id))) out.push(t.T); };
  for (const g of groups) add(g.mat);
  for (const r of cfg.substrate.layers) { add(r.mat); add(r.fill); }
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
 * Points of the thermal path from Ta to Tb (either direction): steps of at most
 * INC_DT_MAX, at most INC_DT_TG where a step meets the INC_TG_BAND window of
 * any Tg, and every temperature of `stops` strictly between Ta and Tb
 * (evaluation temperatures, the solder solidus). With the midpoint stiffness
 * these steps integrate E alpha dT of the default polymers through their glass
 * transitions to about 1.5 % (the secant form is off by 50 to 1100 %).
 */
function thermalPathPoints(Ta, Tb, tgs, stops) {
  const dir = Math.sign(Tb - Ta), pts = [Ta];
  if (dir === 0) return pts;
  const inner = (stops || []).filter(T => (T - Ta) * dir > 1e-9 && (Tb - T) * dir > 1e-9).sort((a, b) => dir * (a - b));
  inner.push(Tb);
  let T = Ta;
  for (const S of inner) {
    while ((S - T) * dir > 1e-9) {
      const lo = Math.min(T, T + dir * CONST.INC_DT_MAX), hi = Math.max(T, T + dir * CONST.INC_DT_MAX);
      const h = tgs.some(tg => tg + CONST.INC_TG_BAND > lo && tg - CONST.INC_TG_BAND < hi) ? CONST.INC_DT_TG : CONST.INC_DT_MAX;
      const next = Math.round((T + dir * h) * 1e6) / 1e6;
      T = (S - next) * dir > 1e-9 ? next : S;
      pts.push(T);
    }
  }
  return pts;
}

/** Short label of one step of the thermal path. */
function stepLabel(s) {
  const what = s.branch === 'chain' ? 'S' + s.stage : (s.branch === 'cpi' ? 'chip join' : 'sweep');
  return what + ' ' + s.Ta + ' -> ' + s.Tb + ' °C';
}

/**
 * Global thermomechanical analysis of a configuration at a fidelity preset.
 * opts: {preset, hmin, hmax, cap, progress(fn), cancelled(fn), precond,
 *        evaluations: 'full' | 'preview' | 'sensitivity'}
 *
 * The thermal path (incremental thermoelasticity, Section 6.5 as amended):
 *   chain  T_sub -> T_join (S0, substrate only, when they differ), T_join -> T_UF
 *          (S1: die and solder), T_UF -> T_attach (S2: underfill) and
 *          T_attach -> 25 degC (S3: lid or stiffener; bare dies go T_UF -> 25 in S2)
 *   cpi    T_UF -> 25 degC in S1 (chip-join state before underfill, CPI proxy)
 *   up     25 degC -> the hottest evaluation temperature, final stage
 *   down   25 degC -> the coldest evaluation temperature, final stage
 * Each step is one linear solve; the state at an evaluation temperature is the
 * sum of the chain and the branch steps leading to it.
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
    this.solver = new LinearSolver(this.model, { precond: this.opts.precond, tol: CONST.PCG_TOL, mg: { planeSeg: this.planeSeg }, log: r => this.log.push(r) });
    this.rhs = new Float64Array(this.model.ndof);
    this.setupPath(this.mesh.groups);
    return this;
  }

  /** Data the thermal path needs: final process stage, Tg values of the model's materials, solder solidus. */
  setupPath(groups) {
    this.finalStage = this.cfg.packageType === 'bare' ? 2 : 3;
    this.tgs = modelTgs(this.cfg, groups);
    this.solidus = pv(findMaterial(this.cfg.materials, this.cfg.bump.solder).solidus || { v: 217 });
    return this;
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

  /** The steps of the thermal path (see the class comment) and the evaluation temperatures. */
  buildPath() {
    const p = this.cfg.process, fin = this.finalStage;
    const temps = this.evaluationTemperatures();
    this.temps = temps;
    const steps = [];
    const seg = (Ta, Tb, stage, branch, stops) => {
      const pts = thermalPathPoints(Ta, Tb, this.tgs, (stops || []).concat([this.solidus]));
      const ids = [];
      for (let k = 1; k < pts.length; k++) { steps.push({ Ta: pts[k - 1], Tb: pts[k], stage, branch }); ids.push(steps.length - 1); }
      return ids;
    };
    // solve order: the chain, then both sweep branches in the final stage (down first, so the matrix structure
    // continues from the last chain stage), then the chip-join branch; the preconditioner is rebuilt only where
    // the stage or the solder regime changes
    const s0 = Math.abs(p.Tsub - p.Tjoin) > 1e-9 ? seg(p.Tsub, p.Tjoin, 0, 'chain') : [];
    const s1 = seg(p.Tjoin, p.Tuf, 1, 'chain');
    const rest = fin === 3 ? seg(p.Tuf, p.Tattach, 2, 'chain').concat(seg(p.Tattach, 25, 3, 'chain')) : seg(p.Tuf, 25, 2, 'chain');
    const ev = temps.all;
    const down = seg(25, Math.min(25, ...ev), fin, 'down', ev), up = seg(25, Math.max(25, ...ev), fin, 'up', ev);
    // the chip-join state is needed for the bump loads of a full analysis only
    const cpi = this.opts.evaluations === 'full' ? seg(p.Tuf, 25, 1, 'cpi') : [];
    this.path = { steps, chain: s0.concat(s1, rest), chainJoin: s0.concat(s1), cpi, up, down, hasCPI: this.opts.evaluations === 'full' };
    this.du = new Array(steps.length).fill(null);
    this.rec = new Array(steps.length).fill(null);
    return steps;
  }

  /** One step of the path: assemble K(Tm) and the thermal-strain increment load, solve. */
  solveStep(k) {
    this.checkCancel();
    const s = this.path.steps[k];
    const ta = nowMs();
    this.model.assembleStep(s.Ta, s.Tb, s.stage, this.rhs);
    const tb = nowMs();
    // preconditioner key: process stage and solder regime (the solidus changes the matrix abruptly)
    const key = s.stage + (0.5 * (s.Ta + s.Tb) > this.solidus ? 'm' : 's');
    const label = stepLabel(s);
    const res = this.solver.solve(this.rhs, label, key);
    res.assembleMs = tb - ta;
    res.T = s.Tb; res.stage = s.stage; res.step = k;
    this.timings.assemble = (this.timings.assemble || 0) + res.assembleMs;
    this.timings.solve = (this.timings.solve || 0) + res.ms;
    if (!res.converged) throw new Error('Linear solver did not converge (' + label + '): relative residual ' + res.relres.toExponential(2));
    return res;
  }

  /** Run every step in this thread, then sum them up. */
  run() {
    this.tAll = nowMs();
    if (!this.mesh) this.build();
    const steps = this.buildPath(), n = steps.length;
    steps.forEach((s, k) => { this.progress(0.02 + 0.86 * k / n, 'Thermal path: ' + stepLabel(s) + ' (' + (k + 1) + '/' + n + ')'); this.du[k] = this.solveStep(k).u; });
    return this.finishPath();
  }

  /**
   * Totals from the solved steps: displacement fields at every evaluation
   * temperature and in the chip-join state; the increments are then kept in
   * single precision for the stress histories.
   */
  finishPath() {
    const P = this.path, n = this.model.ndof, all = new Set(this.temps.all);
    const add = (u, k) => { const d = this.du[k]; for (let i = 0; i < n; i++) u[i] += d[i]; };
    const u = new Float64Array(n);
    for (const k of P.chain) add(u, k);
    this.fields = new Map([[25, Float64Array.from(u)]]);
    for (const br of [P.up, P.down]) {
      const v = Float64Array.from(u);
      for (const k of br) { add(v, k); if (all.has(P.steps[k].Tb)) this.fields.set(P.steps[k].Tb, Float64Array.from(v)); }
    }
    if (P.hasCPI) {
      const c = new Float64Array(n);
      for (const k of P.chainJoin.concat(P.cpi)) add(c, k);
      this.uCPI = c;
    } else this.uCPI = null;
    for (let k = 0; k < this.du.length; k++) this.du[k] = Float32Array.from(this.du[k]);
    this.ck25 = new Map();
    this.timings.total = nowMs() - (this.tAll || nowMs());
    this.progress(0.92, 'Post-processing');
    return this;
  }

  /** Per-step recovery data (computed on first use). */
  recAt(k) {
    if (!this.rec[k]) { const s = this.path.steps[k]; this.rec[k] = this.model.stepRecovery(s.Ta, s.Tb, s.stage); }
    return this.rec[k];
  }

  /** Stress history state of element e after the given steps, starting from `init` (or zero). */
  elementHistory(e, ids, init, qOnly) {
    const st = init ? Float64Array.from(init) : new Float64Array(this.model.stateSize(e));
    for (const k of ids) this.model.accumulateStep(e, this.recAt(k), this.du[k], st, qOnly);
    return st;
  }

  /** As-assembled state at 25 degC (end of the chain) of element e, cached. */
  state25(e) {
    let st = this.ck25.get(e);
    if (!st) { st = this.elementHistory(e, this.path.chain); this.ck25.set(e, st); }
    return st;
  }

  /** Step indices of a branch from 25 degC up to (and including) the step ending at T, or null if T is not on it. */
  branchTo(T) {
    if (T === 25) return [];
    const br = T > 25 ? this.path.up : this.path.down, out = [];
    for (const k of br) { out.push(k); if (this.path.steps[k].Tb === T) return out; }
    return null;
  }

  /** View of the solution at T for post-processing: 'final' (as-assembled) or 'cpi' (chip-join state at 25 degC). */
  view(T, which) { return new StateView(this, T, which || 'final'); }

  /**
   * Element DOFs q (33) at each of the given as-assembled temperatures, marched
   * along both branches from the 25 degC state (bump screening). Map T -> q.
   */
  qAlong(e, temps) {
    const want = new Set(temps), out = new Map(), hi = Math.max(...temps), lo = Math.min(...temps);
    const base = this.state25(e).subarray(0, 33);
    if (want.has(25)) out.set(25, Float64Array.from(base));
    const st = new Float64Array(this.model.stateSize(e));
    for (const [br, end] of [[this.path.up, hi], [this.path.down, lo]]) {
      if (end === 25) continue;
      st.fill(0); st.set(base);
      for (const k of br) {
        this.model.accumulateStep(e, this.recAt(k), this.du[k], st, true);
        const T = this.path.steps[k].Tb;
        if (want.has(T)) out.set(T, st.slice(0, 33));
        if (T === end) break;
      }
    }
    return out;
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

/**
 * The solution at one temperature for post-processing: total displacement u and
 * per-element stress states built on demand from the steps of the path that
 * lead there (the 25 degC states are shared). A temperature between two
 * evaluation temperatures blends their two views linearly.
 */
class StateView {
  constructor(an, T, which) {
    this.an = an; this.model = an.model; this.T = T; this.which = which;
    this.cache = new Map();
    if (which === 'cpi') { this.u = an.uCPI; this.ids = an.path.chainJoin.concat(an.path.cpi); return; }
    this.ids = an.branchTo(T);
    if (this.ids) { this.u = an.fields.get(T); return; }
    // between evaluation temperatures: blend the neighbouring views
    const ts = an.temps.all, i = findInterval(ts, T);
    this.blend = { a: an.view(ts[i]), b: an.view(ts[i + 1]), t: clamp((T - ts[i]) / (ts[i + 1] - ts[i]), 0, 1) };
    this.u = an.fieldAt(T);
    this._o = { eps: new Float64Array(6), sig: new Float64Array(6) };
  }

  /** History state of element e (as-assembled views reuse the shared 25 degC state). */
  state(e) {
    let st = this.cache.get(e);
    if (!st) {
      st = this.which === 'cpi' ? this.an.elementHistory(e, this.ids) : (this.ids.length ? this.an.elementHistory(e, this.ids, this.an.state25(e)) : this.an.state25(e));
      this.cache.set(e, st);
    }
    return st;
  }

  /** Stress and total strain of element e at natural point (xi, eta, zeta). */
  point(e, xi, eta, zeta, out) {
    out = out || { eps: new Float64Array(6), sig: new Float64Array(6) };
    if (!this.blend) return this.model.stateStress(e, this.state(e), xi, eta, zeta, out);
    const B = this.blend, o = this._o;
    B.a.point(e, xi, eta, zeta, out); B.b.point(e, xi, eta, zeta, o);
    for (let c = 0; c < 6; c++) { out.sig[c] += B.t * (o.sig[c] - out.sig[c]); out.eps[c] += B.t * (o.eps[c] - out.eps[c]); }
    return out;
  }
}
