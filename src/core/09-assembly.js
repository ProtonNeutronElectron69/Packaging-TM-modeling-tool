// ===== Model assembly: element birth, thermal loads, full block CSR =====
//
// Box elements use closed-form integration: in natural coordinates the
// products d_r N_a d_s N_b are integrated once (2x2 Gauss in-plane, exact
// quadratic Lagrange / Simpson through the thickness, which for a trilinear
// element reproduces 2x2x2 Gauss exactly) and scaled per element by
// (hx hy hz / 8) (2 / h_r) (2 / h_s). K[(a,p),(b,q)] = sum_rs d_r N_a d_s N_b
// D[v(p,r)][v(q,s)] with v the Voigt index of the (p, r) pair.
//
// Total formulation with element birth (Section 6.5):
//   sigma = D(T) (eps - eps_b - [F(T) - F(Tb)]),  eps_b = B q_b
// where q_b (33 DOFs: nodal + incompatible) is the element state when its
// material was born, so the birth load is K33(T) q_b and the thermal load is
// the integral of B^T D [F(T) - F(Tb)].

const VOIGT_IDX = [[0, 3, 5], [3, 1, 4], [5, 4, 2]];

/** Universal natural-coordinate integrals for the 11 functions at 3 zeta stations. */
const UNIV = (() => {
  const G = new Float64Array(3 * 9 * 121);   // [j][rs][a*11+b]
  const g = new Float64Array(3 * 3 * 11);    // [j][r][a]
  const GH = new Float64Array(9 * 121);      // full-box integral
  const gH = new Float64Array(3 * 11);
  const simpson = [1 / 3, 4 / 3, 1 / 3];
  const d = [new Float64Array(11), new Float64Array(11), new Float64Array(11)];
  for (let j = 0; j < 3; j++) {
    const zeta = j - 1;
    for (let ip = 0; ip < 4; ip++) {
      const xi = (ip & 1) ? GP2 : -GP2, eta = (ip & 2) ? GP2 : -GP2;
      for (let a = 0; a < 8; a++) {
        const xa = HEX_XI[a], ya = HEX_ETA[a], za = HEX_ZETA[a];
        d[0][a] = xa * (1 + ya * eta) * (1 + za * zeta) * 0.125;
        d[1][a] = ya * (1 + xa * xi) * (1 + za * zeta) * 0.125;
        d[2][a] = za * (1 + xa * xi) * (1 + ya * eta) * 0.125;
      }
      d[0][8] = -2 * xi; d[1][8] = 0; d[2][8] = 0;
      d[0][9] = 0; d[1][9] = -2 * eta; d[2][9] = 0;
      d[0][10] = 0; d[1][10] = 0; d[2][10] = -2 * zeta;
      for (let r = 0; r < 3; r++) {
        for (let a = 0; a < 11; a++) {
          g[(j * 3 + r) * 11 + a] += d[r][a];
          gH[r * 11 + a] += simpson[j] * d[r][a];
          for (let s = 0; s < 3; s++) for (let b = 0; b < 11; b++) {
            const v = d[r][a] * d[s][b];
            G[((j * 9 + r * 3 + s) * 121) + a * 11 + b] += v;
            GH[(r * 3 + s) * 121 + a * 11 + b] += simpson[j] * v;
          }
        }
      }
    }
  }
  return { G, g, GH, gH };
})();

/**
 * 33x33 stiffness of a box element from stiffness weights at the three zeta
 * stations (Wst, 3 x 36, already including the zeta integration weights) or
 * from a single D (homogeneous, uses the full-box integrals).
 */
function elementK33(hx, hy, hz, Wst, D, K) {
  K.fill(0);
  const h = [hx, hy, hz];
  const V8 = hx * hy * hz / 8;
  const nst = D ? 1 : 3;
  for (let j = 0; j < nst; j++) {
    const Wj = D ? D : Wst.subarray(36 * j, 36 * j + 36);
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) {
      const c = V8 * (2 / h[r]) * (2 / h[s]);
      const Gb = D ? UNIV.GH.subarray((r * 3 + s) * 121, (r * 3 + s) * 121 + 121) : UNIV.G.subarray((j * 9 + r * 3 + s) * 121, (j * 9 + r * 3 + s) * 121 + 121);
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
        const dv = c * Wj[VOIGT_IDX[p][r] * 6 + VOIGT_IDX[q][s]];
        if (dv === 0) continue;
        for (let a = 0; a < NFUN; a++) {
          const ga = Gb.subarray(a * 11, a * 11 + 11);
          const row = (3 * a + p) * 33 + q;
          for (let b = 0; b < NFUN; b++) K[row + 3 * b] += dv * ga[b];
        }
      }
    }
  }
  return K;
}

/**
 * Box-element shape matrices M^{rs} (33 x 33) such that
 *   K33 = sum_{r,s} c_rs M^{rs},  c_rs = (hx hy hz / 8)(2 / h_r)(2 / h_s),
 * built once per material and temperature. Since c_rs = c_sr the six
 * symmetric combinations (rr) and (rs + sr, r < s) are stored: index
 * 0:xx 1:yy 2:zz 3:xy 4:yz 5:zx.
 */
function shapeMatrices(Wst, D, M) {
  M = M || new Float64Array(6 * 1089);
  M.fill(0);
  const nst = D ? 1 : 3;
  const PAIR = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 0, 1], [4, 1, 2], [5, 2, 0]];
  for (let j = 0; j < nst; j++) {
    const Wj = D ? D : Wst.subarray(36 * j, 36 * j + 36);
    for (const [m, r, s] of PAIR) {
      const Mm = M.subarray(m * 1089, m * 1089 + 1089);
      const rsList = r === s ? [[r, s]] : [[r, s], [s, r]];
      for (const [rr, ss] of rsList) {
        const Gb = D ? UNIV.GH.subarray((rr * 3 + ss) * 121, (rr * 3 + ss) * 121 + 121) : UNIV.G.subarray((j * 9 + rr * 3 + ss) * 121, (j * 9 + rr * 3 + ss) * 121 + 121);
        for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
          const dv = Wj[VOIGT_IDX[p][rr] * 6 + VOIGT_IDX[q][ss]];
          if (dv === 0) continue;
          for (let a = 0; a < NFUN; a++) {
            const row = (3 * a + p) * 33 + q, ga = a * 11;
            for (let b = 0; b < NFUN; b++) Mm[row + 3 * b] += dv * Gb[ga + b];
          }
        }
      }
    }
  }
  return M;
}

/** K33 (full, symmetric) from shape matrices and box dimensions. */
function elementK33Fast(hx, hy, hz, M, K) {
  const V8 = hx * hy * hz / 8;
  const c = [V8 * 4 / (hx * hx), V8 * 4 / (hy * hy), V8 * 4 / (hz * hz), V8 * 4 / (hx * hy), V8 * 4 / (hy * hz), V8 * 4 / (hz * hx)];
  for (let i = 0; i < 33; i++) {
    const ri = i * 33;
    for (let j = i; j < 33; j++) {
      const o = ri + j;
      K[o] = c[0] * M[o] + c[1] * M[1089 + o] + c[2] * M[2178 + o] + c[3] * M[3267 + o] + c[4] * M[4356 + o] + c[5] * M[5445 + o];
    }
  }
  for (let i = 0; i < 33; i++) for (let j = i + 1; j < 33; j++) K[j * 33 + i] = K[i * 33 + j];
  return K;
}

/**
 * Thermal load (33) of a box element: integral of B^T s with s the thermal
 * stress weights per zeta station (Sst, 3 x 6, including zeta weights) or a
 * single stress s0 (6) for a homogeneous element.
 */
function elementFth(hx, hy, hz, Sst, s0, f) {
  f.fill(0);
  const h = [hx, hy, hz];
  const V8 = hx * hy * hz / 8;
  const nst = s0 ? 1 : 3;
  for (let j = 0; j < nst; j++) {
    const Sj = s0 ? s0 : Sst.subarray(6 * j, 6 * j + 6);
    for (let r = 0; r < 3; r++) {
      const c = V8 * (2 / h[r]);
      const gb = s0 ? UNIV.gH.subarray(r * 11, r * 11 + 11) : UNIV.g.subarray((j * 3 + r) * 11, (j * 3 + r) * 11 + 11);
      for (let p = 0; p < 3; p++) {
        const sv = c * Sj[VOIGT_IDX[p][r]];
        if (sv === 0) continue;
        for (let a = 0; a < NFUN; a++) f[3 * a + p] += sv * gb[a];
      }
    }
  }
  return f;
}

/** y = K33 x (33). */
function mul33(K, x, y) {
  for (let i = 0; i < 33; i++) { let s = 0; const r = i * 33; for (let j = 0; j < 33; j++) s += K[r + j] * x[j]; y[i] = s; }
  return y;
}

/** Full (both triangles) block CSR pattern from the upper one. */
function fullPatternFromUpper(P) {
  const n = P.n;
  const cnt = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) { const j = P.col[k]; cnt[i + 1]++; if (j !== i) cnt[j + 1]++; }
  for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
  const col = new Int32Array(cnt[n]), fill = cnt.slice(0, n);
  for (let i = 0; i < n; i++) for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) { const j = P.col[k]; col[fill[i]++] = j; if (j !== i) col[fill[j]++] = i; }
  // sort each row
  for (let i = 0; i < n; i++) { const s = col.subarray(cnt[i], cnt[i + 1]); s.sort(); }
  const diag = new Int32Array(n);
  for (let i = 0; i < n; i++) for (let k = cnt[i]; k < cnt[i + 1]; k++) if (col[k] === i) { diag[i] = k; break; }
  return { n, rowPtr: cnt, col, nb: cnt[n], diag };
}

/** y = K x for a full block CSR. */
function fullMatVec(P, val, x, y) {
  const n = P.n, rp = P.rowPtr, col = P.col;
  for (let i = 0; i < n; i++) {
    let y0 = 0, y1 = 0, y2 = 0;
    for (let k = rp[i]; k < rp[i + 1]; k++) {
      const j = col[k], v = 9 * k;
      const xj0 = x[3 * j], xj1 = x[3 * j + 1], xj2 = x[3 * j + 2];
      y0 += val[v] * xj0 + val[v + 1] * xj1 + val[v + 2] * xj2;
      y1 += val[v + 3] * xj0 + val[v + 4] * xj1 + val[v + 5] * xj2;
      y2 += val[v + 6] * xj0 + val[v + 7] * xj1 + val[v + 8] * xj2;
    }
    y[3 * i] = y0; y[3 * i + 1] = y1; y[3 * i + 2] = y2;
  }
  return y;
}

/**
 * Finite-element model of a mesh: group property tables, element birth
 * states, sparsity, assembly and strain / stress recovery.
 */
class FEModel {
  constructor(mesh, cfg, opts) {
    opts = opts || {};
    this.mesh = mesh;
    this.cfg = cfg;
    this.lib = cfg.materials;
    this.nuMax = opts.nuMax || CONST.NU_MAX_GLOBAL;
    this.birthT = opts.birthT || [cfg.process.Tsub, cfg.process.Tjoin, cfg.process.Tuf, cfg.process.Tattach];
    const t0 = nowMs();
    this.groups = mesh.groups.map(g => this._prepareGroup(g));
    this.sections = mesh.geom ? mesh.geom.sub.bands.map(b => buildBandSection(b, this.lib, this.nuMax)) : (opts.sections || []);
    this.qb = new Float64Array(mesh.ne * 33);
    this.upper = bcsrFromElements(mesh.nn, mesh.conn, mesh.ne, 8);
    this.pattern = fullPatternFromUpper(this.upper);
    this.bmap = this._blockMap();
    this.val = new Float64Array(this.pattern.nb * 9);
    this.ndof = 3 * mesh.nn;
    this.constraints = mesh.constraints ? mesh.constraints.dofs : (opts.constraints || new Int32Array(0));
    this.setupMs = nowMs() - t0;
    this._K33 = new Float64Array(1089); this._f33 = new Float64Array(33); this._tmp33 = new Float64Array(33);
    this._W = new Float64Array(108); this._V = new Float64Array(18); this._D = new Float64Array(36); this._s0 = new Float64Array(6);
    this._cond = { Kc: new Float64Array(576), fc: new Float64Array(24), X: new Float64Array(216), xf: new Float64Array(9) };
  }

  /** Per-group stiffness and thermal-strain tables on the 1 degC grid. */
  _prepareGroup(g) {
    const out = Object.assign({}, g);
    if (g.kind === 'layered') return out;
    if (g.kind === 'rowmat') {
      // one homogenized substrate row as a homogeneous orthotropic material (V5)
      out.Dgrid = new Float64Array(TGRID_N * 36);
      out.F = new Float64Array(TGRID_N * 3);
      const tmp = new Float64Array(36);
      const al = [];
      for (let k = 0; k <= 2 * (TGRID_N - 1); k++) { const ec = substrateRowEC(g.row, CONST.TGRID_MIN + 0.5 * k, this.lib); al.push([ec.ax, ec.ay, ec.az]); }
      for (let i = 1; i < TGRID_N; i++) for (let c = 0; c < 3; c++) out.F[3 * i + c] = out.F[3 * (i - 1) + c] + (al[2 * (i - 1)][c] + 4 * al[2 * i - 1][c] + al[2 * i][c]) / 6;
      const i25 = CONST.T_STRAIN_ORIGIN - CONST.TGRID_MIN;
      for (let c = 0; c < 3; c++) { const off = out.F[3 * i25 + c]; for (let i = 0; i < TGRID_N; i++) out.F[3 * i + c] -= off; }
      for (let i = 0; i < TGRID_N; i++) { orthoD(substrateRowEC(g.row, CONST.TGRID_MIN + i, this.lib), this.nuMax, tmp); out.Dgrid.set(tmp, 36 * i); }
      out.tgs = [];
      return out;
    }
    const mat = findMaterial(this.lib, g.mat);
    out.material = mat;
    out.tgs = materialTgs(mat);
    const ctes = materialCte(mat);
    out.F = new Float64Array(TGRID_N * 3);
    for (let i = 0; i < TGRID_N; i++) {
      const T = CONST.TGRID_MIN + i;
      const fxy = thermalStrain(ctes.xy, T), fz = (ctes.z === ctes.xy) ? fxy : thermalStrain(ctes.z, T);
      out.F[3 * i] = fxy; out.F[3 * i + 1] = fxy; out.F[3 * i + 2] = fz;
    }
    if (mat.elastic.type === 'cubic') {
      out.Dconst = siliconD(mat, g.siModel || 'aniso');
      out.solidus = null;
    } else if (mat.elastic.type === 'iso') {
      const t = materialTables(mat);
      const constE = mat.elastic.E.type === 'const' && !mat.solidus;
      if (constE) out.Dconst = isoD(t.E[0], t.nu, this.nuMax);
      else {
        out.Dgrid = new Float64Array(TGRID_N * 36);
        const tmp = new Float64Array(36);
        for (let i = 0; i < TGRID_N; i++) { isoD(t.E[i], t.nu, this.nuMax, tmp); out.Dgrid.set(tmp, 36 * i); }
      }
      out.solidus = mat.solidus ? pv(mat.solidus) : null;
    } else if (mat.elastic.type === 'ortho') {
      out.Dgrid = new Float64Array(TGRID_N * 36);
      const tmp = new Float64Array(36);
      for (let i = 0; i < TGRID_N; i++) { orthoD(materialEC(mat, CONST.TGRID_MIN + i), this.nuMax, tmp); out.Dgrid.set(tmp, 36 * i); }
    }
    return out;
  }

  groupD(g, T, out) {
    if (g.Dconst) { out.set(g.Dconst); return out; }
    let x = clamp(T - CONST.TGRID_MIN, 0, TGRID_N - 1);
    const i = Math.min(Math.floor(x), TGRID_N - 2), t = x - i;
    const a = 36 * i, b = a + 36;
    for (let q = 0; q < 36; q++) out[q] = g.Dgrid[a + q] + t * (g.Dgrid[b + q] - g.Dgrid[a + q]);
    return out;
  }

  /** Thermal strain difference F(T) - F(Tb) (3 normal components) of a homogeneous group. */
  groupDF(g, T, Tb, out) {
    for (let c = 0; c < 3; c++) out[c] = gridAt(g.F, T, 3, c) - gridAt(g.F, Tb, 3, c);
    return out;
  }

  _blockMap() {
    const m = this.mesh, P = this.pattern;
    const map = new Int32Array(m.ne * 64);
    for (let e = 0; e < m.ne; e++) for (let a = 0; a < 8; a++) {
      const na = m.conn[8 * e + a];
      for (let b = 0; b < 8; b++) {
        const nb = m.conn[8 * e + b];
        // binary search in row na
        let lo = P.rowPtr[na], hi = P.rowPtr[na + 1] - 1, k = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; const v = P.col[mid]; if (v === nb) { k = mid; break; } if (v < nb) lo = mid + 1; else hi = mid - 1; }
        map[(e * 8 + a) * 8 + b] = k;
      }
    }
    return map;
  }

  elementDims(e) {
    const m = this.mesh, i = m.eIJK[3 * e], j = m.eIJK[3 * e + 1], k = m.eIJK[3 * e + 2];
    return [m.xs[i + 1] - m.xs[i], m.ys[j + 1] - m.ys[j], m.zs[k + 1] - m.zs[k]];
  }

  isBorn(g, stage) { return g.stage <= stage; }

  /** Per-temperature group data: shape matrices and thermal stress weights. */
  prepareT(T, stage) {
    if (this._prepT === T && this._prepStage === stage) return;
    this._prepT = T; this._prepStage = stage;
    for (const g of this.groups) {
      if (g.kind === 'layered') continue;
      g._D = g._D || new Float64Array(36);
      this.groupD(g, T, g._D);
      g._M = shapeMatrices(null, g._D, g._M);
      g._born = this.isBorn(g, stage);
      if (g._born) {
        const dF = this.groupDF(g, T, this.birthT[g.stage], this._s0);
        g._s0 = g._s0 || new Float64Array(6);
        const D = g._D;
        for (let r = 0; r < 6; r++) g._s0[r] = D[r * 6] * dF[0] + D[r * 6 + 1] * dF[1] + D[r * 6 + 2] * dF[2];
      }
    }
    for (const sec of this.sections) {
      sectionW(sec, T, this._W);
      sec._M = shapeMatrices(this._W, null, sec._M);
      sec._V = sectionV(sec, T, this.birthT[0], sec._V);
    }
  }

  /**
   * Element stiffness K33 (and load f33 when born) at temperature T. Returns
   * true when the load is non-zero.
   */
  elementSystem(e, T, stage, K33, f33) {
    this.prepareT(T, stage);
    const m = this.mesh, g = this.groups[m.eGroup[e]];
    const i = m.eIJK[3 * e], j = m.eIJK[3 * e + 1], k = m.eIJK[3 * e + 2];
    const hx = m.xs[i + 1] - m.xs[i], hy = m.ys[j + 1] - m.ys[j], hz = m.zs[k + 1] - m.zs[k];
    const born = g.stage <= stage;
    let hasF = false;
    if (g.kind === 'layered') {
      const sec = this.sections[m.subBand[k]];
      elementK33Fast(hx, hy, hz, sec._M, K33);
      if (born) { elementFth(hx, hy, hz, sec._V, null, f33); hasF = true; }
    } else {
      elementK33Fast(hx, hy, hz, g._M, K33);
      if (born) { elementFth(hx, hy, hz, null, g._s0, f33); hasF = true; }
    }
    if (born && g.stage > 0) {
      const qb = this.qb.subarray(33 * e, 33 * e + 33);
      const t = this._tmp33;
      mul33(K33, qb, t);
      for (let i = 0; i < 33; i++) f33[i] += t[i];
      hasF = true;
    }
    return hasF;
  }

  /**
   * Assemble K(T) (full block CSR values) and the load vector for the given
   * stage. Unborn elements keep UNBORN_SCALE x stiffness and no load.
   */
  assemble(T, stage, rhs, noConstraints) {
    const m = this.mesh, val = this.val, bmap = this.bmap;
    val.fill(0); rhs.fill(0);
    const K33 = this._K33, f33 = this._f33, cond = this._cond;
    for (let e = 0; e < m.ne; e++) {
      const g = this.groups[m.eGroup[e]];
      const born = this.isBorn(g, stage);
      const scale = m.eScale[e] * (born ? 1 : CONST.UNBORN_SCALE);
      f33.fill(0);
      const hasF = this.elementSystem(e, T, stage, K33, f33);
      condense33(K33, hasF ? f33 : null, cond);
      const Kc = cond.Kc;
      for (let a = 0; a < 8; a++) {
        for (let b = 0; b < 8; b++) {
          const k = bmap[(e * 8 + a) * 8 + b];
          const v = 9 * k;
          for (let p = 0; p < 3; p++) {
            const r = (3 * a + p) * 24 + 3 * b;
            val[v + 3 * p] += scale * Kc[r]; val[v + 3 * p + 1] += scale * Kc[r + 1]; val[v + 3 * p + 2] += scale * Kc[r + 2];
          }
        }
        if (hasF) {
          const n = m.conn[8 * e + a];
          rhs[3 * n] += scale * cond.fc[3 * a]; rhs[3 * n + 1] += scale * cond.fc[3 * a + 1]; rhs[3 * n + 2] += scale * cond.fc[3 * a + 2];
        }
      }
    }
    if (!noConstraints) this.applyConstraints(rhs);
  }

  /** Zero rows / columns of the constrained DOFs (diagonal kept), zero rhs. */
  applyConstraints(rhs) {
    const P = this.pattern, val = this.val;
    const isC = new Uint8Array(this.ndof);
    for (const d of this.constraints) isC[d] = 1;
    this.isConstrained = isC;
    for (const d of this.constraints) {
      const i = Math.floor(d / 3), p = d % 3;
      for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
        const j = P.col[k], v = 9 * k;
        for (let q = 0; q < 3; q++) { if (3 * j + q !== d) val[v + 3 * p + q] = 0; }
        // symmetric counterpart: block (j, i), column p
        let lo = P.rowPtr[j], hi = P.rowPtr[j + 1] - 1, kk = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; const c = P.col[mid]; if (c === i) { kk = mid; break; } if (c < i) lo = mid + 1; else hi = mid - 1; }
        const w = 9 * kk;
        for (let q = 0; q < 3; q++) { if (3 * j + q !== d) val[w + 3 * q + p] = 0; }
      }
      if (rhs) rhs[d] = 0;
    }
  }

  /** Element DOF vector (24) from the global solution. */
  elementU(u, e, out) {
    const m = this.mesh;
    for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; out[3 * a] = u[3 * n]; out[3 * a + 1] = u[3 * n + 1]; out[3 * a + 2] = u[3 * n + 2]; }
    return out;
  }

  /**
   * Full element state q (33) at temperature T for solution u: nodal DOFs plus
   * recovered incompatible-mode parameters alpha = K_aa^-1 (f_a - K_au u).
   */
  elementState(e, T, stage, u, q) {
    const K33 = this._K33, f33 = this._f33;
    f33.fill(0);
    this.elementSystem(e, T, stage, K33, f33);
    this.elementU(u, e, q);
    const Kaa = condense33._Kaa, col = condense33._col;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) Kaa[i * 9 + j] = K33[(24 + i) * 33 + 24 + j];
    cholDense(Kaa, 9, 1e-14);
    for (let i = 0; i < 9; i++) {
      let s = f33[24 + i];
      for (let j = 0; j < 24; j++) s -= K33[(24 + i) * 33 + j] * q[j];
      col[i] = s;
    }
    cholSolveDense(Kaa, 9, col, 0);
    for (let i = 0; i < 9; i++) q[24 + i] = col[i];
    return q;
  }

  /** Record the birth state q_b of every element of the given stage from solution u at T. */
  recordBirth(stage, T, u) {
    const m = this.mesh, q = new Float64Array(33);
    for (let e = 0; e < m.ne; e++) {
      const g = this.groups[m.eGroup[e]];
      if (g.stage !== stage) continue;
      this.elementState(e, T, stage - 1, u, q);
      this.qb.set(q, 33 * e);
    }
  }

  /**
   * Stress and strain of element e at natural point (xi, eta, zeta) from a
   * recovered state q at T. Returns {eps (total), sig}. Layered elements use
   * the sub-layer stiffness at that zeta.
   */
  pointStress(e, T, stage, q, xi, eta, zeta, out) {
    out = out || { eps: new Float64Array(6), sig: new Float64Array(6), mech: new Float64Array(6) };
    const m = this.mesh, g = this.groups[m.eGroup[e]];
    const [hx, hy, hz] = this.elementDims(e);
    const qb = this.qb.subarray(33 * e, 33 * e + 33);
    const dq = this._tmp33;
    for (let i = 0; i < 33; i++) dq[i] = q[i] - qb[i];
    boxStrainAt(hx, hy, hz, q, q.subarray(24), xi, eta, zeta, out.eps);
    boxStrainAt(hx, hy, hz, dq, dq.subarray(24), xi, eta, zeta, out.mech);
    const born = this.isBorn(g, stage);
    const Tb = this.birthT[g.stage];
    const D = this._D;
    let dF;
    if (g.kind === 'layered') {
      const sec = this.sections[m.subBand[m.eIJK[3 * e + 2]]];
      const z = m.zs[m.eIJK[3 * e + 2]] + 0.5 * (zeta + 1) * hz;
      let s = sec.ns - 1;
      for (let q2 = 0; q2 < sec.ns; q2++) if (z <= sec.subZ[q2][1] + 1e-12) { s = q2; break; }
      let x = clamp(T - CONST.TGRID_MIN, 0, TGRID_N - 1);
      const i = Math.min(Math.floor(x), TGRID_N - 2), t = x - i;
      const da = (s * TGRID_N + i) * 36, db = da + 36;
      for (let r = 0; r < 36; r++) D[r] = sec.D[da + r] + t * (sec.D[db + r] - sec.D[da + r]);
      const fb = s * TGRID_N * 3;
      const Fs = sec.F.subarray(fb, fb + TGRID_N * 3);
      dF = [gridAt(Fs, T, 3, 0) - gridAt(Fs, Tb, 3, 0), gridAt(Fs, T, 3, 1) - gridAt(Fs, Tb, 3, 1), gridAt(Fs, T, 3, 2) - gridAt(Fs, Tb, 3, 2)];
    } else {
      this.groupD(g, T, D);
      dF = this.groupDF(g, T, Tb, this._s0);
    }
    const em = out.mech;
    if (!born) { out.sig.fill(0); return out; }
    const e0 = em[0] - dF[0], e1 = em[1] - dF[1], e2 = em[2] - dF[2];
    for (let r = 0; r < 6; r++) out.sig[r] = D[r * 6] * e0 + D[r * 6 + 1] * e1 + D[r * 6 + 2] * e2 + D[r * 6 + 3] * em[3] + D[r * 6 + 4] * em[4] + D[r * 6 + 5] * em[5];
    return out;
  }
}
