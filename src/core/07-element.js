// ===== Hex8 with Wilson-Taylor incompatible modes (Section 7.1) ===========
//
// u = sum_a N_a u_a + sum_i P_i alpha_i,  P_1 = 1 - xi^2, P_2 = 1 - eta^2,
// P_3 = 1 - zeta^2 (9 enhanced DOFs, three per mode). Taylor's modification:
// grad P = (det J0 / det J) J0^-1 grad_xi P with J0 the Jacobian at the element
// centre, so that int grad P dV = 0 and the patch test passes (Taylor,
// Beresford, Wilson 1976). The 33 x 33 matrix is condensed per element:
//   K_c = K_uu - K_ua K_aa^-1 K_au,  f_c = f_u - K_ua K_aa^-1 f_a,
//   alpha = K_aa^-1 (f_a - K_au u).
// Strain order: [exx, eyy, ezz, gxy, gyz, gzx] (engineering shear strains).

const HEX_XI = [-1, 1, 1, -1, -1, 1, 1, -1];
const HEX_ETA = [-1, -1, 1, 1, -1, -1, 1, 1];
const HEX_ZETA = [-1, -1, -1, -1, 1, 1, 1, 1];
const GP2 = 1 / Math.sqrt(3);
const NFUN = 11; // 8 nodal shape functions + 3 incompatible modes

/** Derivatives of the 11 functions of an axis-aligned box element at (xi, eta, zeta). */
function boxDerivs(hx, hy, hz, xi, eta, zeta, dx, dy, dz) {
  const sx = 2 / hx, sy = 2 / hy, sz = 2 / hz;
  for (let a = 0; a < 8; a++) {
    const xa = HEX_XI[a], ya = HEX_ETA[a], za = HEX_ZETA[a];
    dx[a] = xa * (1 + ya * eta) * (1 + za * zeta) * 0.125 * sx;
    dy[a] = ya * (1 + xa * xi) * (1 + za * zeta) * 0.125 * sy;
    dz[a] = za * (1 + xa * xi) * (1 + ya * eta) * 0.125 * sz;
  }
  dx[8] = -2 * xi * sx; dy[8] = 0; dz[8] = 0;
  dx[9] = 0; dy[9] = -2 * eta * sy; dz[9] = 0;
  dx[10] = 0; dy[10] = 0; dz[10] = -2 * zeta * sz;
}

/** Trilinear shape functions at (xi, eta, zeta). */
function hexN(xi, eta, zeta, N) {
  for (let a = 0; a < 8; a++) N[a] = 0.125 * (1 + HEX_XI[a] * xi) * (1 + HEX_ETA[a] * eta) * (1 + HEX_ZETA[a] * zeta);
  return N;
}

/**
 * Accumulate w * B^T D B into K (33 x 33 row-major) and w * B^T s0 into f,
 * for one integration point with function derivatives dx, dy, dz.
 */
function accumulatePoint(dx, dy, dz, D, s0, w, K, f) {
  const DB = accumulatePoint._DB;
  for (let b = 0; b < NFUN; b++) {
    const bx = dx[b], by = dy[b], bz = dz[b];
    const o = b * 18;
    for (let r = 0; r < 6; r++) {
      const d = r * 6;
      DB[o + r * 3] = D[d] * bx + D[d + 3] * by + D[d + 5] * bz;
      DB[o + r * 3 + 1] = D[d + 1] * by + D[d + 3] * bx + D[d + 4] * bz;
      DB[o + r * 3 + 2] = D[d + 2] * bz + D[d + 4] * by + D[d + 5] * bx;
    }
  }
  for (let a = 0; a < NFUN; a++) {
    const ax = dx[a] * w, ay = dy[a] * w, az = dz[a] * w;
    if (ax === 0 && ay === 0 && az === 0) continue;
    const ra = 3 * a;
    for (let b = a; b < NFUN; b++) {
      const o = b * 18;
      for (let c = 0; c < 3; c++) {
        const k0 = ax * DB[o + c] + ay * DB[o + 9 + c] + az * DB[o + 15 + c];
        const k1 = ay * DB[o + 3 + c] + ax * DB[o + 9 + c] + az * DB[o + 12 + c];
        const k2 = az * DB[o + 6 + c] + ay * DB[o + 12 + c] + ax * DB[o + 15 + c];
        K[ra * 33 + 3 * b + c] += k0;
        K[(ra + 1) * 33 + 3 * b + c] += k1;
        K[(ra + 2) * 33 + 3 * b + c] += k2;
      }
    }
    if (s0) {
      f[ra] += ax * s0[0] + ay * s0[3] + az * s0[5];
      f[ra + 1] += ay * s0[1] + ax * s0[3] + az * s0[4];
      f[ra + 2] += az * s0[2] + ay * s0[4] + ax * s0[5];
    }
  }
}
accumulatePoint._DB = new Float64Array(NFUN * 18);

/** Mirror the upper block triangle (computed for b >= a) into the lower part. */
function symmetrize33(K) {
  for (let a = 0; a < NFUN; a++) for (let b = a + 1; b < NFUN; b++)
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) K[(3 * b + q) * 33 + 3 * a + p] = K[(3 * a + p) * 33 + 3 * b + q];
}

/**
 * Static condensation of the 9 incompatible DOFs. Returns
 * {Kc (24x24), fc (24), X = K_aa^-1 K_au (9x24), xf = K_aa^-1 f_a (9)}.
 */
function condense33(K, f, out) {
  out = out || { Kc: new Float64Array(576), fc: new Float64Array(24), X: new Float64Array(216), xf: new Float64Array(9) };
  const Kaa = condense33._Kaa;
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) Kaa[i * 9 + j] = K[(24 + i) * 33 + 24 + j];
  cholDense(Kaa, 9, 1e-14);
  const X = out.X, col = condense33._col;
  for (let j = 0; j < 24; j++) {
    for (let i = 0; i < 9; i++) col[i] = K[(24 + i) * 33 + j];
    cholSolveDense(Kaa, 9, col, 0);
    for (let i = 0; i < 9; i++) X[i * 24 + j] = col[i];
  }
  const Kc = out.Kc;
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      let s = K[i * 33 + j];
      for (let q = 0; q < 9; q++) s -= K[i * 33 + 24 + q] * X[q * 24 + j];
      Kc[i * 24 + j] = s;
    }
  }
  // exact symmetry
  for (let i = 0; i < 24; i++) for (let j = i + 1; j < 24; j++) { const v = 0.5 * (Kc[i * 24 + j] + Kc[j * 24 + i]); Kc[i * 24 + j] = Kc[j * 24 + i] = v; }
  if (f) {
    for (let i = 0; i < 9; i++) col[i] = f[24 + i];
    cholSolveDense(Kaa, 9, col, 0);
    for (let i = 0; i < 9; i++) out.xf[i] = col[i];
    for (let i = 0; i < 24; i++) {
      let s = f[i];
      for (let q = 0; q < 9; q++) s -= K[i * 33 + 24 + q] * out.xf[q];
      out.fc[i] = s;
    }
  }
  return out;
}
condense33._Kaa = new Float64Array(81);
condense33._col = new Float64Array(9);

const _ek = { K: new Float64Array(1089), f: new Float64Array(33), dx: new Float64Array(NFUN), dy: new Float64Array(NFUN), dz: new Float64Array(NFUN) };

/**
 * Homogeneous box element: 2x2x2 Gauss, stiffness D (36) and thermal-stress
 * vector s0 = D eps0 (6, or null). Returns the condensed record.
 */
function boxElement(hx, hy, hz, D, s0) {
  const { K, f, dx, dy, dz } = _ek;
  K.fill(0); f.fill(0);
  const w = hx * hy * hz / 8;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    boxDerivs(hx, hy, hz, a ? GP2 : -GP2, b ? GP2 : -GP2, c ? GP2 : -GP2, dx, dy, dz);
    accumulatePoint(dx, dy, dz, D, s0, w, K, f);
  }
  symmetrize33(K);
  return condense33(K, s0 ? f : null);
}

/**
 * Layered box element: 2x2 in-plane Gauss x 3 zeta points {-1, 0, 1} with the
 * through-thickness weight matrices W_j (3 x 36) and thermal-stress weights
 * V_j (3 x 6) of buildBandSection; exact for the layered integrand and
 * identical to 2x2 in-plane by 2 through-thickness Gauss points per sub-layer.
 */
function layeredBoxElement(hx, hy, hz, W, V) {
  const { K, f, dx, dy, dz } = _ek;
  K.fill(0); f.fill(0);
  const w = hx * hy * hz / 8;
  const zj = [-1, 0, 1];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let j = 0; j < 3; j++) {
    boxDerivs(hx, hy, hz, a ? GP2 : -GP2, b ? GP2 : -GP2, zj[j], dx, dy, dz);
    accumulatePoint(dx, dy, dz, W.subarray(36 * j, 36 * j + 36), V ? V.subarray(6 * j, 6 * j + 6) : null, w, K, f);
  }
  symmetrize33(K);
  return condense33(K, V ? f : null);
}

/** Strain at (xi, eta, zeta) of a box element from u (24) and alpha (9). */
function boxStrainAt(hx, hy, hz, u, alpha, xi, eta, zeta, eps) {
  const { dx, dy, dz } = _ek;
  boxDerivs(hx, hy, hz, xi, eta, zeta, dx, dy, dz);
  eps = eps || new Float64Array(6);
  eps.fill(0);
  for (let b = 0; b < NFUN; b++) {
    const ux = b < 8 ? u[3 * b] : alpha[3 * (b - 8)];
    const uy = b < 8 ? u[3 * b + 1] : alpha[3 * (b - 8) + 1];
    const uz = b < 8 ? u[3 * b + 2] : alpha[3 * (b - 8) + 2];
    eps[0] += dx[b] * ux; eps[1] += dy[b] * uy; eps[2] += dz[b] * uz;
    eps[3] += dy[b] * ux + dx[b] * uy;
    eps[4] += dz[b] * uy + dy[b] * uz;
    eps[5] += dz[b] * ux + dx[b] * uz;
  }
  return eps;
}

/** alpha = xf * dF - X du (recovery after condensation, thermal factor dF). */
function recoverAlpha(rec, du, dF, alpha) {
  alpha = alpha || new Float64Array(9);
  for (let i = 0; i < 9; i++) {
    let s = rec.xf ? rec.xf[i] * dF : 0;
    for (let j = 0; j < 24; j++) s -= rec.X[i * 24 + j] * du[j];
    alpha[i] = s;
  }
  return alpha;
}

function matVec6(D, e, out) {
  out = out || new Float64Array(6);
  for (let r = 0; r < 6; r++) { let s = 0; for (let c = 0; c < 6; c++) s += D[r * 6 + c] * e[c]; out[r] = s; }
  return out;
}

// ---- general (distorted) hexahedron, used for the patch test -------------------

function inv3(J, out) {
  const a = J[0], b = J[1], c = J[2], d = J[3], e = J[4], f = J[5], g = J[6], h = J[7], i = J[8];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  out[0] = (e * i - f * h) / det; out[1] = (c * h - b * i) / det; out[2] = (b * f - c * e) / det;
  out[3] = (f * g - d * i) / det; out[4] = (a * i - c * g) / det; out[5] = (c * d - a * f) / det;
  out[6] = (d * h - e * g) / det; out[7] = (b * g - a * h) / det; out[8] = (a * e - b * d) / det;
  return det;
}

/** Function derivatives of a general hex at (xi, eta, zeta); returns det J. */
function generalDerivs(X, xi, eta, zeta, J0inv, detJ0, dx, dy, dz) {
  const dNxi = new Float64Array(8), dNeta = new Float64Array(8), dNzeta = new Float64Array(8);
  for (let a = 0; a < 8; a++) {
    const xa = HEX_XI[a], ya = HEX_ETA[a], za = HEX_ZETA[a];
    dNxi[a] = xa * (1 + ya * eta) * (1 + za * zeta) * 0.125;
    dNeta[a] = ya * (1 + xa * xi) * (1 + za * zeta) * 0.125;
    dNzeta[a] = za * (1 + xa * xi) * (1 + ya * eta) * 0.125;
  }
  const J = new Float64Array(9), Ji = new Float64Array(9);
  for (let a = 0; a < 8; a++) for (let j = 0; j < 3; j++) {
    J[j] += dNxi[a] * X[3 * a + j]; J[3 + j] += dNeta[a] * X[3 * a + j]; J[6 + j] += dNzeta[a] * X[3 * a + j];
  }
  const detJ = inv3(J, Ji);
  for (let a = 0; a < 8; a++) {
    dx[a] = Ji[0] * dNxi[a] + Ji[1] * dNeta[a] + Ji[2] * dNzeta[a];
    dy[a] = Ji[3] * dNxi[a] + Ji[4] * dNeta[a] + Ji[5] * dNzeta[a];
    dz[a] = Ji[6] * dNxi[a] + Ji[7] * dNeta[a] + Ji[8] * dNzeta[a];
  }
  const r = detJ0 / detJ;
  const gp = [[-2 * xi, 0, 0], [0, -2 * eta, 0], [0, 0, -2 * zeta]];
  for (let m = 0; m < 3; m++) {
    const g = gp[m];
    dx[8 + m] = r * (J0inv[0] * g[0] + J0inv[1] * g[1] + J0inv[2] * g[2]);
    dy[8 + m] = r * (J0inv[3] * g[0] + J0inv[4] * g[1] + J0inv[5] * g[2]);
    dz[8 + m] = r * (J0inv[6] * g[0] + J0inv[7] * g[1] + J0inv[8] * g[2]);
  }
  return detJ;
}

function centreJacobian(X) {
  const J = new Float64Array(9), Ji = new Float64Array(9);
  for (let a = 0; a < 8; a++) for (let j = 0; j < 3; j++) {
    J[j] += HEX_XI[a] * 0.125 * X[3 * a + j]; J[3 + j] += HEX_ETA[a] * 0.125 * X[3 * a + j]; J[6 + j] += HEX_ZETA[a] * 0.125 * X[3 * a + j];
  }
  const det = inv3(J, Ji);
  return { Ji, det };
}

/** General hex (node coordinates X, 24) with 2x2x2 Gauss. */
function generalElement(X, D, s0) {
  const { K, f, dx, dy, dz } = _ek;
  K.fill(0); f.fill(0);
  const c0 = centreJacobian(X);
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    const detJ = generalDerivs(X, a ? GP2 : -GP2, b ? GP2 : -GP2, c ? GP2 : -GP2, c0.Ji, c0.det, dx, dy, dz);
    accumulatePoint(dx, dy, dz, D, s0, detJ, K, f);
  }
  symmetrize33(K);
  return condense33(K, s0 ? f : null);
}

/** Strain at a point of a general hex. */
function generalStrainAt(X, u, alpha, xi, eta, zeta) {
  const dx = new Float64Array(NFUN), dy = new Float64Array(NFUN), dz = new Float64Array(NFUN);
  const c0 = centreJacobian(X);
  generalDerivs(X, xi, eta, zeta, c0.Ji, c0.det, dx, dy, dz);
  const eps = new Float64Array(6);
  for (let b = 0; b < NFUN; b++) {
    const ux = b < 8 ? u[3 * b] : alpha[3 * (b - 8)];
    const uy = b < 8 ? u[3 * b + 1] : alpha[3 * (b - 8) + 1];
    const uz = b < 8 ? u[3 * b + 2] : alpha[3 * (b - 8) + 2];
    eps[0] += dx[b] * ux; eps[1] += dy[b] * uy; eps[2] += dz[b] * uz;
    eps[3] += dy[b] * ux + dx[b] * uy; eps[4] += dz[b] * uy + dy[b] * uz; eps[5] += dz[b] * ux + dx[b] * uz;
  }
  return eps;
}

/**
 * Extrapolation from the 8 Gauss points (ordered like the nodes, at +-1/sqrt3)
 * to the 8 nodes: nodal value = sum_g N_g(sqrt3 * node natural coords) v_g.
 */
const GP_TO_NODE = (() => {
  const M = new Float64Array(64), N = new Float64Array(8), s = Math.sqrt(3);
  for (let n = 0; n < 8; n++) {
    hexN(HEX_XI[n] * s, HEX_ETA[n] * s, HEX_ZETA[n] * s, N);
    for (let gq = 0; gq < 8; gq++) M[n * 8 + gq] = N[gq];
  }
  return M;
})();
