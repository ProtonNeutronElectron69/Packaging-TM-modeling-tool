// ===== Homogenization: substrate layers, laminate averaging, bump geometry ===

/**
 * Mixture of an isotropic Cu phase (fraction r) with a matrix phase (engineering
 * constants d, possibly orthotropic), phases side by side in-plane and both
 * spanning the layer thickness (Section 6.2):
 *   E_z, G_xz, G_yz: Voigt  X = r X_c + (1 - r) X_d
 *   E_x = E_y, G_xy: 'plane' -> Voigt; 'signal' -> mean of Voigt and Reuss
 *                    (Reuss: 1/X = r/X_c + (1 - r)/X_d)
 *   Poisson ratios:  rule of mixtures
 *   CTE (each direction): Turner, alpha = (r E_c a_c + (1-r) E_d a_d)/(r E_c + (1-r) E_d)
 *                    with the matrix modulus of that direction.
 */
function mixCuEC(cu, d, r, inplaneRule) {
  const voigt = (xc, xd) => r * xc + (1 - r) * xd;
  const reuss = (xc, xd) => 1 / (r / xc + (1 - r) / xd);
  const inpl = (xc, xd) => inplaneRule === 'plane' ? voigt(xc, xd) : 0.5 * (voigt(xc, xd) + reuss(xc, xd));
  const turner = (Ec, ac, Ed, ad) => (r * Ec * ac + (1 - r) * Ed * ad) / (r * Ec + (1 - r) * Ed);
  return {
    Ex: inpl(cu.Ex, d.Ex), Ey: inpl(cu.Ey, d.Ey), Ez: voigt(cu.Ez, d.Ez),
    Gxy: inpl(cu.Gxy, d.Gxy), Gxz: voigt(cu.Gxz, d.Gxz), Gyz: voigt(cu.Gyz, d.Gyz),
    nuxy: voigt(cu.nuxy, d.nuxy), nuxz: voigt(cu.nuxz, d.nuxz), nuyz: voigt(cu.nuyz, d.nuyz),
    ax: turner(cu.Ex, cu.ax, d.Ex, d.ax), ay: turner(cu.Ey, cu.ay, d.Ey, d.ay), az: turner(cu.Ez, cu.az, d.Ez, d.az),
  };
}

/**
 * Engineering constants (MPa, 1/degC) of one physical substrate row at T.
 * Row types: 'sr' (solder resist), 'diel' (dielectric with optional via Cu
 * fraction), 'cu' (Cu pattern with residual ratio, plane or signal, filled with
 * the build-up dielectric), 'core' (orthotropic laminate with PTH Cu fraction).
 */
function substrateRowEC(row, T, lib, cuId) {
  const cu = materialEC(findMaterial(lib, cuId || 'cu'), T);
  switch (row.type) {
    case 'sr': return materialEC(findMaterial(lib, row.mat), T);
    case 'diel': {
      const d = materialEC(findMaterial(lib, row.mat), T);
      // isolated via columns: through-thickness Voigt, in-plane 'signal' rule
      return row.via > 0 ? mixCuEC(cu, d, row.via, 'signal') : d;
    }
    case 'cu': {
      const d = materialEC(findMaterial(lib, row.fill), T);
      return mixCuEC(cu, d, row.r, row.kind === 'plane' ? 'plane' : 'signal');
    }
    case 'core': {
      const d = materialEC(findMaterial(lib, row.mat), T);
      // PTH Cu: parallel rules in z and in-plane (Voigt), Turner CTE in each direction
      return row.pth > 0 ? mixCuEC(cu, d, row.pth, 'plane') : d;
    }
    default: throw new Error('Unknown substrate row type ' + row.type);
  }
}

/**
 * Bottom-up list of substrate rows with z ranges, and their grouping into
 * element bands (Section 5.3): bottom solder resist + bottom build-up = one band,
 * core (with its adjacent core Cu layers) = two bands split at the core
 * mid-plane, top build-up + top solder resist = one band.
 * Config rows are listed top to bottom.
 */
function substrateBands(layers) {
  const rowsTopDown = layers;
  const n = rowsTopDown.length;
  const rows = [];
  let z = 0;
  for (let i = n - 1; i >= 0; i--) {
    const r = rowsTopDown[i];
    rows.push({ idx: i, row: r, z0: z, z1: z + r.t });
    z += r.t;
  }
  const total = z;
  const coreAt = rows.findIndex(r => r.row.type === 'core');
  let cuts;
  if (coreAt >= 0) {
    const core = rows[coreAt];
    const below = coreAt > 0 && rows[coreAt - 1].row.type === 'cu' ? rows[coreAt - 1] : null;
    const above = coreAt + 1 < rows.length && rows[coreAt + 1].row.type === 'cu' ? rows[coreAt + 1] : null;
    const zLo = below ? below.z0 : core.z0;
    const zMid = 0.5 * (core.z0 + core.z1);
    const zHi = above ? above.z1 : core.z1;
    cuts = [0, zLo, zMid, zHi, total];
  } else {
    cuts = [0, 0.5 * total, total];
  }
  // drop zero-thickness bands
  const planes = [cuts[0]];
  for (let i = 1; i < cuts.length; i++) if (cuts[i] - planes[planes.length - 1] > 1e-9) planes.push(cuts[i]);
  const bands = [];
  for (let b = 0; b + 1 < planes.length; b++) {
    const z0 = planes[b], z1 = planes[b + 1];
    const subs = [];
    for (const r of rows) {
      const a = Math.max(z0, r.z0), c = Math.min(z1, r.z1);
      if (c - a > 1e-12) subs.push({ row: r.row, rowIdx: r.idx, z0: a, z1: c });
    }
    bands.push({ z0, z1, subs });
  }
  return { total, rows, planes, bands };
}

/** Integrals of the quadratic Lagrange basis on {-1, 0, 1} over [a, b]. */
function lagrange3Integrals(a, b) {
  const Im = z => z * z * z / 6 - z * z / 4;
  const I0 = z => z - z * z * z / 3;
  const Ip = z => z * z * z / 6 + z * z / 4;
  return [Im(b) - Im(a), I0(b) - I0(a), Ip(b) - Ip(a)];
}

/**
 * Layered section data of one substrate band on the 1 degC grid.
 * For each sub-layer s: D_s(T) (36) and F_s(T) (3 normal components).
 * For each grid T: the three through-thickness weight matrices
 *   W_j(T) = sum_s D_s(T) * integral over the sub-layer zeta-range of L_j(zeta)
 * that make the 12-point (2x2 in-plane x 3 zeta) rule exact for the
 * piecewise-constant layered stiffness (identical to 2x2x2 Gauss per sub-layer,
 * since the hex integrand is at most quadratic in zeta).
 */
function buildBandSection(band, lib, nuMax) {
  const ns = band.subs.length;
  const h = band.z1 - band.z0;
  const Ls = band.subs.map(s => lagrange3Integrals(2 * (s.z0 - band.z0) / h - 1, 2 * (s.z1 - band.z0) / h - 1));
  const D = new Float64Array(ns * TGRID_N * 36);
  const F = new Float64Array(ns * TGRID_N * 3);
  const W = new Float64Array(TGRID_N * 108);
  const tmpD = new Float64Array(36);
  // thermal strain: Simpson on each 1 degC step with homogenized alpha at T, T+0.5, T+1
  const alphaAt = (s, T) => { const ec = substrateRowEC(band.subs[s].row, T, lib); return [ec.ax, ec.ay, ec.az]; };
  const i25 = CONST.T_STRAIN_ORIGIN - CONST.TGRID_MIN;
  for (let s = 0; s < ns; s++) {
    const al = [];
    for (let k = 0; k <= 2 * (TGRID_N - 1); k++) al.push(alphaAt(s, CONST.TGRID_MIN + 0.5 * k));
    const base = s * TGRID_N * 3;
    // cumulative from the grid start, then shifted so F(25) = 0
    for (let c = 0; c < 3; c++) F[base + c] = 0;
    for (let i = 1; i < TGRID_N; i++) {
      for (let c = 0; c < 3; c++) {
        const a0 = al[2 * (i - 1)][c], am = al[2 * i - 1][c], a1 = al[2 * i][c];
        F[base + i * 3 + c] = F[base + (i - 1) * 3 + c] + (a0 + 4 * am + a1) / 6;
      }
    }
    const off = [F[base + i25 * 3], F[base + i25 * 3 + 1], F[base + i25 * 3 + 2]];
    for (let i = 0; i < TGRID_N; i++) for (let c = 0; c < 3; c++) F[base + i * 3 + c] -= off[c];
    for (let i = 0; i < TGRID_N; i++) {
      const T = CONST.TGRID_MIN + i;
      orthoD(substrateRowEC(band.subs[s].row, T, lib), nuMax, tmpD);
      D.set(tmpD, (s * TGRID_N + i) * 36);
    }
  }
  for (let i = 0; i < TGRID_N; i++) {
    for (let s = 0; s < ns; s++) {
      const dOff = (s * TGRID_N + i) * 36;
      for (let j = 0; j < 3; j++) {
        const l = Ls[s][j];
        const wOff = i * 108 + j * 36;
        for (let q = 0; q < 36; q++) W[wOff + q] += D[dOff + q] * l;
      }
    }
  }
  return { z0: band.z0, z1: band.z1, ns, Ls, D, F, W, subZ: band.subs.map(s => [s.z0, s.z1]) };
}

/** W_j(T) (3 x 36) of a band section by linear interpolation in the grid. */
function sectionW(sec, T, out) {
  out = out || new Float64Array(108);
  let x = clamp(T - CONST.TGRID_MIN, 0, TGRID_N - 1);
  const i = Math.min(Math.floor(x), TGRID_N - 2), t = x - i;
  const a = i * 108, b = (i + 1) * 108;
  for (let q = 0; q < 108; q++) out[q] = sec.W[a + q] + t * (sec.W[b + q] - sec.W[a + q]);
  return out;
}

/**
 * Thermal-stress weight vectors V_j(T) = sum_s D_s(T) [F_s(T) - F_s(Tb)] int L_j
 * (3 x 6) for a band born stress-free at Tb.
 */
function sectionV(sec, T, Tb, out) {
  out = out || new Float64Array(18);
  out.fill(0);
  let x = clamp(T - CONST.TGRID_MIN, 0, TGRID_N - 1);
  const i = Math.min(Math.floor(x), TGRID_N - 2), t = x - i;
  const eps = new Float64Array(6);
  for (let s = 0; s < sec.ns; s++) {
    const fb = s * TGRID_N * 3;
    for (let c = 0; c < 3; c++) {
      const Fi = sec.F[fb + i * 3 + c] + t * (sec.F[fb + (i + 1) * 3 + c] - sec.F[fb + i * 3 + c]);
      eps[c] = Fi - gridAt(sec.F.subarray(fb, fb + TGRID_N * 3), Tb, 3, c);
    }
    const da = (s * TGRID_N + i) * 36, db = (s * TGRID_N + i + 1) * 36;
    for (let r = 0; r < 6; r++) {
      let sig = 0;
      for (let c = 0; c < 3; c++) {
        const d = sec.D[da + r * 6 + c] + t * (sec.D[db + r * 6 + c] - sec.D[da + r * 6 + c]);
        sig += d * eps[c];
      }
      for (let j = 0; j < 3; j++) out[j * 6 + r] += sig * sec.Ls[s][j];
    }
  }
  return out;
}

/**
 * Exact homogenization of a stack of orthotropic layers with normal z
 * (Backus / mixed-variable averaging): in-plane strains and out-of-plane
 * stresses are uniform across layers. Inputs per layer: D (36), eps0 (3 normal
 * thermal strains), thickness fraction f. Returns {D, eps0}.
 */
function laminateAverage(layers) {
  const P = [0, 1, 3], N = [2, 4, 5];
  const get = (D, a, b) => D[a * 6 + b];
  const sub = (D, A, B) => { const M = new Float64Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i * 3 + j] = get(D, A[i], B[j]); return M; };
  const mul = (A, B) => { const M = new Float64Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j]; M[i * 3 + j] = s; } return M; };
  const avgNNi = new Float64Array(9), avgNNiNP = new Float64Array(9), avgPNNi = new Float64Array(9), avgQ = new Float64Array(9);
  const avgQeps = new Float64Array(3);
  const per = [];
  for (const L of layers) {
    const Cpp = sub(L.D, P, P), Cpn = sub(L.D, P, N), Cnp = sub(L.D, N, P), Cnn = sub(L.D, N, N);
    const Cnni = invDense(Cnn, 3);
    const NiNP = mul(Cnni, Cnp);
    const PNi = mul(Cpn, Cnni);
    const Q = new Float64Array(9);
    const PNiNP = mul(Cpn, NiNP);
    for (let q = 0; q < 9; q++) Q[q] = Cpp[q] - PNiNP[q];
    for (let q = 0; q < 9; q++) {
      avgNNi[q] += L.f * Cnni[q]; avgNNiNP[q] += L.f * NiNP[q]; avgPNNi[q] += L.f * PNi[q]; avgQ[q] += L.f * Q[q];
    }
    const ep = [L.eps0[0], L.eps0[1], 0];
    for (let i = 0; i < 3; i++) { let s = 0; for (let j = 0; j < 3; j++) s += Q[i * 3 + j] * ep[j]; avgQeps[i] += L.f * s; }
    per.push({ NiNP, ep, ez: L.eps0[2] });
  }
  const Cnn = invDense(avgNNi, 3);
  const Cnp = mul(Cnn, avgNNiNP);
  const Cpp = new Float64Array(9);
  const t = mul(avgPNNi, Cnp);
  for (let q = 0; q < 9; q++) Cpp[q] = avgQ[q] + t[q];
  const Cpn = mul(avgPNNi, Cnn);
  const D = new Float64Array(36);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    D[P[i] * 6 + P[j]] = Cpp[i * 3 + j]; D[P[i] * 6 + N[j]] = Cpn[i * 3 + j];
    D[N[i] * 6 + P[j]] = Cnp[i * 3 + j]; D[N[i] * 6 + N[j]] = Cnn[i * 3 + j];
  }
  // effective thermal strain: free expansion with zero average in-plane stress and zero out-of-plane stress
  const epEff = solveDense(avgQ, 3, avgQeps);
  let ez = 0;
  for (let k = 0; k < layers.length; k++) {
    const p = per[k];
    const d = [epEff[0] - p.ep[0], epEff[1] - p.ep[1], epEff[2] - p.ep[2]];
    let corr = 0;
    for (let j = 0; j < 3; j++) corr += p.NiNP[0 * 3 + j] * d[j]; // row of eps_zz
    ez += layers[k].f * (p.ez - corr);
  }
  return { D, eps0: [epEff[0], epEff[1], ez] };
}

/**
 * Solder bump as a body of revolution between the substrate (SRO, z = 0) and
 * the die (UBM, z = H) whose meridian is a circular arc with the given maximum
 * diameter (a truncated sphere when the four inputs are consistent with one).
 * All inputs are diameters / heights in mm.
 */
function bumpProfile(ubm, sro, dmax, H) {
  const rt = ubm / 2, rb = sro / 2;
  const rm = Math.max(dmax / 2, rt, rb);
  const db = rm - rb, dt = rm - rt;
  let zm, rho;
  if (db < 1e-12 && dt < 1e-12) { zm = H / 2; rho = Infinity; }
  else if (db < 1e-12) { zm = 0; rho = (H * H + dt * dt) / (2 * dt); }
  else if (dt < 1e-12) { zm = H; rho = (H * H + db * db) / (2 * db); }
  else {
    // z_m = sqrt(2 rho db - db^2), H - z_m = sqrt(2 rho dt - dt^2): solve for rho by bisection
    const g = rhoV => Math.sqrt(Math.max(0, 2 * rhoV * db - db * db)) + Math.sqrt(Math.max(0, 2 * rhoV * dt - dt * dt)) - H;
    let lo = Math.max(db, dt) / 2, hi = lo;
    while (g(hi) < 0) hi *= 2;
    for (let it = 0; it < 200; it++) { const mid = 0.5 * (lo + hi); if (g(mid) < 0) lo = mid; else hi = mid; }
    rho = 0.5 * (lo + hi);
    zm = Math.sqrt(Math.max(0, 2 * rho * db - db * db));
  }
  const radiusAt = z => {
    if (!isFinite(rho)) return rm;
    const dz = z - zm;
    return rm - rho + Math.sqrt(Math.max(0, rho * rho - dz * dz));
  };
  const volume = simpson(z => Math.PI * radiusAt(z) * radiusAt(z), 0, H, 400);
  const deff = Math.sqrt(4 * volume / (Math.PI * H));
  return { rt, rb, rm, zm, rho, H, radiusAt, volume, deff };
}
