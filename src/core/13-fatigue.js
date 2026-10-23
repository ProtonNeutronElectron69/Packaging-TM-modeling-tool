// ===== Solder fatigue: Anand model, screening, bump submodel (Section 9) ====

/**
 * Anand viscoplastic material point (Section 9.4), integrated by backward
 * Euler with J2 radial return:
 *   ep_dot = A [sinh(xi sigma / s)]^(1/m) exp(-Q/(R T))
 *   s_dot  = h0 |B|^a sign(B) ep_dot,  B = 1 - s / s*,
 *   s*     = s_hat [(ep_dot / A) exp(Q/(R T))]^n
 * Strain input is the mechanical (total minus thermal) engineering strain
 * [exx, eyy, ezz, gxy, gyz, gzx]; stresses are returned in the same order.
 * The plastic strain is stored with tensorial shear components.
 */
class AnandPoint {
  constructor(mat) {
    const a = mat.anand;
    this.A = pv(a.A); this.QR = pv(a.QR); this.xi = pv(a.xi); this.m = pv(a.m); this.shat = pv(a.shat);
    this.n = pv(a.n); this.h0 = pv(a.h0); this.a = pv(a.a); this.s0 = pv(a.s0);
    this.mat = mat;
    this.nu = pv(mat.elastic.nu);
    this.tables = materialTables(mat);
    this.ep = new Float64Array(6);
    this.reset();
    this._trial = { ep: new Float64Array(6), s: 0, ebar: 0, W: 0, sigEq: 0, dEbar: 0 };
  }

  reset() { this.ep.fill(0); this.s = this.s0; this.ebar = 0; this.W = 0; this.sigEq = 0; this._lastD = 0; }

  E(T) { return gridAt(this.tables.E, T); }
  thermalStrain(T) { return gridAt(this.tables.F, T); }

  /** Deformation resistance s_{n+1} for a given plastic increment d (inner scalar solve). */
  _solveS(d, dt, expQ) {
    if (d <= 0) return this.s;
    const sstar = this.shat * Math.pow(d / (dt * this.A) * expQ, this.n);
    const sn = this.s, h0 = this.h0, a = this.a;
    const phi = s => { const B = 1 - s / sstar; return s - sn - h0 * Math.pow(Math.abs(B), a) * Math.sign(B) * d; };
    let lo = Math.min(sn, sstar), hi = Math.max(sn, sstar);
    if (hi - lo < 1e-14) return sn;
    let s = 0.5 * (lo + hi);
    for (let it = 0; it < CONST.ANAND_NEWTON_MAXIT; it++) {
      const f = phi(s);
      if (Math.abs(f) < CONST.ANAND_TOL * Math.max(1, sn)) break;
      if (f > 0) hi = s; else lo = s;
      const B = 1 - s / sstar;
      const dphi = 1 + h0 * a * Math.pow(Math.abs(B), a - 1) * d / sstar;
      let sn1 = s - f / dphi;
      if (!(sn1 > lo && sn1 < hi)) sn1 = 0.5 * (lo + hi);
      if (Math.abs(sn1 - s) < 1e-15 * Math.max(1, s)) { s = sn1; break; }
      s = sn1;
    }
    return s;
  }

  /**
   * Trial step from the committed state: mechanical strain eps (engineering),
   * temperature T (degC), time increment dt (s). Fills out.sig (6) and, when
   * requested, out.D (36, consistent tangent). The result is committed with
   * commit(). Returns the equivalent plastic strain increment.
   */
  /** Temperature-dependent constants shared by every material point at one time step. */
  stepConstants(T, dt) {
    const E = this.E(T), nu = this.nu;
    const expQ = Math.exp(this.QR / (T + CONST.KELVIN));
    return { G: E / (2 * (1 + nu)), K: E / (3 * (1 - 2 * nu)), expQ, rate0: dt * this.A / expQ, dt };
  }

  step(eps, T, dt, out, wantTangent, k) {
    k = k || this.stepConstants(T, dt);
    const G = k.G, K = k.K, expQ = k.expQ, rate0 = k.rate0;
    const vol = (eps[0] + eps[1] + eps[2]) / 3;
    // deviatoric mechanical strain (tensor shear) minus plastic strain
    const e = this._e || (this._e = new Float64Array(6));
    e[0] = eps[0] - vol - this.ep[0]; e[1] = eps[1] - vol - this.ep[1]; e[2] = eps[2] - vol - this.ep[2];
    e[3] = 0.5 * eps[3] - this.ep[3]; e[4] = 0.5 * eps[4] - this.ep[4]; e[5] = 0.5 * eps[5] - this.ep[5];
    const str = this._str || (this._str = new Float64Array(6));
    for (let i = 0; i < 6; i++) str[i] = 2 * G * e[i];
    const nrm = Math.sqrt(str[0] * str[0] + str[1] * str[1] + str[2] * str[2] + 2 * (str[3] * str[3] + str[4] * str[4] + str[5] * str[5]));
    const sigTr = Math.sqrt(1.5) * nrm;
    const tr = this._trial;
    let d = 0, s1 = this.s, dDdSig = 0;
    if (sigTr > 1e-14 && dt > 0) {
      // outer scalar solve: g(d) = d - rate0 sinh(xi (sigTr - 3 G d) / s(d))^(1/m) = 0 on [0, sigTr / 3G]
      const dmax = sigTr / (3 * G);
      const g = dd => {
        const s = this._solveS(dd, dt, expQ);
        const x = this.xi * (sigTr - 3 * G * dd) / s;
        const sh = Math.sinh(x);
        return { g: dd - rate0 * Math.pow(sh, 1 / this.m), s, x, sh };
      };
      let lo = 0, hi = dmax;
      let dd = this._lastD > 0 && this._lastD < dmax ? this._lastD : Math.min(dmax, rate0 * Math.pow(Math.sinh(this.xi * sigTr / this.s), 1 / this.m));
      if (!isFinite(dd) || dd <= 0) dd = 0.5 * dmax;
      let res = null;
      for (let it = 0; it < CONST.ANAND_NEWTON_MAXIT; it++) {
        res = g(dd);
        if (!isFinite(res.g)) { lo = dd; dd = 0.5 * (lo + hi); continue; }
        if (Math.abs(res.g) < CONST.ANAND_TOL * Math.max(dmax, 1e-30)) break;
        if (res.g > 0) hi = dd; else lo = dd;
        // derivative: dg/dd = 1 + f_x xi (3G/s + sigma ds/dd / s^2)
        const fx = rate0 * (1 / this.m) * Math.pow(res.sh, 1 / this.m - 1) * Math.cosh(res.x);
        const dsdd = this._dsdd(dd, res.s, dt, expQ);
        const sig = sigTr - 3 * G * dd;
        const dg = 1 + fx * this.xi * (3 * G / res.s + sig * dsdd / (res.s * res.s));
        let dn = dd - res.g / dg;
        if (!(dn > lo && dn < hi) || !isFinite(dn)) dn = 0.5 * (lo + hi);
        if (Math.abs(dn - dd) < 1e-16 * Math.max(dmax, 1e-30)) { dd = dn; break; }
        dd = dn;
      }
      d = dd; s1 = res.s;
      this._lastD = d;
      if (wantTangent) {
        const fx = rate0 * (1 / this.m) * Math.pow(res.sh, 1 / this.m - 1) * Math.cosh(res.x);
        const dsdd = this._dsdd(dd, res.s, dt, expQ);
        const sig = sigTr - 3 * G * dd;
        const dg = 1 + fx * this.xi * (3 * G / res.s + sig * dsdd / (res.s * res.s));
        dDdSig = (fx * this.xi / res.s) / dg; // d(delta ebar_p)/d(sigma_trial)
      }
    }
    // update
    const theta = sigTr > 1e-14 ? 1 - 3 * G * d / sigTr : 1;
    const nvec = this._n || (this._n = new Float64Array(6));
    if (nrm > 0) for (let i = 0; i < 6; i++) nvec[i] = str[i] / nrm; else nvec.fill(0);
    const dg = Math.sqrt(1.5) * d; // tensor plastic increment magnitude
    for (let i = 0; i < 6; i++) tr.ep[i] = this.ep[i] + dg * nvec[i];
    const sm = 3 * K * vol;
    out.sig[0] = theta * str[0] + sm; out.sig[1] = theta * str[1] + sm; out.sig[2] = theta * str[2] + sm;
    out.sig[3] = theta * str[3]; out.sig[4] = theta * str[4]; out.sig[5] = theta * str[5];
    const sigEq = sigTr - 3 * G * d;
    tr.s = s1; tr.ebar = this.ebar + d; tr.W = this.W + 0.5 * (this.sigEq + sigEq) * d; tr.sigEq = sigEq; tr.dEbar = d;
    if (wantTangent) {
      // D = K 1x1 + 2 G theta I_dev - 2 G theta_bar n x n (Voigt, engineering shear)
      const D = out.D;
      const thetaBar = 2 * G * 1.5 * dDdSig - (1 - theta);
      const c1 = 2 * G * theta, c2 = 2 * G * thetaBar;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        let v = -c2 * nvec[i] * nvec[j];
        if (i < 3 && j < 3) v += K + c1 * ((i === j ? 1 : 0) - 1 / 3);
        else if (i === j) v += 0.5 * c1;
        D[i * 6 + j] = v;
      }
    }
    return d;
  }

  /**
   * Step of a free-standing solder column (screening, Section 9.1 as amended):
   * the axial and transverse shear strains (zz, yz, zx of eps) are prescribed and
   * the in-plane strains (xx, yy, xy) are found by Newton on the consistent
   * tangent so that the in-plane stresses vanish, since a separate joint carries
   * no in-plane membrane force. eps holds the in-plane guess on entry and the
   * solution on return; out needs sig and D. Returns the plastic increment.
   */
  stepColumn(eps, T, dt, out, k) {
    const P = [0, 1, 3], A = this._colA || (this._colA = new Float64Array(9)), Ai = this._colAi || (this._colAi = new Float64Array(9));
    let d = 0;
    for (let it = 0; it < CONST.COLUMN_NEWTON_MAXIT; it++) {
      d = this.step(eps, T, dt, out, true, k);
      const r0 = out.sig[0], r1 = out.sig[1], r2 = out.sig[3];
      const ref = Math.max(1, Math.abs(out.sig[2]), Math.abs(out.sig[4]), Math.abs(out.sig[5]));
      if (Math.max(Math.abs(r0), Math.abs(r1), Math.abs(r2)) < CONST.COLUMN_STRESS_TOL * ref) break;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[3 * r + c] = out.D[6 * P[r] + P[c]];
      inv3(A, Ai);
      for (let r = 0; r < 3; r++) eps[P[r]] -= Ai[3 * r] * r0 + Ai[3 * r + 1] * r1 + Ai[3 * r + 2] * r2;
    }
    return d;
  }

  /** ds/d(delta ebar_p) from the implicit evolution equation. */
  _dsdd(d, s, dt, expQ) {
    if (d <= 0) return 0;
    const sstar = this.shat * Math.pow(d / (dt * this.A) * expQ, this.n);
    const B = 1 - s / sstar;
    const absB = Math.abs(B), sgn = Math.sign(B);
    const h0 = this.h0, a = this.a, n = this.n;
    const dphi_ds = 1 + h0 * a * Math.pow(absB, a - 1) * d / sstar;
    const dphi_dd = -h0 * Math.pow(absB, a) * sgn - h0 * a * Math.pow(absB, a - 1) * s * n / sstar;
    return -dphi_dd / dphi_ds;
  }

  /** Stress at the committed plastic strain for mechanical strain eps, with no further flow (state untouched). */
  stressAt(eps, T, sig) {
    const E = this.E(T), G = E / (2 * (1 + this.nu)), K = E / (3 * (1 - 2 * this.nu));
    const vol = (eps[0] + eps[1] + eps[2]) / 3, sm = 3 * K * vol, ep = this.ep;
    for (let i = 0; i < 3; i++) sig[i] = 2 * G * (eps[i] - vol - ep[i]) + sm;
    for (let i = 3; i < 6; i++) sig[i] = 2 * G * (0.5 * eps[i] - ep[i]);
    return sig;
  }

  commit() {
    const tr = this._trial;
    this.ep.set(tr.ep); this.s = tr.s; this.ebar = tr.ebar; this.W = tr.W; this.sigEq = tr.sigEq;
  }

  /** Copy of the committed state (for cutbacks). */
  save() { return { ep: Float64Array.from(this.ep), s: this.s, ebar: this.ebar, W: this.W, sigEq: this.sigEq }; }
  restore(st) { this.ep.set(st.ep); this.s = st.s; this.ebar = st.ebar; this.W = st.W; this.sigEq = st.sigEq; }
}

/** Closed-form Anand saturation stress under constant strain rate (V6). */
function anandSaturationStress(mat, T, rate) {
  const a = mat.anand;
  const TK = T + CONST.KELVIN;
  const z = rate / pv(a.A) * Math.exp(pv(a.QR) / TK);
  const sstar = pv(a.shat) * Math.pow(z, pv(a.n));
  return sstar / pv(a.xi) * Math.asinh(Math.pow(z, pv(a.m)));
}

/**
 * Uniaxial constant strain-rate test of the Anand point with free lateral
 * strains (sigma_22 = sigma_33 = 0 enforced by Newton with the tangent).
 */
function anandUniaxial(mat, T, rate, epsMax, nsteps) {
  const pt = new AnandPoint(mat);
  const eps = new Float64Array(6), out = { sig: new Float64Array(6), D: new Float64Array(36) };
  const dt = epsMax / rate / nsteps;
  const hist = [];
  let lat = 0;
  for (let k = 1; k <= nsteps; k++) {
    eps[0] = rate * dt * k;
    for (let it = 0; it < 30; it++) {
      eps[1] = eps[2] = lat;
      pt.step(eps, T, dt, out, true);
      const r = out.sig[1];
      if (Math.abs(r) < 1e-9 * Math.max(1, Math.abs(out.sig[0]))) break;
      const dr = out.D[7] + out.D[8]; // d sigma_22 / d lat (eps_22 = eps_33 = lat)
      lat -= r / dr;
    }
    pt.commit();
    hist.push({ eps: eps[0], sig: out.sig[0], s: pt.s, t: dt * k });
  }
  return { hist, sigFinal: hist[hist.length - 1].sig, sMax: pt.s };
}

/** Temperature-cycle time history (Section 9.3): times in s, temperatures in degC. */
function cycleHistory(cyc) {
  const Tmin = cyc.Tmin, Tmax = cyc.Tmax, rate = cyc.ramp / 60, dwell = cyc.dwell * 60;
  const t = [0], T = [25], cycle = [0], phase = ['start'];
  let time = 0;
  const ramp = (from, to, c) => {
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / CONST.RAMP_MAX_DT));
    const dur = Math.abs(to - from) / rate;
    for (let k = 1; k <= n; k++) { time += dur / n; t.push(time); T.push(from + (to - from) * k / n); cycle.push(c); phase.push(to > from ? 'ramp up' : 'ramp down'); }
  };
  const hold = (Tv, c, label) => {
    const n = CONST.DWELL_MIN_STEPS;
    for (let k = 1; k <= n; k++) { time += dwell / n; t.push(time); T.push(Tv); cycle.push(c); phase.push(label); }
  };
  for (let c = 1; c <= cyc.cycles; c++) {
    ramp(T[T.length - 1], Tmax, c); hold(Tmax, c, 'dwell hot');
    ramp(Tmax, Tmin, c); hold(Tmin, c, 'dwell cold');
  }
  return { t: Float64Array.from(t), T: Float64Array.from(T), cycle: Int32Array.from(cycle), phase, cycles: cyc.cycles };
}

/** Bump sites kept for screening (subsampled above SCREEN_MAX_BUMPS). */
function screeningSites(d) {
  const all = dieBumpSites(d);
  const n = all.x.length;
  if (n <= CONST.SCREEN_MAX_BUMPS) return { sites: all, idx: null, subsampled: false };
  const keep = [];
  const must = q => all.row[q] < CONST.SCREEN_KEEP_ROWS || ((all.ix[q] < CONST.SCREEN_CORNER_BLOCK || all.ix[q] >= d.nbx - CONST.SCREEN_CORNER_BLOCK) && (all.iy[q] < CONST.SCREEN_CORNER_BLOCK || all.iy[q] >= d.nby - CONST.SCREEN_CORNER_BLOCK));
  const rest = [];
  for (let q = 0; q < n; q++) { if (must(q)) keep.push(q); else rest.push(q); }
  const budget = Math.max(0, CONST.SCREEN_MAX_BUMPS - keep.length);
  const stride = rest.length / Math.max(budget, 1);
  for (let k = 0; k < budget && k * stride < rest.length; k++) keep.push(rest[Math.floor(k * stride)]);
  keep.sort((a, b) => a - b);
  const pick = arr => Float64Array.from(keep.map(q => arr[q]));
  const picki = arr => Int32Array.from(keep.map(q => arr[q]));
  return { sites: { x: pick(all.x), y: pick(all.y), ix: picki(all.ix), iy: picki(all.iy), row: picki(all.row) }, idx: Int32Array.from(keep), subsampled: true };
}

/**
 * Bump-layer total strain (engineering) at every site for every cycling
 * sample temperature of the analysis: Float64Array(nsites x ntemps x 6), from
 * the element DOFs marched along the thermal path (Analysis.qAlong).
 */
function siteStrainTable(an, dieIdx, sites, temps) {
  const mesh = an.mesh, model = an.model, g = mesh.geom;
  const n = sites.x.length, nt = temps.length;
  const out = new Float64Array(n * nt * 6).fill(NaN);
  const zmid = g.zt + 0.5 * g.so, kb = findInterval(mesh.zs, zmid);
  const byElem = new Map();
  for (let q = 0; q < n; q++) {
    const i = findInterval(mesh.xs, sites.x[q]), j = findInterval(mesh.ys, sites.y[q]);
    const e = elementInCell(mesh, i, j, kb, PART.SOLDER);
    if (e < 0) continue;
    if (!byElem.has(e)) byElem.set(e, []);
    byElem.get(e).push(q);
  }
  const eps = new Float64Array(6);
  for (const [e, list] of byElem) {
    const qs = an.qAlong(e, temps);
    const [hx, hy, hz] = model.elementDims(e);
    for (let ti = 0; ti < nt; ti++) {
      const qv = qs.get(temps[ti]);
      if (!qv) continue;
      for (const q of list) {
        const [xi, eta, zeta] = naturalCoords(mesh, e, sites.x[q], sites.y[q], zmid);
        boxStrainAt(hx, hy, hz, qv, qv.subarray(24), xi, eta, zeta, eps);
        out.set(eps, (q * nt + ti) * 6);
      }
    }
  }
  return out;
}

/**
 * Screening (Section 9.1, as amended): Anand integration at every bump site
 * through the cycle, the joint seen as a free-standing column between its two
 * pads. Its axial strain (the bump layer's ezz minus the solder thermal strain)
 * and transverse shear strains (gyz, gzx) follow the global bump layer, while
 * its in-plane stresses are held at zero (AnandPoint.stepColumn), so the joint
 * is not forced to take the die's in-plane strain as an iso-strain point would.
 * Returns per-site stabilized-cycle inelastic work density and equivalent
 * strain range.
 */
function screenBumps(an, dieIdx, opts) {
  const cfg = an.cfg, g = an.mesh.geom, d = g.dies[dieIdx];
  const t0 = nowMs();
  const { sites, subsampled } = screeningSites(d);
  const temps = an.temps.cycling;
  const table = siteStrainTable(an, dieIdx, sites, temps);
  const solder = findMaterial(cfg.materials, cfg.bump.solder);
  const hist = cycleHistory(cfg.cycling);
  const n = sites.x.length, nt = temps.length, nsteps = hist.t.length;
  const dW = new Float64Array(n).fill(NaN), dE = new Float64Array(n).fill(NaN), stab = new Float64Array(n).fill(NaN);
  const pt = new AnandPoint(solder);
  const out = { sig: new Float64Array(6), D: new Float64Array(36) };
  const eps = new Float64Array(6), e25 = new Float64Array(6), prevZ = { v: 0 };
  const nu = pt.nu;
  const i25 = temps.indexOf(25);
  // per-step interpolation weights in the temperature table
  const wi = new Int32Array(nsteps), wt = new Float64Array(nsteps), Fth = new Float64Array(nsteps), kc = [];
  for (let k = 0; k < nsteps; k++) {
    const i = findInterval(temps, hist.T[k]);
    wi[k] = i; wt[k] = clamp((hist.T[k] - temps[i]) / (temps[i + 1] - temps[i]), 0, 1);
    Fth[k] = pt.thermalStrain(hist.T[k]) - pt.thermalStrain(25);
    kc.push(k > 0 ? pt.stepConstants(hist.T[k], hist.t[k] - hist.t[k - 1]) : null);
  }
  const Wc = new Float64Array(hist.cycles + 1), Ec = new Float64Array(hist.cycles + 1);
  for (let q = 0; q < n; q++) {
    const base = q * nt * 6;
    if (!isFinite(table[base])) continue;
    pt.reset();
    for (let c = 0; c < 6; c++) e25[c] = i25 >= 0 ? table[base + i25 * 6 + c] : 0;
    Wc.fill(0); Ec.fill(0);
    eps.fill(0); prevZ.v = 0;
    for (let k = 1; k < nsteps; k++) {
      const a = base + wi[k] * 6, b = a + 6, t = wt[k];
      const lay = c => table[a + c] + t * (table[b + c] - table[a + c]) - e25[c];
      const ez = lay(2) - Fth[k];
      // in-plane guess: last step's strains plus the elastic lateral contraction of the axial increment
      eps[0] -= nu * (ez - prevZ.v); eps[1] -= nu * (ez - prevZ.v);
      eps[2] = ez; eps[4] = lay(4); eps[5] = lay(5); prevZ.v = ez;
      pt.stepColumn(eps, hist.T[k], kc[k].dt, out, kc[k]);
      pt.commit();
      const cyc = hist.cycle[k];
      Wc[cyc] = pt.W; Ec[cyc] = pt.ebar;
    }
    const nc = hist.cycles;
    dW[q] = Wc[nc] - Wc[nc - 1];
    dE[q] = Ec[nc] - Ec[nc - 1];
    stab[q] = nc >= 2 ? Math.abs((Wc[nc] - Wc[nc - 1]) - (Wc[nc - 1] - Wc[nc - 2])) / Math.max(Wc[nc] - Wc[nc - 1], 1e-30) : NaN;
  }
  // ranking
  const order = Array.from({ length: n }, (_, q) => q).filter(q => isFinite(dW[q])).sort((a, b) => dW[b] - dW[a]);
  return { die: d.name, dieIdx, x: sites.x, y: sites.y, ix: sites.ix, iy: sites.iy, dW, dE, stab, subsampled, nSites: n, top: order.slice(0, 20).map(q => ({ q, x: sites.x[q], y: sites.y[q], dW: dW[q], dE: dE[q] })), ms: nowMs() - t0, cycles: hist.cycles };
}

// ---- life models (Section 9.3) ------------------------------------------------------------

function lifeEstimates(dW, dE, fat, dJoint) {
  const out = {};
  out.syedEnergy = dW > 0 ? 1 / ((fat.CW || CONST.SYED_CW) * dW) : Infinity;
  out.syedStrain = dE > 0 ? 1 / ((fat.Cstrain || CONST.SYED_CSTRAIN) * dE) : Infinity;
  if (fat.K1 != null && fat.K2 != null && fat.K3 != null && fat.K4 != null && dW > 0) {
    const N0 = fat.K1 * Math.pow(dW, fat.K2), dadN = fat.K3 * Math.pow(dW, fat.K4);
    out.darveauxN0 = N0; out.darveauxDaDn = dadN; out.darveaux = N0 + dJoint / dadN;
  } else out.darveaux = null;
  return out;
}

// ---- bump submodel (Section 9.3) --------------------------------------------------------------

/** B-bar (mean dilatation) strain-displacement matrix of a box element at a Gauss point. */
const _bbarBuf = { dx: new Float64Array(NFUN), dy: new Float64Array(NFUN), dz: new Float64Array(NFUN), cx: new Float64Array(NFUN), cy: new Float64Array(NFUN), cz: new Float64Array(NFUN) };
function bbarMatrix(hx, hy, hz, xi, eta, zeta, Bb) {
  const { dx, dy, dz, cx, cy, cz } = _bbarBuf;
  boxDerivs(hx, hy, hz, xi, eta, zeta, dx, dy, dz);
  boxDerivs(hx, hy, hz, 0, 0, 0, cx, cy, cz);
  Bb.fill(0);
  for (let a = 0; a < 8; a++) {
    const c = 3 * a;
    const ddx = (cx[a] - dx[a]) / 3, ddy = (cy[a] - dy[a]) / 3, ddz = (cz[a] - dz[a]) / 3;
    // normal rows with the dilatation replaced by its element-centre value
    Bb[0 * 24 + c] = dx[a] + ddx; Bb[0 * 24 + c + 1] = ddy; Bb[0 * 24 + c + 2] = ddz;
    Bb[1 * 24 + c] = ddx; Bb[1 * 24 + c + 1] = dy[a] + ddy; Bb[1 * 24 + c + 2] = ddz;
    Bb[2 * 24 + c] = ddx; Bb[2 * 24 + c + 1] = ddy; Bb[2 * 24 + c + 2] = dz[a] + ddz;
    Bb[3 * 24 + c] = dy[a]; Bb[3 * 24 + c + 1] = dx[a];
    Bb[4 * 24 + c + 1] = dz[a]; Bb[4 * 24 + c + 2] = dy[a];
    Bb[5 * 24 + c] = dz[a]; Bb[5 * 24 + c + 2] = dx[a];
  }
  return Bb;
}

/** Submodel z planes: resolve the substrate / die slices and the two 25 um averaging layers. */
function submodelZPlanes(g, nz, layerOnly) {
  const m = layerOnly ? 0 : CONST.SUB_MARGIN, ta = CONST.SUB_T_AVG;
  const zt = g.zt, za = g.zaf;
  const bands = [m > 0 ? [zt - m, zt, 2] : null, [zt, zt + ta, 3], [zt + ta, za - ta, 2], [za - ta, za, 3], m > 0 ? [za, za + m, 2] : null];
  if (za - ta <= zt + ta + 1e-9) { bands[1][1] = 0.5 * (zt + za); bands[2] = null; bands[3][0] = 0.5 * (zt + za); }
  const active = bands.filter(b => b);
  let total = active.reduce((s, b) => s + b[2], 0);
  // distribute extra layers to the thickest bands
  while (total < nz) { let best = 0, bh = -1; active.forEach((b, i) => { const h = (b[1] - b[0]) / b[2]; if (h > bh) { bh = h; best = i; } }); active[best][2]++; total++; }
  const zs = [active[0][0]];
  for (const b of active) for (let k = 1; k <= b[2]; k++) zs.push(b[0] + (b[1] - b[0]) * k / b[2]);
  return zs;
}

/**
 * Bump submodel: one pitch cell around a bump with a truncated-sphere solder
 * joint, underfill, Si and substrate slices, B-bar hexahedra, cut-boundary
 * displacements from the global cycling fields, Anand solder, Newton-Raphson
 * with the algorithmic tangent and IC(0)-PCG linear solves.
 */
class BumpSubmodel {
  constructor(an, dieIdx, site, opts) {
    this.an = an; this.cfg = an.cfg; this.opts = Object.assign({ nxy: 16, nz: 14, elasticSolder: false, uniformMaterial: false, layerOnly: false, progress: null, cancelled: null }, opts || {});
    const g = an.mesh.geom, d = g.dies[dieIdx];
    this.die = d; this.site = site;
    const n = this.opts.nxy, nz = this.opts.nz;
    const xs = [], ys = [];
    for (let i = 0; i <= n; i++) { xs.push(site.x - d.px / 2 + d.px * i / n); ys.push(site.y - d.py / 2 + d.py * i / n); }
    const zs = submodelZPlanes(g, nz, this.opts.layerOnly);
    const prof = d.profile;
    const MAT = { SUB: 0, SOLDER: 1, UF: 2, SI: 3 };
    this.MAT = MAT;
    const groups = [{ name: 'substrate slice', kind: 'sub' }, { name: 'solder', kind: 'solder' }, { name: 'underfill', kind: 'uf' }, { name: 'silicon', kind: 'si' }];
    const assign = (i, j, k) => {
      const zc = 0.5 * (zs[k] + zs[k + 1]);
      let mat;
      if (zc < g.zt) mat = MAT.SUB;
      else if (zc > g.zaf) mat = MAT.SI;
      else {
        const xc = 0.5 * (xs[i] + xs[i + 1]) - site.x, yc = 0.5 * (ys[j] + ys[j + 1]) - site.y;
        mat = Math.hypot(xc, yc) <= prof.radiusAt(zc - g.zt) ? MAT.SOLDER : MAT.UF;
      }
      if (this.opts.uniformMaterial && (mat === MAT.SOLDER || mat === MAT.UF)) mat = MAT.UF; // bump layer: homogenized phases (V7)
      return [{ group: mat, scale: 1, part: mat }];
    };
    this.mesh = buildStructuredMesh(xs, ys, zs, groups, assign);
    const mesh = this.mesh;
    this.ndof = 3 * mesh.nn;
    this.upper = bcsrFromElements(mesh.nn, mesh.conn, mesh.ne, 8);
    this.pattern = fullPatternFromUpper(this.upper);
    this.val = new Float64Array(this.pattern.nb * 9);
    this.bmap = this._blockMap();
    // materials
    this.lib = this.cfg.materials;
    this.solderMat = findMaterial(this.lib, this.cfg.bump.solder);
    this.ufMat = findMaterial(this.lib, this.cfg.underfill.mat);
    this.ufTables = materialTables(this.ufMat);
    this.siD = siliconD(findMaterial(this.lib, 'si'), d.si);
    this.siF = materialTables(findMaterial(this.lib, 'si')).F;
    this._prepareSubstrateSlice(g);
    if (this.opts.uniformMaterial) this.topSection = buildBandSection(g.sub.bands[g.sub.bands.length - 1], this.lib, CONST.NU_MAX_GLOBAL);
    // Gauss-point material states
    this.anand = [];
    this.gpMat = new Int8Array(mesh.ne * 8);
    for (let e = 0; e < mesh.ne; e++) {
      const mat = mesh.eGroup[e];
      for (let gq = 0; gq < 8; gq++) {
        this.gpMat[e * 8 + gq] = mat;
        this.anand.push(mat === MAT.SOLDER && !this.opts.elasticSolder ? new AnandPoint(this.solderMat) : null);
      }
    }
    this._boundary();
    this._bbarCache();
    this.u = new Float64Array(this.ndof);
    // committed state of the elastic parts (incremental): temperature, displacement, Gauss-point stress, internal force
    this.Tn = 25; this.uN = new Float64Array(this.ndof);
    this.sigE = new Float64Array(mesh.ne * 48); this.eFn = new Float64Array(mesh.ne * 24);
    this.log = [];
  }

  /** B-bar matrices of the 8 Gauss points for every distinct element size. */
  _bbarCache() {
    const m = this.mesh, keys = new Map();
    this.eBb = new Int32Array(m.ne);
    const list = [];
    for (let e = 0; e < m.ne; e++) {
      const i = m.eIJK[3 * e], j = m.eIJK[3 * e + 1], k = m.eIJK[3 * e + 2];
      const hx = m.xs[i + 1] - m.xs[i], hy = m.ys[j + 1] - m.ys[j], hz = m.zs[k + 1] - m.zs[k];
      const key = hx.toPrecision(12) + '|' + hy.toPrecision(12) + '|' + hz.toPrecision(12);
      let idx = keys.get(key);
      if (idx === undefined) {
        idx = list.length; keys.set(key, idx);
        const B = new Float64Array(8 * 144);
        for (let gq = 0; gq < 8; gq++) bbarMatrix(hx, hy, hz, HEX_XI[gq] * GP2, HEX_ETA[gq] * GP2, HEX_ZETA[gq] * GP2, B.subarray(144 * gq, 144 * gq + 144));
        list.push({ B, w: hx * hy * hz / 8 });
      }
      this.eBb[e] = idx;
    }
    this.bbList = list;
  }

  _blockMap() {
    const m = this.mesh, P = this.pattern, map = new Int32Array(m.ne * 64);
    for (let e = 0; e < m.ne; e++) for (let a = 0; a < 8; a++) {
      const na = m.conn[8 * e + a];
      for (let b = 0; b < 8; b++) {
        const nb = m.conn[8 * e + b];
        let lo = P.rowPtr[na], hi = P.rowPtr[na + 1] - 1, k = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; const v = P.col[mid]; if (v === nb) { k = mid; break; } if (v < nb) lo = mid + 1; else hi = mid - 1; }
        map[(e * 8 + a) * 8 + b] = k;
      }
    }
    return map;
  }

  /** Homogenized top SUB_MARGIN of the substrate: D(T) and eps0(T) tables. */
  _prepareSubstrateSlice(g) {
    const rows = g.sub.rows.filter(r => r.z1 > g.zt - CONST.SUB_MARGIN - 1e-12);
    const total = rows.reduce((s, r) => s + (r.z1 - Math.max(r.z0, g.zt - CONST.SUB_MARGIN)), 0);
    this.subD = new Float64Array(TGRID_N * 36); this.subE0 = new Float64Array(TGRID_N * 3);
    const tmp = new Float64Array(36);
    for (let i = 0; i < TGRID_N; i++) {
      const T = CONST.TGRID_MIN + i;
      const layers = rows.map(r => {
        const ec = substrateRowEC(r.row, T, this.lib);
        orthoD(ec, CONST.NU_MAX_SUBMODEL, tmp);
        return { D: Float64Array.from(tmp), eps0: [0, 0, 0], f: (r.z1 - Math.max(r.z0, g.zt - CONST.SUB_MARGIN)) / total };
      });
      const L = laminateAverage(layers);
      this.subD.set(L.D, 36 * i);
    }
    // thermal strain by Simpson on the homogenized alpha (Turner-weighted via laminate average of alpha)
    const F = new Float64Array(TGRID_N * 3);
    const alpha = T => {
      const layers = rows.map(r => {
        const ec = substrateRowEC(r.row, T, this.lib);
        orthoD(ec, CONST.NU_MAX_SUBMODEL, tmp);
        return { D: Float64Array.from(tmp), eps0: [ec.ax, ec.ay, ec.az], f: (r.z1 - Math.max(r.z0, g.zt - CONST.SUB_MARGIN)) / total };
      });
      return laminateAverage(layers).eps0;
    };
    const al = [];
    for (let k = 0; k <= 2 * (TGRID_N - 1); k++) al.push(alpha(CONST.TGRID_MIN + 0.5 * k));
    for (let i = 1; i < TGRID_N; i++) for (let c = 0; c < 3; c++) F[3 * i + c] = F[3 * (i - 1) + c] + (al[2 * (i - 1)][c] + 4 * al[2 * i - 1][c] + al[2 * i][c]) / 6;
    const i25 = CONST.T_STRAIN_ORIGIN - CONST.TGRID_MIN;
    for (let c = 0; c < 3; c++) { const off = F[3 * i25 + c]; for (let i = 0; i < TGRID_N; i++) F[3 * i + c] -= off; }
    this.subF = F;
  }

  /** Boundary nodes and their global-element interpolation data. */
  _boundary() {
    const m = this.mesh, gm = this.an.mesh, geom = gm.geom;
    const isB = new Uint8Array(m.nn);
    for (let n = 0; n < m.nn; n++) {
      const i = m.nodeIJK[3 * n], j = m.nodeIJK[3 * n + 1], k = m.nodeIJK[3 * n + 2];
      if (i === 0 || j === 0 || k === 0 || i === m.nx - 1 || j === m.ny - 1 || k === m.nz - 1) isB[n] = 1;
    }
    this.isBoundary = isB;
    this.isC = new Uint8Array(this.ndof);
    const list = [];
    for (let n = 0; n < m.nn; n++) if (isB[n]) { list.push(n); this.isC[3 * n] = this.isC[3 * n + 1] = this.isC[3 * n + 2] = 1; }
    this.bNodes = Int32Array.from(list);
    // global element and trilinear weights for each boundary node
    const nb = list.length;
    this.bElem = new Int32Array(nb), this.bN = new Float64Array(nb * 8);
    const N = new Float64Array(8);
    for (let q = 0; q < nb; q++) {
      const n = list[q];
      const x = m.coords[3 * n], y = m.coords[3 * n + 1], z = m.coords[3 * n + 2];
      const [i, j, k] = cellAt(gm, x, y, Math.min(Math.max(z, gm.zs[0] + 1e-9), gm.zs[gm.nz - 1] - 1e-9));
      let e = elementInCell(gm, i, j, k, null);
      if (e < 0) {
        // fall back to the nearest cell with an element in the same column (above or below)
        for (let dk = 1; dk < gm.nz && e < 0; dk++) { if (k - dk >= 0) e = elementInCell(gm, i, j, k - dk, null); if (e < 0 && k + dk < gm.nz - 1) e = elementInCell(gm, i, j, k + dk, null); }
      }
      this.bElem[q] = e;
      const [xi, eta, zeta] = naturalCoords(gm, e, x, y, z);
      hexN(xi, eta, zeta, N);
      this.bN.set(N, 8 * q);
    }
  }

  /** Prescribed boundary displacement change u(T) - u(25) from the global fields. */
  prescribe(T, u) {
    const an = this.an, gm = an.mesh;
    const uT = an.fieldAt(T, this._uT), u25 = an.fields.get(25);
    this._uT = uT;
    // trilinear nodal interpolation within the global elements (Section 9.3)
    for (let q = 0; q < this.bNodes.length; q++) {
      const n = this.bNodes[q], e = this.bElem[q];
      let ux = 0, uy = 0, uz = 0;
      for (let a = 0; a < 8; a++) {
        const gn = gm.conn[8 * e + a], w = this.bN[8 * q + a];
        ux += w * (uT[3 * gn] - u25[3 * gn]); uy += w * (uT[3 * gn + 1] - u25[3 * gn + 1]); uz += w * (uT[3 * gn + 2] - u25[3 * gn + 2]);
      }
      u[3 * n] = ux; u[3 * n + 1] = uy; u[3 * n + 2] = uz;
    }
  }

  /**
   * Elastic material data of one step from Ta to Tb (incremental, Section 6.5 as
   * amended): stiffness D (36) at the step midpoint and the thermal stress
   * increment sth (6) = D [F(Tb) - F(Ta)], summed over the phases where the
   * bump layer is homogenized (V7).
   */
  _elastic(mat, Ta, Tb, D, sth) {
    const MAT = this.MAT, Tm = 0.5 * (Ta + Tb), dF = this._dF || (this._dF = new Float64Array(3));
    const fromStrain = () => { for (let r = 0; r < 6; r++) sth[r] = D[r * 6] * dF[0] + D[r * 6 + 1] * dF[1] + D[r * 6 + 2] * dF[2]; };
    const isoStep = (tab, nuMax) => { isoD(gridAt(tab.E, Tm), tab.nu, nuMax, D); dF[0] = dF[1] = dF[2] = gridAt(tab.F, Tb) - gridAt(tab.F, Ta); fromStrain(); };
    if (this.opts.uniformMaterial && mat === MAT.UF) {
      // the global bump-layer cell: solder columns (columnD) and underfill superposed with volume fractions fb, 1 - fb
      const fb = this.die.density, st = materialTables(this.solderMat), ut = this.ufTables;
      const Ds = columnD(gridAt(st.E, Tm), st.nu, this._Ds || (this._Ds = new Float64Array(36)));
      const Du = isoD(gridAt(ut.E, Tm), ut.nu, CONST.NU_MAX_GLOBAL, this._Du || (this._Du = new Float64Array(36)));
      const fs = gridAt(st.F, Tb) - gridAt(st.F, Ta), fu = gridAt(ut.F, Tb) - gridAt(ut.F, Ta);
      for (let q = 0; q < 36; q++) D[q] = fb * Ds[q] + (1 - fb) * Du[q];
      for (let r = 0; r < 6; r++) sth[r] = fb * (Ds[r * 6] + Ds[r * 6 + 1] + Ds[r * 6 + 2]) * fs + (1 - fb) * (Du[r * 6] + Du[r * 6 + 1] + Du[r * 6 + 2]) * fu;
      return;
    }
    if (mat === MAT.SI) { D.set(this.siD); dF[0] = dF[1] = dF[2] = gridAt(this.siF, Tb) - gridAt(this.siF, Ta); fromStrain(); return; }
    if (mat === MAT.UF) { isoStep(this.ufTables, CONST.NU_MAX_SUBMODEL); return; }
    if (mat === MAT.SOLDER) { isoStep(materialTables(this.solderMat), CONST.NU_MAX_SUBMODEL); return; }
    // substrate slice
    let x = clamp(Tm - CONST.TGRID_MIN, 0, TGRID_N - 1); const i = Math.min(Math.floor(x), TGRID_N - 2), t = x - i;
    if (this.opts.uniformMaterial && this._subZ !== undefined) {
      // consistency mode: the global band's own sub-layer stiffness at this height
      const sec = this.topSection;
      let sl = sec.ns - 1;
      for (let q2 = 0; q2 < sec.ns; q2++) if (this._subZ <= sec.subZ[q2][1] + 1e-12) { sl = q2; break; }
      sectionSubD(sec, sl, Tm, D);
      sectionSubDF(sec, sl, Ta, Tb, dF);
      // through-thickness response of the whole band (one thickness strain shared by its sub-layers in the
      // global element): Voigt thickness modulus and Turner-weighted thermal strain over the band
      let Ez = 0, EzF = 0, tt = 0;
      const Dq = this._Dq || (this._Dq = new Float64Array(36)), dFq = this._dFq || (this._dFq = new Float64Array(3));
      for (let q2 = 0; q2 < sec.ns; q2++) {
        const ts = sec.subZ[q2][1] - sec.subZ[q2][0];
        sectionSubD(sec, q2, Tm, Dq); sectionSubDF(sec, q2, Ta, Tb, dFq);
        Ez += ts * Dq[14]; EzF += ts * Dq[14] * dFq[2]; tt += ts;
      }
      D[14] = Ez / tt; dF[2] = EzF / Ez;
      fromStrain();
      return;
    }
    for (let q = 0; q < 36; q++) D[q] = this.subD[36 * i + q] + t * (this.subD[36 * (i + 1) + q] - this.subD[36 * i + q]);
    for (let c = 0; c < 3; c++) dF[c] = gridAt(this.subF, Tb, 3, c) - gridAt(this.subF, Ta, 3, c);
    fromStrain();
  }

  /** Key and data (D, sth) of an elastic element's material for the current step from Tn to T (cached per step). */
  _elasRec(e, T) {
    const m = this.mesh, mat = m.eGroup[e], k = m.eIJK[3 * e + 2];
    const perElement = this.opts.uniformMaterial && mat === this.MAT.SUB;
    const key = perElement ? 'sub' + k : mat;
    const elas = this._elasMap || (this._elasMap = new Map());
    let rec = elas.get(key);
    if (!rec) {
      rec = { D: new Float64Array(36), sth: new Float64Array(6) };
      this._subZ = perElement ? 0.5 * (m.zs[k] + m.zs[k + 1]) : undefined;
      this._elastic(mat, this.Tn, T, rec.D, rec.sth);
      this._subZ = undefined;
      elas.set(key, rec);
    }
    return rec;
  }

  /**
   * Assemble the tangent stiffness and internal force at the current trial
   * displacement for temperature T and time increment dt. Returns the maximum
   * equivalent plastic strain increment over the solder Gauss points.
   */
  assemble(T, dt, u, rint, wantK) {
    const m = this.mesh, val = this.val;
    if (wantK) val.fill(0);
    rint.fill(0);
    const buf = this._buf || (this._buf = { D: new Float64Array(36), eps: new Float64Array(6), epsM: new Float64Array(6), sig: new Float64Array(6), ue: new Float64Array(24), Ke: new Float64Array(576), fe: new Float64Array(24), DB: new Float64Array(144), Dt: new Float64Array(36) });
    const { D, eps, epsM, sig, ue, Ke, fe, DB } = buf;
    const out = { sig, D: buf.Dt };
    // elastic element matrices of this step (from the committed T_n to T), rebuilt when the step changes
    const stepKey = this.Tn + '|' + T, fresh = this.eStepKey !== stepKey;
    if (fresh && this._elasMap) this._elasMap.clear();
    const kAn = this.anandConst || (this.anandConst = new AnandPoint(this.solderMat));
    const kc = kAn.stepConstants(T, dt);
    const fSolder = kAn.thermalStrain(T) - kAn.thermalStrain(25);
    let dMax = 0;
    for (let e = 0; e < m.ne; e++) {
      const bb = this.bbList[this.eBb[e]], Ball = bb.B, w = bb.w;
      for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; ue[3 * a] = u[3 * n]; ue[3 * a + 1] = u[3 * n + 1]; ue[3 * a + 2] = u[3 * n + 2]; }
      Ke.fill(0); fe.fill(0);
      const isAnand = this.anand[e * 8] !== null;
      if (!isAnand) {
        // elastic element, incremental: sigma = sigma_n + D(Tm) B (u - u_n) - sth with the committed state at
        // T_n. K_e and the thermal load f_th depend on the step (T_n, T) only, so they are built once per step and
        // reused across its Newton iterations: f_int = f_n + K_e (u_e - u_n,e) - f_th
        if (!this.eK) { this.eK = new Float64Array(576 * m.ne); this.eF = new Float64Array(24 * m.ne); }
        const Kc = this.eK.subarray(576 * e, 576 * e + 576), fc = this.eF.subarray(24 * e, 24 * e + 24);
        if (fresh) {
          const rec = this._elasRec(e, T);
          D.set(rec.D);
          Kc.fill(0); fc.fill(0);
          for (let gq = 0; gq < 8; gq++) {
            const Bb = Ball.subarray(144 * gq, 144 * gq + 144);
            for (let c = 0; c < 24; c++) { let sum = 0; for (let r = 0; r < 6; r++) sum += Bb[r * 24 + c] * rec.sth[r]; fc[c] += w * sum; }
            for (let r = 0; r < 6; r++) for (let c = 0; c < 24; c++) { let sum = 0; for (let t = 0; t < 6; t++) sum += D[r * 6 + t] * Bb[t * 24 + c]; DB[r * 24 + c] = sum; }
            for (let a = 0; a < 24; a++) for (let b = a; b < 24; b++) { let sum = 0; for (let r = 0; r < 6; r++) sum += Bb[r * 24 + a] * DB[r * 24 + b]; Kc[a * 24 + b] += w * sum; }
          }
          for (let a = 0; a < 24; a++) for (let b = 0; b < a; b++) Kc[a * 24 + b] = Kc[b * 24 + a];
        }
        const uN = this.uN, fn = this.eFn;
        for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; ue[3 * a] -= uN[3 * n]; ue[3 * a + 1] -= uN[3 * n + 1]; ue[3 * a + 2] -= uN[3 * n + 2]; }
        for (let a = 0; a < 24; a++) { let sum = fn[24 * e + a] - fc[a]; const ro = a * 24; for (let b = 0; b < 24; b++) sum += Kc[ro + b] * ue[b]; fe[a] = sum; }
        for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; rint[3 * n] += fe[3 * a]; rint[3 * n + 1] += fe[3 * a + 1]; rint[3 * n + 2] += fe[3 * a + 2]; }
        if (wantK) for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
          const kk = this.bmap[(e * 8 + a) * 8 + b], v = 9 * kk;
          for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) val[v + 3 * p + q] += Kc[(3 * a + p) * 24 + 3 * b + q];
        }
        continue;
      }
      for (let gq = 0; gq < 8; gq++) {
        const Bb = Ball.subarray(144 * gq, 144 * gq + 144);
        for (let r = 0; r < 6; r++) { let s = 0; const ro = r * 24; for (let c = 0; c < 24; c++) s += Bb[ro + c] * ue[c]; eps[r] = s; }
        // solder: Anand point driven by the mechanical strain change from the 25 degC state
        const pt = this.anand[e * 8 + gq];
        epsM.set(eps); epsM[0] -= fSolder; epsM[1] -= fSolder; epsM[2] -= fSolder;
        const d = pt.step(epsM, T, dt, out, wantK, kc);
        if (d > dMax) dMax = d;
        const Dg = out.D;
        for (let c = 0; c < 24; c++) { let s = 0; for (let r = 0; r < 6; r++) s += Bb[r * 24 + c] * sig[r]; fe[c] += w * s; }
        if (wantK) {
          for (let r = 0; r < 6; r++) for (let c = 0; c < 24; c++) { let s = 0; for (let t = 0; t < 6; t++) s += Dg[r * 6 + t] * Bb[t * 24 + c]; DB[r * 24 + c] = s; }
          for (let a = 0; a < 24; a++) for (let b = a; b < 24; b++) {
            let s = 0;
            for (let r = 0; r < 6; r++) s += Bb[r * 24 + a] * DB[r * 24 + b];
            Ke[a * 24 + b] += w * s;
          }
        }
      }
      for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; rint[3 * n] += fe[3 * a]; rint[3 * n + 1] += fe[3 * a + 1]; rint[3 * n + 2] += fe[3 * a + 2]; }
      if (wantK) {
        for (let a = 0; a < 24; a++) for (let b = 0; b < a; b++) Ke[a * 24 + b] = Ke[b * 24 + a];
        for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
          const kk = this.bmap[(e * 8 + a) * 8 + b], v = 9 * kk;
          for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) val[v + 3 * p + q] += Ke[(3 * a + p) * 24 + 3 * b + q];
        }
      }
    }
    this.eStepKey = stepKey;
    return dMax;
  }

  /** Commit the elastic parts at the converged displacement: Gauss-point stresses, internal forces, T_n, u_n. */
  _commitElastic(T) {
    const m = this.mesh, u = this.u, uN = this.uN, due = new Float64Array(24), de = new Float64Array(6), sg = new Float64Array(6);
    for (let e = 0; e < m.ne; e++) {
      if (this.anand[e * 8] !== null) continue;
      const rec = this._elasRec(e, T), bb = this.bbList[this.eBb[e]], Ball = bb.B, w = bb.w;
      for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; for (let c = 0; c < 3; c++) due[3 * a + c] = u[3 * n + c] - uN[3 * n + c]; }
      const fn = this.eFn.subarray(24 * e, 24 * e + 24);
      fn.fill(0);
      for (let gq = 0; gq < 8; gq++) {
        const Bb = Ball.subarray(144 * gq, 144 * gq + 144), o = 48 * e + 6 * gq;
        for (let r = 0; r < 6; r++) { let s2 = 0; const ro = r * 24; for (let c = 0; c < 24; c++) s2 += Bb[ro + c] * due[c]; de[r] = s2; }
        for (let r = 0; r < 6; r++) { let s2 = -rec.sth[r]; for (let c = 0; c < 6; c++) s2 += rec.D[r * 6 + c] * de[c]; this.sigE[o + r] += s2; sg[r] = this.sigE[o + r]; }
        for (let c = 0; c < 24; c++) { let s2 = 0; for (let r = 0; r < 6; r++) s2 += Bb[r * 24 + c] * sg[r]; fn[c] += w * s2; }
      }
    }
    uN.set(u); this.Tn = T;
  }

  _constrain() {
    const P = this.pattern, val = this.val, isC = this.isC;
    for (let i = 0; i < P.n; i++) for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
      const j = P.col[k], v = 9 * k;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
        const r = 3 * i + p, c = 3 * j + q;
        if ((isC[r] || isC[c]) && r !== c) val[v + 3 * p + q] = 0;
      }
    }
  }

  /** PCG with IC(0) on the Jacobi-scaled tangent. */
  _solve(rhs, x, tol) {
    tol = tol || CONST.SUB_INNER_TOL;
    const P = this.pattern, n = this.ndof;
    // scaled working copy (the assembled tangent may be reused by later iterations)
    const val = this._vals || (this._vals = new Float64Array(this.val.length));
    val.set(this.val);
    const s = this._s || (this._s = new Float64Array(n));
    for (let i = 0; i < P.n; i++) { const v = 9 * P.diag[i]; s[3 * i] = 1 / Math.sqrt(Math.max(val[v], 1e-300)); s[3 * i + 1] = 1 / Math.sqrt(Math.max(val[v + 4], 1e-300)); s[3 * i + 2] = 1 / Math.sqrt(Math.max(val[v + 8], 1e-300)); }
    for (let i = 0; i < P.n; i++) for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) { const j = P.col[k], v = 9 * k; for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) val[v + 3 * p + q] *= s[3 * i + p] * s[3 * j + q]; }
    const b = this._b || (this._b = new Float64Array(n));
    for (let q = 0; q < n; q++) b[q] = rhs[q] * s[q];
    if (!this.pc || this.pcStale) { this.pc = new ICPC(P, val); this.pcStale = false; this.pcIters = 0; }
    const r = this._r || (this._r = new Float64Array(n)), z = this._z || (this._z = new Float64Array(n)), p = this._p || (this._p = new Float64Array(n)), q = this._q || (this._q = new Float64Array(n));
    x.fill(0);
    r.set(b);
    const bn = norm2(b);
    if (bn === 0) return 0;
    this.pc.apply(r, z); p.set(z);
    let rz = dot(r, z), it;
    for (it = 1; it <= 2000; it++) {
      fullMatVec(P, val, p, q);
      const alpha = rz / dot(p, q);
      axpy(alpha, p, x); axpy(-alpha, q, r);
      if (norm2(r) / bn < tol) break;
      this.pc.apply(r, z);
      const rz2 = dot(r, z); const beta = rz2 / rz; rz = rz2;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    for (let q2 = 0; q2 < n; q2++) x[q2] *= s[q2];
    if (!this.pcIters) this.pcIters = it; else if (it > 2 * this.pcIters) this.pcStale = true;
    return it;
  }

  /**
   * One time step to temperature T with increment dt. Newton-Raphson with the
   * algorithmic tangent, which is rebuilt on the first two iterations and then
   * kept (modified Newton) while the residual keeps shrinking.
   */
  stepTo(T, dt) {
    const n = this.ndof, u = this.u;
    const rint = this._rint || (this._rint = new Float64Array(n)), du = this._du || (this._du = new Float64Array(n)), rhs = this._rhs || (this._rhs = new Float64Array(n));
    this.prescribe(T, u);
    let dMax = 0, converged = false, it, rPrev = Infinity, haveK = false;
    for (it = 1; it <= CONST.SUB_NEWTON_MAXIT; it++) {
      const wantK = it <= 2 || !haveK;
      dMax = this.assemble(T, dt, u, rint, wantK);
      if (wantK) { this._constrain(); haveK = true; }
      let rn = 0, fn = 0;
      for (let q = 0; q < n; q++) { if (!this.isC[q]) rn += rint[q] * rint[q]; fn += rint[q] * rint[q]; }
      rn = Math.sqrt(rn); fn = Math.sqrt(fn);
      const ref = Math.max(fn, 1e-30);
      if (rn / ref < CONST.SUB_RES_TOL) { converged = true; break; }
      if (!wantK && rn > 0.5 * rPrev) { // stalled with the frozen tangent: refresh it
        this.assemble(T, dt, u, rint, true); this._constrain();
      }
      rPrev = rn;
      for (let q = 0; q < n; q++) rhs[q] = this.isC[q] ? 0 : -rint[q];
      // inexact Newton: the inner solve only needs to beat the current Newton residual ratio by a margin
      this._solve(rhs, du, Math.max(CONST.SUB_INNER_TOL, Math.min(1e-3, 0.01 * CONST.SUB_RES_TOL * ref / Math.max(rn, 1e-300))));
      let dun = 0, un = 0;
      for (let q = 0; q < n; q++) { if (!this.isC[q]) { u[q] += du[q]; dun += du[q] * du[q]; } un += u[q] * u[q]; }
      if (Math.sqrt(dun) < CONST.SUB_DU_TOL * Math.max(Math.sqrt(un), 1e-30)) { converged = true; it++; break; }
    }
    if (converged) {
      // final state at the converged displacement (residual-only assembly refreshes the trial states)
      dMax = this.assemble(T, dt, u, rint, false);
      for (const pt of this.anand) if (pt) pt.commit();
      this._commitElastic(T);
    }
    return { converged, newton: it, dMax };
  }

  /**
   * Stress change from the as-assembled 25 degC state in every element at the
   * committed temperature T, for the cross-section view: Gauss-point stresses
   * extrapolated to the 8 corners (GP_TO_NODE). Elastic parts: the committed
   * incremental stress; solder: the Anand stress at the committed plastic strain.
   * Float32Array(48 per element).
   */
  _stressSnapshot(T) {
    const m = this.mesh, out = new Float32Array(m.ne * 48);
    const ue = new Float64Array(24), eps = new Float64Array(6), sig = new Float64Array(6), gp = new Float64Array(48);
    for (let e = 0; e < m.ne; e++) {
      const Ball = this.bbList[this.eBb[e]].B, pt0 = this.anand[e * 8];
      if (!pt0) gp.set(this.sigE.subarray(48 * e, 48 * e + 48));
      else {
        for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; ue[3 * a] = this.u[3 * n]; ue[3 * a + 1] = this.u[3 * n + 1]; ue[3 * a + 2] = this.u[3 * n + 2]; }
        for (let gq = 0; gq < 8; gq++) {
          const Bb = Ball.subarray(144 * gq, 144 * gq + 144);
          for (let r = 0; r < 6; r++) { let s = 0; const ro = r * 24; for (let c = 0; c < 24; c++) s += Bb[ro + c] * ue[c]; eps[r] = s; }
          const pt = this.anand[e * 8 + gq], f = pt.thermalStrain(T) - pt.thermalStrain(25);
          eps[0] -= f; eps[1] -= f; eps[2] -= f;
          pt.stressAt(eps, T, sig);
          gp.set(sig, 6 * gq);
        }
      }
      for (let a = 0; a < 8; a++) for (let c = 0; c < 6; c++) {
        let v = 0;
        for (let gq = 0; gq < 8; gq++) v += GP_TO_NODE[a * 8 + gq] * gp[6 * gq + c];
        out[48 * e + 6 * a + c] = v;
      }
    }
    return out;
  }

  /** Save / restore the committed state (displacement, solder points, elastic stresses) for cutbacks. */
  _snapshot() {
    const b = this._snapBuf || (this._snapBuf = { u: new Float64Array(this.ndof), sigE: new Float64Array(this.sigE.length), eFn: new Float64Array(this.eFn.length) });
    b.u.set(this.u); b.sigE.set(this.sigE); b.eFn.set(this.eFn); b.Tn = this.Tn;
    b.st = this.anand.map(p => p ? p.save() : null);
    return b;
  }
  _restore(s) {
    this.u.set(s.u); this.uN.set(s.u); this.sigE.set(s.sigE); this.eFn.set(s.eFn); this.Tn = s.Tn;
    this.anand.forEach((p, i) => { if (p) p.restore(s.st[i]); });
  }

  /** Run the configured cycles; returns the result record. */
  run() {
    const t0 = nowMs();
    const cfg = this.cfg, hist = cycleHistory(cfg.cycling);
    const g = this.an.mesh.geom, m = this.mesh, MAT = this.MAT;
    const nsteps = hist.t.length;
    // solder Gauss points in the two averaging layers (volume weights)
    const dieLayer = [], subLayer = [], allSolder = [];
    for (let e = 0; e < m.ne; e++) {
      if (m.eGroup[e] !== MAT.SOLDER) continue;
      const k = m.eIJK[3 * e + 2], zc = 0.5 * (m.zs[k] + m.zs[k + 1]);
      const i = m.eIJK[3 * e], j = m.eIJK[3 * e + 1];
      const w = (m.xs[i + 1] - m.xs[i]) * (m.ys[j + 1] - m.ys[j]) * (m.zs[k + 1] - m.zs[k]) / 8;
      for (let gq = 0; gq < 8; gq++) {
        const rec = { idx: e * 8 + gq, w };
        allSolder.push(rec);
        if (zc > g.zaf - CONST.SUB_T_AVG) dieLayer.push(rec);
        if (zc < g.zt + CONST.SUB_T_AVG) subLayer.push(rec);
      }
    }
    const avg = (list, fn) => { let s = 0, ws = 0; for (const r of list) { s += r.w * fn(this.anand[r.idx]); ws += r.w; } return ws ? s / ws : NaN; };
    const phi = Math.atan2(this.site.y - this.die.cy, this.site.x - this.die.cx);
    const cphi = Math.cos(phi), sphi = Math.sin(phi);
    const loop = { t: [], T: [], tau: [], gamma: [], tauSub: [], gammaSub: [] };
    const Wcyc = { die: new Float64Array(hist.cycles + 1), sub: new Float64Array(hist.cycles + 1), eDie: new Float64Array(hist.cycles + 1), eSub: new Float64Array(hist.cycles + 1) };
    let totalNewton = 0, cutbacks = 0, steps = 0, nsubNext = 1;
    const stress = new Float64Array(6), eps = new Float64Array(6), Bb = new Float64Array(144), ue = new Float64Array(24), out = { sig: stress, D: null };
    // hysteresis sampler: shear stress / strain in the die-side layer, volume-averaged
    const sampleLoop = (T, t) => {
      let tS = 0, gS = 0, tB = 0, gB = 0, wS = 0, wB = 0;
      for (const list of [dieLayer, subLayer]) {
        for (const r of list) {
          const e = Math.floor(r.idx / 8), gq = r.idx % 8;
          const i = m.eIJK[3 * e], j = m.eIJK[3 * e + 1], k = m.eIJK[3 * e + 2];
          bbarMatrix(m.xs[i + 1] - m.xs[i], m.ys[j + 1] - m.ys[j], m.zs[k + 1] - m.zs[k], HEX_XI[gq] * GP2, HEX_ETA[gq] * GP2, HEX_ZETA[gq] * GP2, Bb);
          for (let a = 0; a < 8; a++) { const nn = m.conn[8 * e + a]; ue[3 * a] = this.u[3 * nn]; ue[3 * a + 1] = this.u[3 * nn + 1]; ue[3 * a + 2] = this.u[3 * nn + 2]; }
          for (let rr = 0; rr < 6; rr++) { let s = 0; for (let c = 0; c < 24; c++) s += Bb[rr * 24 + c] * ue[c]; eps[rr] = s; }
          const pt = this.anand[r.idx];
          const f = pt.thermalStrain(T) - pt.thermalStrain(25);
          eps[0] -= f; eps[1] -= f; eps[2] -= f;
          pt.step(eps, T, 1e-9, out, false); // stress at the committed plastic state (negligible extra flow)
          const tau = stress[5] * cphi + stress[4] * sphi, gam = eps[5] * cphi + eps[4] * sphi;
          if (list === dieLayer) { tS += r.w * tau; gS += r.w * gam; wS += r.w; } else { tB += r.w * tau; gB += r.w * gam; wB += r.w; }
        }
      }
      loop.t.push(t); loop.T.push(T); loop.tau.push(wS ? tS / wS : NaN); loop.gamma.push(wS ? gS / wS : NaN); loop.tauSub.push(wB ? tB / wB : NaN); loop.gammaSub.push(wB ? gB / wB : NaN);
    };
    sampleLoop(25, 0);
    const liveLabel = 'Submodel ' + this.die.name + ' bump (' + this.site.ix + ', ' + this.site.iy + ')';
    liveReport({ event: 'start', kind: 'submodel', label: liveLabel, n: this.ndof, nsteps: nsteps - 1 });
    // stress snapshots for the cross-section view: the end of each ramp and dwell of the last cycle
    const snaps = [], snapOn = !this.opts.uniformMaterial;
    for (let k = 1; k < nsteps; k++) {
      if (this.opts.cancelled && this.opts.cancelled()) throw new Error('cancelled');
      const T0 = hist.T[k - 1], T1 = hist.T[k], t0s = hist.t[k - 1], t1s = hist.t[k];
      // adaptive sub-stepping on the inelastic strain increment (predictive from the last step, cut back on failure)
      let nsub = nsubNext, done = false, dLast = 0;
      for (let attempt = 0; attempt < 8 && !done; attempt++) {
        const snap = this._snapshot();
        let ok = true;
        for (let s = 1; s <= nsub; s++) {
          const T = T0 + (T1 - T0) * s / nsub, dt = (t1s - t0s) / nsub;
          const res = this.stepTo(T, dt);
          totalNewton += res.newton; steps++;
          dLast = res.dMax;
          if (!res.converged || res.dMax > CONST.INELASTIC_STEP_MAX) { ok = false; break; }
        }
        if (ok) done = true;
        else { this._restore(snap); nsub *= 2; cutbacks++; liveReport({ event: 'cutback', kind: 'submodel', label: liveLabel, step: k, nsteps: nsteps - 1, T: T1, nsub, cutbacks }); }
      }
      // next step: keep the sub-division while increments stay above half the limit, relax otherwise
      nsubNext = dLast > 0.5 * CONST.INELASTIC_STEP_MAX ? Math.min(nsub * 2, 64) : (dLast < 0.2 * CONST.INELASTIC_STEP_MAX ? Math.max(1, nsub >> 1) : nsub);
      if (!done) throw new Error('Submodel step failed to converge after cutbacks at T = ' + T1.toFixed(1) + ' °C');
      sampleLoop(T1, t1s);
      const c = hist.cycle[k];
      if (snapOn && c === hist.cycles && (k === nsteps - 1 || hist.phase[k + 1] !== hist.phase[k])) snaps.push({ T: T1, t: t1s, cycle: c, phase: hist.phase[k], sig: this._stressSnapshot(T1) });
      Wcyc.die[c] = avg(dieLayer, p => p.W); Wcyc.sub[c] = avg(subLayer, p => p.W);
      Wcyc.eDie[c] = avg(dieLayer, p => p.ebar); Wcyc.eSub[c] = avg(subLayer, p => p.ebar);
      if (this.opts.progress) this.opts.progress(k / (nsteps - 1), 'Submodel step ' + k + '/' + (nsteps - 1) + ' at ' + T1.toFixed(0) + ' °C');
      liveReport({ event: 'step', kind: 'submodel', label: liveLabel, step: k, nsteps: nsteps - 1, T: T1, cycle: c, cycles: hist.cycles, newtonPerStep: totalNewton / Math.max(steps, 1), cutbacks }, k < nsteps - 1);
    }
    const nc = hist.cycles;
    const dWdie = Wcyc.die[nc] - Wcyc.die[nc - 1], dWsub = Wcyc.sub[nc] - Wcyc.sub[nc - 1];
    const dEdie = Wcyc.eDie[nc] - Wcyc.eDie[nc - 1], dEsub = Wcyc.eSub[nc] - Wcyc.eSub[nc - 1];
    const dW = Math.max(dWdie, dWsub), dE = dWdie >= dWsub ? dEdie : dEsub;
    const prev = nc >= 2 ? Math.max(Wcyc.die[nc - 1] - Wcyc.die[nc - 2], Wcyc.sub[nc - 1] - Wcyc.sub[nc - 2]) : NaN;
    const stabChange = isFinite(prev) && prev > 0 ? Math.abs(dW - prev) / prev : NaN;
    const perCycle = [];
    for (let c = 1; c <= nc; c++) perCycle.push({ cycle: c, dWdie: Wcyc.die[c] - Wcyc.die[c - 1], dWsub: Wcyc.sub[c] - Wcyc.sub[c - 1] });
    const dJoint = this.die.profile.rb * 2 >= this.die.profile.rt * 2 ? (dWdie >= dWsub ? this.die.profile.rt * 2 : this.die.profile.rb * 2) : (dWdie >= dWsub ? this.die.profile.rt * 2 : this.die.profile.rb * 2);
    const life = lifeEstimates(dW, dE, cfg.fatigue, dJoint);
    return {
      die: this.die.name, site: { x: this.site.x, y: this.site.y, ix: this.site.ix, iy: this.site.iy }, nxy: this.opts.nxy, nz: this.opts.nz, nElem: m.ne, ndof: this.ndof,
      dW, dWdie, dWsub, dE, dEdie, dEsub, critical: dWdie >= dWsub ? 'die side' : 'substrate side', stabChange, stabWarn: isFinite(stabChange) && stabChange > CONST.STABILIZATION_WARN,
      perCycle, loop, life, dJoint, steps, cutbacks, newtonPerStep: totalNewton / Math.max(steps, 1), ms: nowMs() - t0,
      section: snapOn ? {
        xs: Float64Array.from(m.xs), ys: Float64Array.from(m.ys), zs: Float64Array.from(m.zs), grp: Int8Array.from(m.eGroup), cx: this.site.x, cy: this.site.y, zt: g.zt, zaf: g.zaf, dieCx: this.die.cx, dieCy: this.die.cy, radii: { top: this.die.profile.rt, bottom: this.die.profile.rb, max: this.die.profile.rm },
        groups: [{ name: 'Substrate slice', material: 'top ' + Math.round(CONST.SUB_MARGIN * 1000) + ' µm, homogenized' }, { name: 'Solder', material: this.solderMat.name }, { name: 'Underfill', material: this.ufMat.name }, { name: 'Silicon', material: '' }],
        snaps,
      } : null,
    };
  }
}

/**
 * As-assembled global stress at 25 degC at the centroid of every element of a
 * submodel section record S (for the total-stress view of the submodel
 * cross-section): silicon from the die, underfill from the underfill phase of
 * the bump layer, the substrate slice from the sub-layer of the layered band at
 * that height (layeredPointStress). Solder gets 0, since the submodel takes the
 * solder as relaxed at 25 degC. Float32Array(6 per element).
 */
function submodelResidual(an, S) {
  const view = an.view(25), mesh = an.mesh, nx = S.xs.length - 1, ny = S.ys.length - 1, nz = S.zs.length - 1;
  const out = new Float32Array(nx * ny * nz * 6), st = { eps: new Float64Array(6), sig: new Float64Array(6) };
  const partOf = [PART.SUB, null, PART.UF_BUMP, PART.DIE]; // submodel groups: substrate slice, solder, underfill, silicon
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const e = (i * ny + j) * nz + k, part = partOf[S.grp[e]];
    if (part == null) continue;
    const x = 0.5 * (S.xs[i] + S.xs[i + 1]), y = 0.5 * (S.ys[j] + S.ys[j + 1]), z = 0.5 * (S.zs[k] + S.zs[k + 1]);
    const [gi, gj, gk] = cellAt(mesh, x, y, z);
    const ge = elementInCell(mesh, gi, gj, gk, part);
    if (ge < 0) continue;
    const [xi, eta, zeta] = naturalCoords(mesh, ge, x, y, z);
    if (part === PART.SUB) layeredPointStress(view, ge, xi, eta, zeta, st); else view.point(ge, xi, eta, zeta, st);
    for (let c = 0; c < 6; c++) out[6 * e + c] = st.sig[c];
  }
  return out;
}

/**
 * Vertical cut through a bump submodel result sm along the x or y grid lines at
 * grid-line index jc across the cut, for snapshot si. Returns the record the
 * cross-section plot draws (see sectionStress), in local coordinates: s in um from
 * the bump axis, z in um above the substrate top. A cut along a voxel face between
 * two materials shows the element nearer the bump axis; corner values are averaged
 * only within one material. total: add the as-assembled 25 degC stress of each
 * element (S.residual, submodelResidual) to the change from 25 degC.
 */
function submodelSection(sm, si, axis, jc, total) {
  const S = sm.section, snap = S.snaps[si], res = total && S.residual ? S.residual : null;
  const alongY = axis === 'y';
  const along = alongY ? S.ys : S.xs, across = alongY ? S.xs : S.ys;
  const nx = S.xs.length - 1, ny = S.ys.length - 1, nz = S.zs.length - 1;
  const na = along.length - 1, nc = across.length - 1;
  jc = Math.max(0, Math.min(nc, Math.round(jc)));
  const c0 = alongY ? S.cx : S.cy;
  const cell = (ia, ic, k) => (alongY ? (ic * ny + ia) : (ia * ny + ic)) * nz + k;
  // corner order of the cut face (s-, z-), (s+, z-), (s+, z+), (s-, z+) on the element below (A, its + face) and above (B, its - face) the cut
  const faceA = alongY ? [1, 2, 6, 5] : [3, 2, 6, 7], faceB = alongY ? [0, 3, 7, 4] : [0, 1, 5, 4];
  const toUm = 1000;
  const sl = Float64Array.from(along, v => (v - (alongY ? S.cy : S.cx)) * toUm), zl = Float64Array.from(S.zs, v => (v - S.zt) * toUm);
  const ns = na + 1, nzl = nz + 1, ng = S.groups.length, nn = ns * nzl;
  const acc = new Float64Array(ng * nn * 7), quads = [], face = new Float64Array(24);
  for (let k = 0; k < nz; k++) for (let ia = 0; ia < na; ia++) {
    const eA = jc > 0 ? cell(ia, jc - 1, k) : -1, eB = jc < nc ? cell(ia, jc, k) : -1;
    let use;
    if (eA >= 0 && eB >= 0 && S.grp[eA] !== S.grp[eB]) {
      const dA = Math.abs(0.5 * (across[jc - 1] + across[jc]) - c0), dB = Math.abs(0.5 * (across[jc] + across[jc + 1]) - c0);
      use = dA < dB ? [[eA, faceA]] : [[eB, faceB]];
    } else use = [[eA, faceA], [eB, faceB]].filter(([e]) => e >= 0);
    face.fill(0);
    for (const [e, fc] of use) for (let v = 0; v < 4; v++) for (let cc = 0; cc < 6; cc++) face[6 * v + cc] += (snap.sig[48 * e + 6 * fc[v] + cc] + (res ? res[6 * e + cc] : 0)) / use.length;
    const grp = S.grp[use[0][0]];
    [[ia, k], [ia + 1, k], [ia + 1, k + 1], [ia, k + 1]].forEach(([ca, cb], v) => {
      const o = (grp * nn + ca * nzl + cb) * 7;
      for (let cc = 0; cc < 6; cc++) acc[o + cc] += face[6 * v + cc];
      acc[o + 6]++;
    });
    quads.push({ a: ia, b: k, grp });
  }
  const n = quads.length, sig = new Float32Array(24 * n);
  const out = { T: snap.T, axis: alongY ? 'y' : 'x', c: +((across[jc] - c0) * toUm).toFixed(6), a0: sl[0], a1: sl[na], zMin: zl[0], zTop: zl[nz], sl, zl, n,
    qa: new Int32Array(n), qb: new Int32Array(n), part: new Int8Array(n), grp: new Int16Array(n), pair: new Int8Array(n), cutBelow: new Int8Array(n), sig,
    topA: new Float32Array(n).fill(NaN), topB: new Float32Array(n).fill(NaN), groups: S.groups, submodel: true, total: !!res };
  quads.forEach((Q, t) => {
    out.qa[t] = Q.a; out.qb[t] = Q.b; out.part[t] = Q.grp; out.grp[t] = Q.grp;
    [[Q.a, Q.b], [Q.a + 1, Q.b], [Q.a + 1, Q.b + 1], [Q.a, Q.b + 1]].forEach(([ca, cb], v) => {
      const o = (Q.grp * nn + ca * nzl + cb) * 7;
      for (let cc = 0; cc < 6; cc++) sig[24 * t + 6 * v + cc] = acc[o + cc] / acc[o + 6];
    });
  });
  return out;
}
