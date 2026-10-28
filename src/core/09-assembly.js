// ===== Model assembly: element birth, thermal loads, full block CSR =====
//
// Box elements use closed-form integration: in natural coordinates the
// products d_r N_a d_s N_b are integrated once (2x2 Gauss in-plane, exact
// quadratic Lagrange / Simpson through the thickness, which for a trilinear
// element reproduces 2x2x2 Gauss exactly) and scaled per element by
// (hx hy hz / 8) (2 / h_r) (2 / h_s). K[(a,p),(b,q)] = sum_rs d_r N_a d_s N_b
// D[v(p,r)][v(q,s)] with v the Voigt index of the (p, r) pair.
//
// Incremental (rate-form) thermoelasticity with element birth (Section 6.5, as
// amended): d sigma = D(T) (d eps - alpha dT), integrated along the actual
// temperature path in steps [Ta, Tb]. With the strain taken linear in T within a
// step, the step is exact with the mean stiffness D_m over the step and the
// thermal stress increment s_th = integral of D dF from Ta to Tb:
//   K(D_m) du = integral B^T s_th dV   (born materials only)
//   sigma    += D_m B dq - s_th
// A material is born stress-free at its stage's birth temperature, so it simply
// starts accumulating at its first step. The stress already present is in
// equilibrium, so every step is an independent linear solve. A total (secant)
// form D(T) (eps - [F(T) - F(Tb)]) would apply the glassy modulus to all the
// contraction a polymer made while rubbery and overstate its stress severalfold.

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

/** Strain monomials of a box element with incompatible modes: 1, xi, eta, zeta, xi eta, eta zeta, xi zeta. */
const STRAIN_MONO = 7;

/**
 * Strain of a box element as a polynomial in the natural coordinates:
 * eps(xi, eta, zeta) = sum_m phi_m E_m with phi = [1, xi, eta, zeta, xi eta,
 * eta zeta, xi zeta] (exact for the trilinear field plus the three
 * incompatible modes). E (42) holds the six strain components per monomial.
 */
function boxStrainPoly(hx, hy, hz, q, E) {
  E.fill(0);
  const sx = 2 / hx, sy = 2 / hy, sz = 2 / hz;
  for (let a = 0; a < 8; a++) {
    const xa = HEX_XI[a], ya = HEX_ETA[a], za = HEX_ZETA[a], ux = q[3 * a], uy = q[3 * a + 1], uz = q[3 * a + 2];
    // d/dx: monomials 1, eta, zeta, eta zeta; d/dy: 1, xi, zeta, xi zeta; d/dz: 1, xi, eta, xi eta
    const cx = xa * sx / 8, cy = ya * sy / 8, cz = za * sz / 8;
    const dx = [[0, cx], [2, cx * ya], [3, cx * za], [5, cx * ya * za]];
    const dy = [[0, cy], [1, cy * xa], [3, cy * za], [6, cy * xa * za]];
    const dz = [[0, cz], [1, cz * xa], [2, cz * ya], [4, cz * xa * ya]];
    for (const [m, c] of dx) { E[6 * m] += c * ux; E[6 * m + 3] += c * uy; E[6 * m + 5] += c * uz; }
    for (const [m, c] of dy) { E[6 * m + 1] += c * uy; E[6 * m + 3] += c * ux; E[6 * m + 4] += c * uz; }
    for (const [m, c] of dz) { E[6 * m + 2] += c * uz; E[6 * m + 4] += c * uy; E[6 * m + 5] += c * ux; }
  }
  // incompatible modes: d(1 - xi^2)/dx = -2 xi sx, and likewise for eta and zeta
  const a1 = q.subarray(24, 27), a2 = q.subarray(27, 30), a3 = q.subarray(30, 33);
  E[6 * 1] += -2 * sx * a1[0]; E[6 * 1 + 3] += -2 * sx * a1[1]; E[6 * 1 + 5] += -2 * sx * a1[2];
  E[6 * 2 + 1] += -2 * sy * a2[1]; E[6 * 2 + 3] += -2 * sy * a2[0]; E[6 * 2 + 4] += -2 * sy * a2[2];
  E[6 * 3 + 2] += -2 * sz * a3[2]; E[6 * 3 + 4] += -2 * sz * a3[1]; E[6 * 3 + 5] += -2 * sz * a3[0];
  return E;
}

/** Monomial values phi (7) at (xi, eta, zeta). */
function strainMonomials(xi, eta, zeta, phi) {
  phi[0] = 1; phi[1] = xi; phi[2] = eta; phi[3] = zeta; phi[4] = xi * eta; phi[5] = eta * zeta; phi[6] = xi * zeta;
  return phi;
}

/**
 * Finite-element model of a mesh: group property tables, sparsity, assembly of
 * the steps of the thermal path and element stress histories.
 */
class FEModel {
  constructor(mesh, cfg, opts) {
    opts = opts || {};
    this.mesh = mesh;
    this.cfg = cfg;
    this.lib = cfg.materials;
    this.nuMax = opts.nuMax || CONST.NU_MAX_GLOBAL;
    const t0 = nowMs();
    this.groups = mesh.groups.map(g => this._prepareGroup(g));
    // layered sections (substrate bands, RDL interposer layers), each with the group it belongs to (birth stage)
    const bands = mesh.layeredBands || (mesh.geom ? mesh.geom.sub.bands : null);
    this.sections = bands ? bands.map(b => Object.assign(buildBandSection(b, this.lib, this.nuMax), { group: b.group })) : (opts.sections || []);
    this.upper = bcsrFromElements(mesh.nn, mesh.conn, mesh.ne, 8);
    this.pattern = fullPatternFromUpper(this.upper);
    this.bmap = this._blockMap();
    this.val = new Float64Array(this.pattern.nb * 9);
    this.ndof = 3 * mesh.nn;
    this.constraints = mesh.constraints ? mesh.constraints.dofs : (opts.constraints || new Int32Array(0));
    // stacked-module stages (negative) add each module's own 3-2-1 support (buildPackageMesh)
    this.moduleConstraints = mesh.moduleConstraints ? Int32Array.from([...this.constraints, ...mesh.moduleConstraints]) : null;
    this.setupMs = nowMs() - t0;
    this._K33 = new Float64Array(1089); this._f33 = new Float64Array(33);
    this._W = new Float64Array(108); this._s0 = new Float64Array(6);
    this._cond = { Kc: new Float64Array(576), fc: new Float64Array(24), X: new Float64Array(216), xf: new Float64Array(9) };
    this._Kr = new Float64Array(297); this._E = new Float64Array(6 * STRAIN_MONO); this._phi = new Float64Array(STRAIN_MONO); this._dq = new Float64Array(33);
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
      // the solder phase of the bump layer is an array of separate columns (columnD), any other isotropic material a continuum
      const mk = (E, D) => g.column ? columnD(E, t.nu, D) : isoD(E, t.nu, this.nuMax, D);
      if (g.series) this._seriesColumn(out, mat, t);
      else if (constE) out.Dconst = mk(t.E[0], new Float64Array(36));
      else {
        out.Dgrid = new Float64Array(TGRID_N * 36);
        const tmp = new Float64Array(36);
        for (let i = 0; i < TGRID_N; i++) { mk(t.E[i], tmp); out.Dgrid.set(tmp, 36 * i); }
      }
      out.solidus = mat.solidus ? pv(mat.solidus) : null;
    } else if (mat.elastic.type === 'ortho') {
      out.Dgrid = new Float64Array(TGRID_N * 36);
      const tmp = new Float64Array(36);
      for (let i = 0; i < TGRID_N; i++) { orthoD(materialEC(mat, CONST.TGRID_MIN + i), this.nuMax, tmp); out.Dgrid.set(tmp, 36 * i); }
    }
    return out;
  }

  /**
   * Column of two materials in series along z (a DDI microbump: solder cap with a height fraction 1 - f on a
   * Cu pillar of fraction f): axial and shear compliances add by height,
   *   1/E = (1 - f)/E_s + f/E_p,  1/G = (1 - f)/G_s + f/G_p,  F = (1 - f) F_s + f F_p,
   * and columnD carries E with the Poisson ratio that reproduces G (nu = E / 2G - 1).
   */
  _seriesColumn(out, mat, t) {
    const fp = out.series.f, sp = findMaterial(this.lib, out.series.mat), tp = materialTables(sp);
    out.Dgrid = new Float64Array(TGRID_N * 36);
    const tmp = new Float64Array(36);
    for (let i = 0; i < TGRID_N; i++) {
      const Es = t.E[i], Ep = tp.E[i], Gs = Es / (2 * (1 + t.nu)), Gp = Ep / (2 * (1 + tp.nu));
      const E = 1 / ((1 - fp) / Es + fp / Ep), G = 1 / ((1 - fp) / Gs + fp / Gp);
      columnD(E, E / (2 * G) - 1, tmp);
      out.Dgrid.set(tmp, 36 * i);
      for (let c = 0; c < 3; c++) out.F[3 * i + c] = (1 - fp) * out.F[3 * i + c] + fp * tp.F[i];
    }
  }

  /** Layered section of a layered element (its group's section of that element layer). */
  sectionOf(e) {
    const m = this.mesh, k = m.eIJK[3 * e + 2], g = this.groups[m.eGroup[e]];
    return this.sections[(g.secK || m.subBand)[k]];
  }

  /** Index of the layered section of a layered element. */
  sectionIndex(e) {
    const m = this.mesh, g = this.groups[m.eGroup[e]];
    return (g.secK || m.subBand)[m.eIJK[3 * e + 2]];
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

  /**
   * Group data of one step of the thermal path from Ta to Tb in a stage: the
   * mean stiffness over the step with its shape matrices, and the thermal
   * stress increment (integral of D dF) of every born group.
   */
  prepareStep(Ta, Tb, stage) {
    const key = Ta + '|' + Tb + '|' + stage;
    if (this._prepKey === key) return;
    this._prepKey = key;
    for (const g of this.groups) {
      if (g.kind === 'layered') continue;
      g._D = g.Dconst ? Float64Array.from(g.Dconst) : gridMean(g.Dgrid, 36, 36, Ta, Tb, g._D);
      g._M = shapeMatrices(null, g._D, g._M);
      g._born = this.isBorn(g, stage);
      g._s0 = g._s0 || new Float64Array(6);
      if (g._born) gridStressIncrement(g.Dconst ? null : g.Dgrid, g.Dconst, g.F, Ta, Tb, g._s0); else g._s0.fill(0);
    }
    for (const sec of this.sections) {
      sectionWmean(sec, Ta, Tb, this._W);
      sec._M = shapeMatrices(this._W, null, sec._M);
      sec._born = sec.group == null || this.isBorn(this.groups[sec.group], stage);
      sec._V = sectionVstep(sec, Ta, Tb, sec._V);
      if (!sec._born) sec._V.fill(0);
    }
  }

  /** Element stiffness K33 and thermal load f33 of the prepared step. Returns true when the load is non-zero. */
  elementSystem(e, K33, f33) {
    const m = this.mesh, g = this.groups[m.eGroup[e]];
    const i = m.eIJK[3 * e], j = m.eIJK[3 * e + 1], k = m.eIJK[3 * e + 2];
    const hx = m.xs[i + 1] - m.xs[i], hy = m.ys[j + 1] - m.ys[j], hz = m.zs[k + 1] - m.zs[k];
    if (g.kind === 'layered') {
      const sec = this.sectionOf(e);
      elementK33Fast(hx, hy, hz, sec._M, K33);
      if (!sec._born) return false;
      elementFth(hx, hy, hz, sec._V, null, f33);
      return true;
    }
    elementK33Fast(hx, hy, hz, g._M, K33);
    if (!g._born) return false;
    elementFth(hx, hy, hz, null, g._s0, f33);
    return true;
  }

  /**
   * Assemble K with the step's mean stiffness (full block CSR values) and the thermal load of the step
   * from Ta to Tb in a stage. Unborn elements keep UNBORN_SCALE x stiffness and no load, except in the
   * stacked-module stages (negative): there only the born module parts are assembled and every node
   * outside them is held, so each module stands alone on its own 3-2-1 support and the substrate, not yet
   * part of the process, neither moves nor holds the modules back.
   */
  assembleStep(Ta, Tb, stage, rhs, noConstraints) {
    this.prepareStep(Ta, Tb, stage);
    const m = this.mesh, val = this.val, bmap = this.bmap;
    val.fill(0); rhs.fill(0);
    const K33 = this._K33, f33 = this._f33, cond = this._cond;
    const moduleStage = stage < 0 && !!this.moduleConstraints;
    this.activeKey = moduleStage ? 'stage' + stage : 'all';  // the preconditioner's aggregates follow it (LinearSolver._buildPC)
    for (let e = 0; e < m.ne; e++) {
      const g = this.groups[m.eGroup[e]];
      const born = this.isBorn(g, stage);
      if (moduleStage && !born) continue;
      const scale = m.eScale[e] * (born ? 1 : CONST.UNBORN_SCALE);
      f33.fill(0);
      const hasF = this.elementSystem(e, K33, f33);
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
    if (!noConstraints) this.applyConstraints(rhs, moduleStage ? this.moduleStageConstraints(stage) : this.constraints);
  }

  /** Elements born in a stacked-module stage and the nodes they touch (cached per stage). */
  moduleStageSet(stage) {
    this._modSets = this._modSets || new Map();
    let set = this._modSets.get(stage);
    if (set) return set;
    const m = this.mesh, elems = new Uint8Array(m.ne), nodes = new Uint8Array(m.nn);
    for (let e = 0; e < m.ne; e++) if (this.isBorn(this.groups[m.eGroup[e]], stage)) { elems[e] = 1; for (let a = 0; a < 8; a++) nodes[m.conn[8 * e + a]] = 1; }
    const fixed = new Set(this.moduleConstraints);
    for (let n = 0; n < m.nn; n++) if (!nodes[n]) { fixed.add(3 * n); fixed.add(3 * n + 1); fixed.add(3 * n + 2); }
    set = { elems, nodes, dofs: Int32Array.from(fixed).sort() };
    this._modSets.set(stage, set);
    return set;
  }
  /** Constrained DOFs of a stacked-module stage: each module's 3-2-1 support and every node no born element touches. */
  moduleStageConstraints(stage) { return this.moduleStageSet(stage).dofs; }
  /** Elements and nodes in play for the preconditioner in the current stacked-module stage (null for the whole package). */
  activeSet() { const k = this.activeKey; return k && k !== 'all' ? this.moduleStageSet(+k.slice(5)) : null; }

  /** Zero rows / columns of the constrained DOFs (diagonal kept), zero rhs. */
  applyConstraints(rhs, dofs) {
    const P = this.pattern, val = this.val;
    dofs = dofs || this.constraints;
    const isC = new Uint8Array(this.ndof);
    for (const d of dofs) isC[d] = 1;
    this.isConstrained = isC;
    for (const d of dofs) {
      const i = Math.floor(d / 3), p = d % 3;
      for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
        const j = P.col[k], v = 9 * k;
        for (let q = 0; q < 3; q++) { if (3 * j + q !== d) val[v + 3 * p + q] = 0; else if (val[v + 3 * p + q] === 0) val[v + 3 * p + q] = 1; }  // a held node outside every assembled element gets a unit diagonal
        // symmetric counterpart: block (j, i), column p
        let lo = P.rowPtr[j], hi = P.rowPtr[j + 1] - 1, kk = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; const c = P.col[mid]; if (c === i) { kk = mid; break; } if (c < i) lo = mid + 1; else hi = mid - 1; }
        const w = 9 * kk;
        for (let q = 0; q < 3; q++) { if (3 * j + q !== d) val[w + 3 * q + p] = 0; }
      }
      if (rhs) rhs[d] = 0;
    }
  }

  /** Element DOF vector (24) from a global field. */
  elementU(u, e, out) {
    const m = this.mesh;
    for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; out[3 * a] = u[3 * n]; out[3 * a + 1] = u[3 * n + 1]; out[3 * a + 2] = u[3 * n + 2]; }
    return out;
  }

  /**
   * Compact per-step data for stress histories (kept for every step of the
   * path): per group the mean stiffness, the incompatible-mode rows (24..32)
   * of its shape matrices and the thermal stress increment; per substrate band
   * the same rows, its thermal-stress weights and every sub-layer's mean
   * stiffness and thermal stress increment.
   */
  stepRecovery(Ta, Tb, stage) {
    this.prepareStep(Ta, Tb, stage);
    const rows = M => { const r = new Float64Array(6 * 297); for (let p = 0; p < 6; p++) for (let i = 0; i < 9; i++) for (let j = 0; j < 33; j++) r[p * 297 + i * 33 + j] = M[p * 1089 + (24 + i) * 33 + j]; return r; };
    return {
      Ta, Tb, stage,
      groups: this.groups.map(g => g.kind === 'layered' ? null : { D: Float64Array.from(g._D), Ma: rows(g._M), s0: Float64Array.from(g._s0), born: g._born }),
      sections: this.sections.map(sec => ({
        Ma: rows(sec._M), V: Float64Array.from(sec._V), born: sec._born,
        Ds: Array.from({ length: sec.ns }, (_, s) => sectionSubMeanD(sec, s, Ta, Tb)),
        s0s: Array.from({ length: sec.ns }, (_, s) => sectionSubStress(sec, s, Ta, Tb)),
      })),
    };
  }

  /** Values per element of a stress history state: element DOFs q (33), then 7 strain monomials + 1 thermal term (x 6) per sub-layer. */
  stateSize(e) {
    const m = this.mesh, g = this.groups[m.eGroup[e]];
    const ns = g.kind === 'layered' ? this.sectionOf(e).ns : 1;
    return 33 + ns * 6 * (STRAIN_MONO + 1);
  }

  /**
   * Add one step of the path to the stress history state of element e:
   * dq = (du at the element nodes, d alpha = K_aa^-1 (f_a - K_au du)) with the
   * step's mean stiffness D_m, q += dq, and per sub-layer S_m += D_m E_m(dq),
   * S_th += integral of D dF when the material is born (qOnly: the DOFs only,
   * for strain histories).
   */
  accumulateStep(e, rec, du, state, qOnly) {
    const m = this.mesh, g = this.groups[m.eGroup[e]];
    const i = m.eIJK[3 * e], j = m.eIJK[3 * e + 1], k = m.eIJK[3 * e + 2];
    const hx = m.xs[i + 1] - m.xs[i], hy = m.ys[j + 1] - m.ys[j], hz = m.zs[k + 1] - m.zs[k];
    const layered = g.kind === 'layered';
    const gr = layered ? rec.sections[this.sectionIndex(e)] : rec.groups[m.eGroup[e]];
    const born = layered ? gr.born !== false : gr.born;
    // incompatible-mode rows of K33 and of the load
    const V8 = hx * hy * hz / 8;
    const c = [V8 * 4 / (hx * hx), V8 * 4 / (hy * hy), V8 * 4 / (hz * hz), V8 * 4 / (hx * hy), V8 * 4 / (hy * hz), V8 * 4 / (hz * hx)];
    const Kr = this._Kr, Ma = gr.Ma;
    for (let q = 0; q < 297; q++) Kr[q] = c[0] * Ma[q] + c[1] * Ma[297 + q] + c[2] * Ma[594 + q] + c[3] * Ma[891 + q] + c[4] * Ma[1188 + q] + c[5] * Ma[1485 + q];
    const f33 = this._f33;
    f33.fill(0);
    if (born) elementFth(hx, hy, hz, layered ? gr.V : null, layered ? null : gr.s0, f33);
    const dq = this._dq;
    for (let a = 0; a < 8; a++) { const n = m.conn[8 * e + a]; dq[3 * a] = du[3 * n]; dq[3 * a + 1] = du[3 * n + 1]; dq[3 * a + 2] = du[3 * n + 2]; }
    const Kaa = condense33._Kaa, col = condense33._col;
    for (let r = 0; r < 9; r++) for (let s = 0; s < 9; s++) Kaa[r * 9 + s] = Kr[r * 33 + 24 + s];
    cholDense(Kaa, 9, 1e-14);
    for (let r = 0; r < 9; r++) { let s = f33[24 + r]; for (let t = 0; t < 24; t++) s -= Kr[r * 33 + t] * dq[t]; col[r] = s; }
    cholSolveDense(Kaa, 9, col, 0);
    for (let r = 0; r < 9; r++) dq[24 + r] = col[r];
    for (let q = 0; q < 33; q++) state[q] += dq[q];
    if (!born || qOnly) return;
    const E = boxStrainPoly(hx, hy, hz, dq, this._E);
    const ns = layered ? gr.Ds.length : 1, blk = 6 * (STRAIN_MONO + 1);
    for (let s = 0; s < ns; s++) {
      const D = layered ? gr.Ds[s] : gr.D, s0 = layered ? gr.s0s[s] : gr.s0, o = 33 + s * blk;
      for (let mo = 0; mo < STRAIN_MONO; mo++) {
        const Em = 6 * mo, so = o + 6 * mo;
        for (let r = 0; r < 6; r++) { let v = 0; const dr = r * 6; for (let t = 0; t < 6; t++) v += D[dr + t] * E[Em + t]; state[so + r] += v; }
      }
      const so = o + 6 * STRAIN_MONO;
      for (let r = 0; r < 6; r++) state[so + r] += s0[r];
    }
  }

  /** Sub-layer index of a layered element at natural coordinate zeta. */
  subLayerAt(e, zeta) {
    const m = this.mesh, k = m.eIJK[3 * e + 2], sec = this.sectionOf(e);
    const z = m.zs[k] + 0.5 * (zeta + 1) * (m.zs[k + 1] - m.zs[k]);
    for (let s = 0; s < sec.ns; s++) if (z <= sec.subZ[s][1] + 1e-12) return s;
    return sec.ns - 1;
  }

  /**
   * Stress and total strain of element e at natural point (xi, eta, zeta) from
   * its history state: sigma = sum_m phi_m S_m - S_th of the sub-layer at that
   * zeta (layered elements) or of the element. Returns {eps, sig}.
   */
  stateStress(e, state, xi, eta, zeta, out) {
    out = out || { eps: new Float64Array(6), sig: new Float64Array(6) };
    const m = this.mesh, g = this.groups[m.eGroup[e]];
    const [hx, hy, hz] = this.elementDims(e);
    boxStrainAt(hx, hy, hz, state, state.subarray(24, 33), xi, eta, zeta, out.eps);
    const s = g.kind === 'layered' ? this.subLayerAt(e, zeta) : 0;
    const phi = strainMonomials(xi, eta, zeta, this._phi), o = 33 + s * 6 * (STRAIN_MONO + 1);
    for (let r = 0; r < 6; r++) {
      let v = -state[o + 6 * STRAIN_MONO + r];
      for (let mo = 0; mo < STRAIN_MONO; mo++) v += phi[mo] * state[o + 6 * mo + r];
      out.sig[r] = v;
    }
    return out;
  }
}
