// ===== Linear solvers (Section 7.3) =========================================
//
// PCG on the Jacobi-scaled full block CSR matrix Ks = S K S, S = diag(K)^-1/2.
// Preconditioners: semi-coarsening geometric multigrid (coarsen x and y only,
// keep all z-planes; column block Gauss-Seidel smoother with block-tridiagonal
// Cholesky of each (i, j) column; Galerkin coarse operators; dense Cholesky on
// the coarsest grid) and IC(0) with a Manteuffel diagonal shift as fallback.

// ---- 3x3 block helpers ---------------------------------------------------------------

/** Lower Cholesky of a symmetric 3x3 block A (9) into L (9, lower). Returns false on breakdown. */
function chol3(A, a, L, l, jit) {
  const a00 = A[a] + jit, a10 = A[a + 3], a11 = A[a + 4] + jit, a20 = A[a + 6], a21 = A[a + 7], a22 = A[a + 8] + jit;
  if (!(a00 > 0)) return false;
  const l00 = Math.sqrt(a00);
  const l10 = a10 / l00, l20 = a20 / l00;
  const d11 = a11 - l10 * l10;
  if (!(d11 > 0)) return false;
  const l11 = Math.sqrt(d11);
  const l21 = (a21 - l20 * l10) / l11;
  const d22 = a22 - l20 * l20 - l21 * l21;
  if (!(d22 > 0)) return false;
  L[l] = l00; L[l + 1] = 0; L[l + 2] = 0; L[l + 3] = l10; L[l + 4] = l11; L[l + 5] = 0; L[l + 6] = l20; L[l + 7] = l21; L[l + 8] = Math.sqrt(d22);
  return true;
}

/**
 * Column block-tridiagonal Cholesky factors of one level: per node n the
 * diagonal factor L_nn (lower 3x3) and the sub-diagonal factor L_{n,n-1}.
 */
function factorColumns(level) {
  const P = level.P, val = level.val, nn = P.n;
  const F = new Float64Array(nn * 18);
  const down = level.down; // block index of (n, n-1) within the column or -1
  const tmp = new Float64Array(9), D = new Float64Array(9);
  let jitter = 0;
  for (let n = 0; n < nn; n++) {
    const dv = 9 * P.diag[n];
    for (let q = 0; q < 9; q++) D[q] = val[dv + q];
    const fo = 18 * n;
    if (down[n] >= 0) {
      // L_{n,n-1} = A_{n,n-1} L_{n-1,n-1}^-T  (solve X L^T = A, i.e. L X^T = A^T)
      const av = 9 * down[n], lp = 18 * (n - 1);
      for (let r = 0; r < 3; r++) {
        // row r of X: solve L y = A[r,:]^T
        const b0 = val[av + 3 * r], b1 = val[av + 3 * r + 1], b2 = val[av + 3 * r + 2];
        const y0 = b0 / F[lp];
        const y1 = (b1 - F[lp + 3] * y0) / F[lp + 4];
        const y2 = (b2 - F[lp + 6] * y0 - F[lp + 7] * y1) / F[lp + 8];
        tmp[3 * r] = y0; tmp[3 * r + 1] = y1; tmp[3 * r + 2] = y2;
      }
      for (let q = 0; q < 9; q++) F[fo + 9 + q] = tmp[q];
      // D = A_nn - X X^T
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        D[3 * r + c] -= tmp[3 * r] * tmp[3 * c] + tmp[3 * r + 1] * tmp[3 * c + 1] + tmp[3 * r + 2] * tmp[3 * c + 2];
      }
    } else {
      for (let q = 0; q < 9; q++) F[fo + 9 + q] = 0;
    }
    let jit = 0;
    for (let t = 0; t < 8 && !chol3(D, 0, F, fo, jit); t++) {
      jit = jit ? jit * 10 : 1e-10 * Math.max(Math.abs(D[0]), Math.abs(D[4]), Math.abs(D[8]), 1e-300);
      jitter++;
    }
  }
  level.colFact = F;
  level.colJitter = jitter;
}

/** x_col = K_cc^-1 r_col for one column (nodes n0 .. n1-1), result into x. */
function solveColumn(level, n0, n1, r, x) {
  const F = level.colFact;
  // forward: y_k = L_kk^-1 (r_k - L_{k,k-1} y_{k-1})
  for (let n = n0; n < n1; n++) {
    const fo = 18 * n;
    let b0 = r[3 * n], b1 = r[3 * n + 1], b2 = r[3 * n + 2];
    if (n > n0) {
      const p0 = x[3 * n - 3], p1 = x[3 * n - 2], p2 = x[3 * n - 1];
      b0 -= F[fo + 9] * p0 + F[fo + 10] * p1 + F[fo + 11] * p2;
      b1 -= F[fo + 12] * p0 + F[fo + 13] * p1 + F[fo + 14] * p2;
      b2 -= F[fo + 15] * p0 + F[fo + 16] * p1 + F[fo + 17] * p2;
    }
    const y0 = b0 / F[fo];
    const y1 = (b1 - F[fo + 3] * y0) / F[fo + 4];
    const y2 = (b2 - F[fo + 6] * y0 - F[fo + 7] * y1) / F[fo + 8];
    x[3 * n] = y0; x[3 * n + 1] = y1; x[3 * n + 2] = y2;
  }
  // backward: x_k = L_kk^-T (y_k - L_{k+1,k}^T x_{k+1})
  for (let n = n1 - 1; n >= n0; n--) {
    const fo = 18 * n;
    let b0 = x[3 * n], b1 = x[3 * n + 1], b2 = x[3 * n + 2];
    if (n + 1 < n1) {
      const fn = 18 * (n + 1);
      const q0 = x[3 * n + 3], q1 = x[3 * n + 4], q2 = x[3 * n + 5];
      b0 -= F[fn + 9] * q0 + F[fn + 12] * q1 + F[fn + 15] * q2;
      b1 -= F[fn + 10] * q0 + F[fn + 13] * q1 + F[fn + 16] * q2;
      b2 -= F[fn + 11] * q0 + F[fn + 14] * q1 + F[fn + 17] * q2;
    }
    const z2 = b2 / F[fo + 8];
    const z1 = (b1 - F[fo + 7] * z2) / F[fo + 4];
    const z0 = (b0 - F[fo + 3] * z1 - F[fo + 6] * z2) / F[fo];
    x[3 * n] = z0; x[3 * n + 1] = z1; x[3 * n + 2] = z2;
  }
}

// ---- multigrid hierarchy ---------------------------------------------------------------
//
// Level 0 is the 3D solid mesh (3 DOFs per node) smoothed by column block
// Gauss-Seidel. Its coarse space is a stack of shells: every (column, segment)
// aggregate of nodes carries 6 DOFs (t_x, t_y, t_z, theta_x, theta_y, eps_z)
// and a node at height z' above the aggregate reference moves as
//   u_x = t_x + theta_y z',  u_y = t_y - theta_x z',  u_z = t_z + eps_z z'.
// Segments split each column at the compliant layers (substrate / die stack /
// lid) so relative motion through the bump layer and the TIM is represented.
// Shell levels are semi-coarsened in x and y with linear interpolation of the
// in-plane DOFs and rotations and cubic Hermite interpolation of the
// deflection t_z from (t_z, theta), which keeps the shear strain of bending
// modes consistent (plain nodal interpolation puts (L/t)^2 times too much
// energy into them and stalls the coarse correction).

/** Per-node block index of (n, n-1) when n-1 is in the same column. */
function columnDownIndex(P, colStart) {
  const down = new Int32Array(P.n).fill(-1);
  for (let c = 0; c + 1 < colStart.length; c++) {
    for (let n = colStart[c] + 1; n < colStart[c + 1]; n++) {
      let lo = P.rowPtr[n], hi = P.rowPtr[n + 1] - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; const v = P.col[mid]; if (v === n - 1) { down[n] = mid; break; } if (v < n - 1) lo = mid + 1; else hi = mid - 1; }
    }
  }
  return down;
}

/** y = K x for a block CSR with block size b. */
function blockMatVec(P, val, b, x, y) {
  if (b === 3) return fullMatVec(P, val, x, y);
  const n = P.n, rp = P.rowPtr, col = P.col;
  for (let i = 0; i < n; i++) {
    let y0 = 0, y1 = 0, y2 = 0, y3 = 0, y4 = 0, y5 = 0;
    for (let k = rp[i]; k < rp[i + 1]; k++) {
      const j = col[k], v = 36 * k, o = 6 * j;
      const x0 = x[o], x1 = x[o + 1], x2 = x[o + 2], x3 = x[o + 3], x4 = x[o + 4], x5 = x[o + 5];
      y0 += val[v] * x0 + val[v + 1] * x1 + val[v + 2] * x2 + val[v + 3] * x3 + val[v + 4] * x4 + val[v + 5] * x5;
      y1 += val[v + 6] * x0 + val[v + 7] * x1 + val[v + 8] * x2 + val[v + 9] * x3 + val[v + 10] * x4 + val[v + 11] * x5;
      y2 += val[v + 12] * x0 + val[v + 13] * x1 + val[v + 14] * x2 + val[v + 15] * x3 + val[v + 16] * x4 + val[v + 17] * x5;
      y3 += val[v + 18] * x0 + val[v + 19] * x1 + val[v + 20] * x2 + val[v + 21] * x3 + val[v + 22] * x4 + val[v + 23] * x5;
      y4 += val[v + 24] * x0 + val[v + 25] * x1 + val[v + 26] * x2 + val[v + 27] * x3 + val[v + 28] * x4 + val[v + 29] * x5;
      y5 += val[v + 30] * x0 + val[v + 31] * x1 + val[v + 32] * x2 + val[v + 33] * x3 + val[v + 34] * x4 + val[v + 35] * x5;
    }
    const o = 6 * i;
    y[o] = y0; y[o + 1] = y1; y[o + 2] = y2; y[o + 3] = y3; y[o + 4] = y4; y[o + 5] = y5;
  }
  return y;
}

/** Fine (solid) level from a structured mesh and scaled matrix values. */
function makeFineLevel(mesh, P, val, planeSeg) {
  const level = {
    kind: 'solid', b: 3, nx: mesh.nx, ny: mesh.ny, nz: mesh.nz, xs: mesh.xs, ys: mesh.ys, nodeId: mesh.nodeId, nn: mesh.nn,
    colStart: mesh.colStart, P, val, coords: mesh.coords, planeSeg: planeSeg || new Int32Array(mesh.nz),
  };
  level.down = columnDownIndex(P, level.colStart);
  level._r = new Float64Array(3 * mesh.nn); level._dx = new Float64Array(3 * mesh.nn);
  return level;
}

/** Coarse index set: every other line plus the last one. */
function coarseLines(n) {
  const c = [];
  for (let i = 0; i < n; i += 2) c.push(i);
  if (c[c.length - 1] !== n - 1) c.push(n - 1);
  return c;
}

/** Children (transpose) lists of a prolongation. */
function transposeProl(prol, nnc) {
  const ptr = new Int32Array(nnc + 1);
  for (let q = 0; q < prol.idx.length; q++) ptr[prol.idx[q] + 1]++;
  for (let c = 0; c < nnc; c++) ptr[c + 1] += ptr[c];
  const idx = new Int32Array(prol.idx.length), widx = new Int32Array(prol.idx.length), fill = ptr.slice(0, nnc);
  for (let f = 0; f + 1 < prol.ptr.length; f++) for (let q = prol.ptr[f]; q < prol.ptr[f + 1]; q++) { const c = prol.idx[q]; idx[fill[c]] = f; widx[fill[c]] = q; fill[c]++; }
  return { ptr, idx, widx };
}

/**
 * Galerkin operator K_c = P^T K P between a level and its coarse level, with
 * matrix weights W (b_f x b_c) per (fine, coarse) pair.
 */
function galerkinProduct(level) {
  const coarse = level.coarse, prol = level.prol, ch = coarse.children;
  const bf = level.b, bc = coarse.b, bfc = bf * bc, bcc = bc * bc, bff = bf * bf;
  const P = level.P, val = level.val, nnc = coarse.nn, W = prol.W;
  const mark = new Int32Array(nnc).fill(-1);
  const acc = new Float64Array(nnc * bcc);
  const touched = [];
  const rowPtr = new Int32Array(nnc + 1);
  const cols = [];
  const vals = [];
  const T = new Float64Array(bfc);
  for (let I = 0; I < nnc; I++) {
    touched.length = 0;
    for (let q = ch.ptr[I]; q < ch.ptr[I + 1]; q++) {
      const i = ch.idx[q], wi = ch.widx[q] * bfc;
      for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
        const j = P.col[k], v = bff * k;
        for (let p = prol.ptr[j]; p < prol.ptr[j + 1]; p++) {
          const J = prol.idx[p], wj = p * bfc;
          if (mark[J] !== I) { mark[J] = I; touched.push(J); acc.fill(0, bcc * J, bcc * J + bcc); }
          for (let r = 0; r < bf; r++) {
            const vr = v + r * bf;
            for (let c = 0; c < bc; c++) {
              let sum = 0;
              for (let t = 0; t < bf; t++) sum += val[vr + t] * W[wj + t * bc + c];
              T[r * bc + c] = sum;
            }
          }
          const a = bcc * J;
          for (let r = 0; r < bc; r++) for (let c = 0; c < bc; c++) {
            let sum = 0;
            for (let t = 0; t < bf; t++) sum += W[wi + t * bc + r] * T[t * bc + c];
            acc[a + r * bc + c] += sum;
          }
        }
      }
    }
    touched.sort((a, b) => a - b);
    rowPtr[I + 1] = rowPtr[I] + touched.length;
    for (const J of touched) { cols.push(J); for (let t = 0; t < bcc; t++) vals.push(acc[bcc * J + t]); }
  }
  const col = Int32Array.from(cols);
  const diag = new Int32Array(nnc);
  for (let I = 0; I < nnc; I++) for (let k = rowPtr[I]; k < rowPtr[I + 1]; k++) if (col[k] === I) { diag[I] = k; break; }
  coarse.P = { n: nnc, rowPtr, col, nb: col.length, diag };
  coarse.val = Float64Array.from(vals);
}

/** Parts whose elements are compliant layers that split a column into separate shell aggregates. */
const COMPLIANT_PARTS = new Set([PART.SOLDER, PART.UF_BUMP, PART.UF_FILLET, PART.TIM, PART.LIDADH, PART.STIFFADH]);

/**
 * Shell level from the solid level. Each column is cut into aggregates at
 * void gaps and at compliant layers (bump layer, underfill, TIM, adhesives), so
 * every stiff stack (substrate, die, lid plate with its foot, stiffener)
 * carries its own six rigid-body-plus-thickness modes; the interior nodes of a
 * compliant stack form aggregates of their own (a single node then only uses
 * its three translations, the other modes are void and factor with jitter).
 * The Jacobi scaling s of the fine system is folded into the weights
 * (x_scaled = S^-1 u).
 */
function buildShellLevel(level, s, mesh) {
  const nx = level.nx, ny = level.ny, nz = level.nz, ncy = ny - 1, ncz = nz - 1;
  const ncol = nx * ny;
  const colStartC = new Int32Array(ncol + 1);
  const nodeAgg = new Int32Array(level.nn).fill(-1);
  const zlo = [], zhi = [], zref = [], aggCol = [];
  let na = 0;
  const isCompliant = (i, j, k) => {
    if (!mesh) return false;
    const c = (i * ncy + j) * ncz + k;
    let any = false, stiff = false;
    for (let q = 0; q < 2; q++) {
      const e = mesh.cellElems[2 * c + q];
      if (e < 0) continue;
      any = true;
      if (!COMPLIANT_PARTS.has(mesh.ePart[e])) stiff = true;
    }
    return any && !stiff;
  };
  const hasElem = (i, j, k) => {
    if (!mesh) return true;
    return mesh.cellElems[2 * ((i * ncy + j) * ncz + k)] >= 0;
  };
  const elemClass = (i, j, k) => (k < 0 || k >= ncz || !hasElem(i, j, k)) ? 0 : (isCompliant(i, j, k) ? 1 : 2); // 0 none, 1 compliant, 2 stiff
  for (let c = 0; c < ncol; c++) {
    colStartC[c] = na;
    const i = Math.floor(c / ny), j = c % ny;
    // node type: stiff when touching a stiff element, else compliant (interior of a compliant stack)
    const runs = [];
    let cur = null, prevK = -2, prevType = 0;
    for (let k = 0; k < nz; k++) {
      const n = level.nodeId[c * nz + k];
      if (n < 0) { cur = null; prevK = -2; continue; }
      const below = elemClass(i, j, k - 1), above = elemClass(i, j, k);
      const type = (below === 2 || above === 2) ? 2 : 1;
      let joined = false;
      if (cur && prevK === k - 1 && below !== 0) joined = below === 2 || (type === 1 && prevType === 1);
      if (!joined) { cur = []; runs.push(cur); }
      cur.push({ n, k, z: level.coords[3 * n + 2] });
      prevK = k; prevType = type;
    }
    // optional merge of single-node compliant aggregates into a neighbour
    const merge = level.mergeSingles || 'none';
    if (merge !== 'none') {
      for (let r = 0; r < runs.length; r++) {
        if (runs[r].length !== 1 || runs.length < 2) continue;
        const t = merge === 'below' ? (r > 0 ? r - 1 : r + 1) : (r + 1 < runs.length ? r + 1 : r - 1);
        if (t < r) runs[t].push(runs[r][0]); else runs[t].unshift(runs[r][0]);
        runs.splice(r, 1); r--;
      }
    }
    for (const run of runs) {
      let zs = 0;
      for (const o of run) { nodeAgg[o.n] = na; zs += o.z; }
      zlo.push(run[0].z); zhi.push(run[run.length - 1].z); zref.push(zs / run.length); aggCol.push(c);
      na++;
    }
  }
  colStartC[ncol] = na;
  const coarse = {
    kind: 'shell', b: 6, nx, ny, xs: level.xs, ys: level.ys, nn: na, colStart: colStartC,
    zref: Float64Array.from(zref), zlo: Float64Array.from(zlo), zhi: Float64Array.from(zhi),
  };
  level.coarse = coarse;
  level.nodeAgg = nodeAgg;
  shellWeights(level, s);
  coarse.children = transposeProl(level.prol, na);
  galerkinProduct(level);
  return coarse;
}

/** Prolongation weights (3 x 6 per node) of the solid -> shell transfer. */
function shellWeights(level, s) {
  const nn = level.nn, nodeAgg = level.nodeAgg, zref = level.coarse.zref;
  const ptr = new Int32Array(nn + 1), idx = new Int32Array(nn), W = new Float64Array(nn * 18);
  for (let n = 0; n < nn; n++) {
    ptr[n + 1] = n + 1; idx[n] = nodeAgg[n];
    const zp = level.coords[3 * n + 2] - zref[nodeAgg[n]];
    const o = 18 * n;
    W[o] = 1 / s[3 * n]; W[o + 4] = zp / s[3 * n];
    W[o + 7] = 1 / s[3 * n + 1]; W[o + 9] = -zp / s[3 * n + 1];
    W[o + 14] = 1 / s[3 * n + 2]; W[o + 17] = zp / s[3 * n + 2];
  }
  level.prol = { ptr, idx, W };
}

/** 6x6 Hermite / linear interpolation matrices between two shell aggregates along x or y. */
function hermitePair(t, h, alongY, WA, WB) {
  WA.fill(0); WB.fill(0);
  for (let d = 0; d < 6; d++) { WA[d * 6 + d] = 1 - t; WB[d * 6 + d] = t; }
  const h00 = 2 * t * t * t - 3 * t * t + 1, h10 = t * t * t - 2 * t * t + t, h01 = -2 * t * t * t + 3 * t * t, h11 = t * t * t - t * t;
  WA[2 * 6 + 2] = h00; WB[2 * 6 + 2] = h01;
  if (alongY) { WA[2 * 6 + 3] = h * h10; WB[2 * 6 + 3] = h * h11; }     // dw/dy = +theta_x
  else { WA[2 * 6 + 4] = -h * h10; WB[2 * 6 + 4] = -h * h11; }          // dw/dx = -theta_y
}

/** Rigid-body transfer of aggregate DOFs from reference height zc to zf (6x6). */
function rbmShift(dz, M) {
  M.fill(0);
  for (let d = 0; d < 6; d++) M[d * 7] = 1;
  M[0 * 6 + 4] = dz;    // t_x += theta_y dz
  M[1 * 6 + 3] = -dz;   // t_y -= theta_x dz
  M[2 * 6 + 5] = dz;    // t_z += eps_z dz
  return M;
}

function mul66(A, B, C) {
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let s = 0; for (let k = 0; k < 6; k++) s += A[i * 6 + k] * B[k * 6 + j]; C[i * 6 + j] = s; }
  return C;
}

/** Aggregate of coarse column C whose z-range overlaps [zlo, zhi] most, or -1. */
function matchAggregate(coarse, C, zlo, zhi, zref) {
  let best = -1, bo = 0;
  for (let a = coarse.colStart[C]; a < coarse.colStart[C + 1]; a++) {
    const ov = Math.min(zhi, coarse.zhi[a]) - Math.max(zlo, coarse.zlo[a]);
    const score = ov > 0 ? ov + 1e-9 : (zref >= coarse.zlo[a] - 1e-9 && zref <= coarse.zhi[a] + 1e-9 ? 1e-9 : -1);
    if (score > bo) { bo = score; best = a; }
  }
  return best;
}

/**
 * Coarse shell level by in-plane semi-coarsening. Parents are matched by
 * z-overlap, DOFs are shifted to the fine reference height, and the deflection
 * is interpolated with cubic Hermite polynomials from (t_z, theta).
 */
function buildCoarseShellLevel(level) {
  const cx = coarseLines(level.nx), cy = coarseLines(level.ny);
  const nxc = cx.length, nyc = cy.length;
  const xs = level.xs, ys = level.ys;
  const xsc = Float64Array.from(cx.map(i => xs[i])), ysc = Float64Array.from(cy.map(j => ys[j]));
  const colStartC = new Int32Array(nxc * nyc + 1);
  const zlo = [], zhi = [], zref = [], fineOf = [];
  let na = 0;
  for (let I = 0; I < nxc; I++) for (let J = 0; J < nyc; J++) {
    colStartC[I * nyc + J] = na;
    const c = cx[I] * level.ny + cy[J];
    for (let a = level.colStart[c]; a < level.colStart[c + 1]; a++) { zlo.push(level.zlo[a]); zhi.push(level.zhi[a]); zref.push(level.zref[a]); fineOf.push(a); na++; }
  }
  colStartC[nxc * nyc] = na;
  const coarse = { kind: 'shell', b: 6, nx: nxc, ny: nyc, xs: xsc, ys: ysc, nn: na, colStart: colStartC, zref: Float64Array.from(zref), zlo: Float64Array.from(zlo), zhi: Float64Array.from(zhi) };
  const locate = (lines, coords, i, x) => {
    let I0 = 0;
    while (I0 + 1 < lines.length && lines[I0 + 1] <= i) I0++;
    if (lines[I0] === i) return { I0, I1: -1, t: 0, h: 0 };
    return { I0, I1: I0 + 1, t: (x - coords[I0]) / (coords[I0 + 1] - coords[I0]), h: coords[I0 + 1] - coords[I0] };
  };
  const ptr = new Int32Array(level.nn + 1), idx = [], Wl = [];
  const WL = new Float64Array(36), WR = new Float64Array(36), WB = new Float64Array(36), WT = new Float64Array(36), tmp = new Float64Array(36), sh = new Float64Array(36), tmp2 = new Float64Array(36);
  for (let i = 0; i < level.nx; i++) {
    const px = locate(cx, xsc, i, xs[i]);
    for (let j = 0; j < level.ny; j++) {
      const py = locate(cy, ysc, j, ys[j]);
      const c = i * level.ny + j;
      for (let f = level.colStart[c]; f < level.colStart[c + 1]; f++) {
        const get = (I, J) => matchAggregate(coarse, I * nyc + J, level.zlo[f], level.zhi[f], level.zref[f]);
        const xC = px.I1 < 0 ? [px.I0] : [px.I0, px.I1];
        const yC = py.I1 < 0 ? [py.I0] : [py.I0, py.I1];
        const par = {};
        let complete = true;
        for (const I of xC) for (const J of yC) { const a = get(I, J); par[I + ',' + J] = a; if (a < 0) complete = false; }
        const cands = [];
        const push = (I, J, W) => {
          const a = par[I + ',' + J];
          // shift from the coarse reference height to the fine one
          rbmShift(level.zref[f] - coarse.zref[a], sh);
          cands.push([a, Float64Array.from(mul66(W, sh, tmp2))]);
        };
        if (complete) {
          if (px.I1 >= 0) hermitePair(px.t, px.h, false, WL, WR);
          if (py.I1 >= 0) hermitePair(py.t, py.h, true, WB, WT);
          if (px.I1 < 0 && py.I1 < 0) { const W = new Float64Array(36); for (let d = 0; d < 6; d++) W[d * 7] = 1; push(px.I0, py.I0, W); }
          else if (py.I1 < 0) { push(px.I0, py.I0, WL); push(px.I1, py.I0, WR); }
          else if (px.I1 < 0) { push(px.I0, py.I0, WB); push(px.I0, py.I1, WT); }
          else {
            push(px.I0, py.I0, mul66(WB, WL, tmp)); push(px.I1, py.I0, mul66(WB, WR, tmp));
            push(px.I0, py.I1, mul66(WT, WL, tmp)); push(px.I1, py.I1, mul66(WT, WR, tmp));
          }
        } else {
          // fallback: linear weights renormalized over the existing parents
          const wx = px.I1 < 0 ? [1] : [1 - px.t, px.t], wy = py.I1 < 0 ? [1] : [1 - py.t, py.t];
          let sum = 0; const ex = [];
          xC.forEach((I, a) => yC.forEach((J, b) => { const ag = par[I + ',' + J]; const w = wx[a] * wy[b]; if (ag >= 0 && w > 0) { ex.push([I, J, w]); sum += w; } }));
          for (const [I, J, w] of ex) { const W = new Float64Array(36); for (let d = 0; d < 6; d++) W[d * 7] = w / sum; push(I, J, W); }
        }
        ptr[f + 1] = cands.length;
        for (const [a, W] of cands) { idx.push(a); Wl.push(W); }
      }
    }
  }
  for (let f = 0; f < level.nn; f++) ptr[f + 1] += ptr[f];
  const W = new Float64Array(Wl.length * 36);
  Wl.forEach((w, q) => W.set(w, 36 * q));
  level.prol = { ptr, idx: Int32Array.from(idx), W };
  level.coarse = coarse;
  coarse.children = transposeProl(level.prol, na);
  galerkinProduct(level);
  return coarse;
}

/** Dense per-column Cholesky factors of a shell level. */
function factorShellColumns(level) {
  const b = level.b, cs = level.colStart, ncol = cs.length - 1, P = level.P, val = level.val, bb = b * b;
  const ptr = new Int32Array(ncol + 1);
  for (let c = 0; c < ncol; c++) { const m = (cs[c + 1] - cs[c]) * b; ptr[c + 1] = ptr[c] + m * m; }
  const data = new Float64Array(ptr[ncol]);
  let fixes = 0;
  for (let c = 0; c < ncol; c++) {
    const n0 = cs[c], n1 = cs[c + 1], m = (n1 - n0) * b;
    if (!m) continue;
    const A = data.subarray(ptr[c], ptr[c + 1]);
    for (let n = n0; n < n1; n++) for (let k = P.rowPtr[n]; k < P.rowPtr[n + 1]; k++) {
      const j = P.col[k];
      if (j < n0 || j >= n1) continue;
      const v = bb * k;
      for (let p = 0; p < b; p++) for (let q = 0; q < b; q++) A[((n - n0) * b + p) * m + (j - n0) * b + q] = val[v + p * b + q];
    }
    fixes += cholDense(A, m, 1e-12);
  }
  level.colFact = { ptr, data };
  level.colJitter = fixes;
}

/** Solve L L^T x = b for a factor stored at offset lOff (b at offset bOff, in place). */
function cholSolveDenseOff(L, lOff, n, b, bOff) {
  for (let i = 0; i < n; i++) {
    let s = b[bOff + i];
    const ri = lOff + i * n;
    for (let k = 0; k < i; k++) s -= L[ri + k] * b[bOff + k];
    b[bOff + i] = s / L[ri + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[bOff + i];
    for (let k = i + 1; k < n; k++) s -= L[lOff + k * n + i] * b[bOff + k];
    b[bOff + i] = s / L[lOff + i * n + i];
  }
}

/** One block Gauss-Seidel sweep over the columns of any level. */
function columnSweep(level, bvec, x, backward) {
  const P = level.P, val = level.val, cs = level.colStart, ncol = cs.length - 1, b = level.b;
  const r = level._r, dx = level._dx, rp = P.rowPtr, col = P.col;
  const solid = level.kind === 'solid';
  for (let cc = 0; cc < ncol; cc++) {
    const c = backward ? ncol - 1 - cc : cc;
    const n0 = cs[c], n1 = cs[c + 1];
    if (n1 === n0) continue;
    if (solid) {
      for (let n = n0; n < n1; n++) {
        let s0 = bvec[3 * n], s1 = bvec[3 * n + 1], s2 = bvec[3 * n + 2];
        for (let k = rp[n]; k < rp[n + 1]; k++) {
          const j = col[k], v = 9 * k;
          const xj0 = x[3 * j], xj1 = x[3 * j + 1], xj2 = x[3 * j + 2];
          s0 -= val[v] * xj0 + val[v + 1] * xj1 + val[v + 2] * xj2;
          s1 -= val[v + 3] * xj0 + val[v + 4] * xj1 + val[v + 5] * xj2;
          s2 -= val[v + 6] * xj0 + val[v + 7] * xj1 + val[v + 8] * xj2;
        }
        r[3 * n] = s0; r[3 * n + 1] = s1; r[3 * n + 2] = s2;
      }
      solveColumn(level, n0, n1, r, dx);
      for (let q = 3 * n0; q < 3 * n1; q++) x[q] += dx[q];
    } else {
      for (let n = n0; n < n1; n++) {
        let s0 = bvec[6 * n], s1 = bvec[6 * n + 1], s2 = bvec[6 * n + 2], s3 = bvec[6 * n + 3], s4 = bvec[6 * n + 4], s5 = bvec[6 * n + 5];
        for (let k = rp[n]; k < rp[n + 1]; k++) {
          const j = col[k], v = 36 * k, o = 6 * j;
          const x0 = x[o], x1 = x[o + 1], x2 = x[o + 2], x3 = x[o + 3], x4 = x[o + 4], x5 = x[o + 5];
          s0 -= val[v] * x0 + val[v + 1] * x1 + val[v + 2] * x2 + val[v + 3] * x3 + val[v + 4] * x4 + val[v + 5] * x5;
          s1 -= val[v + 6] * x0 + val[v + 7] * x1 + val[v + 8] * x2 + val[v + 9] * x3 + val[v + 10] * x4 + val[v + 11] * x5;
          s2 -= val[v + 12] * x0 + val[v + 13] * x1 + val[v + 14] * x2 + val[v + 15] * x3 + val[v + 16] * x4 + val[v + 17] * x5;
          s3 -= val[v + 18] * x0 + val[v + 19] * x1 + val[v + 20] * x2 + val[v + 21] * x3 + val[v + 22] * x4 + val[v + 23] * x5;
          s4 -= val[v + 24] * x0 + val[v + 25] * x1 + val[v + 26] * x2 + val[v + 27] * x3 + val[v + 28] * x4 + val[v + 29] * x5;
          s5 -= val[v + 30] * x0 + val[v + 31] * x1 + val[v + 32] * x2 + val[v + 33] * x3 + val[v + 34] * x4 + val[v + 35] * x5;
        }
        const o = 6 * n;
        r[o] = s0; r[o + 1] = s1; r[o + 2] = s2; r[o + 3] = s3; r[o + 4] = s4; r[o + 5] = s5;
      }
      const m = (n1 - n0) * 6;
      cholSolveDenseOff(level.colFact.data, level.colFact.ptr[c], m, r, 6 * n0);
      for (let q = 6 * n0; q < 6 * n1; q++) x[q] += r[q];
    }
  }
}

/** Dense Cholesky of the coarsest operator. */
function factorCoarsest(level) {
  const b = level.b, n = b * level.nn, P = level.P, val = level.val, bb = b * b;
  const A = new Float64Array(n * n);
  for (let i = 0; i < level.nn; i++) for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
    const j = P.col[k], v = bb * k;
    for (let p = 0; p < b; p++) for (let q = 0; q < b; q++) A[(b * i + p) * n + b * j + q] = val[v + p * b + q];
  }
  level.denseFixes = cholDense(A, n, 1e-12);
  level.dense = A;
  level.denseN = n;
}

/** Multigrid preconditioner: solid level, shell levels, dense coarsest. */
class MultigridPC {
  constructor(mesh, P, val, s, opts) {
    const t0 = nowMs();
    this.opts = Object.assign({ pre: 2, post: 2, symmetric: false }, opts || {});
    this.s = s;
    const fine = makeFineLevel(mesh, P, val, this.opts.planeSeg);
    fine.mergeSingles = this.opts.mergeSingles || 'below';
    this.levels = [fine];
    factorColumns(fine);
    let lv = buildShellLevel(fine, s, mesh.cellElems ? mesh : null);
    this.levels.push(lv);
    for (let guard = 0; guard < 20; guard++) {
      factorShellColumns(lv);
      const ncol = lv.nx * lv.ny, ndof = lv.b * lv.nn;
      if (ncol <= CONST.MG_COARSEST_COLS || ndof <= CONST.MG_COARSEST_DOF || (lv.nx <= 2 && lv.ny <= 2)) break;
      lv = buildCoarseShellLevel(lv);
      this.levels.push(lv);
    }
    factorCoarsest(lv);
    for (const l of this.levels) { l._b = new Float64Array(l.b * l.nn); l._x = new Float64Array(l.b * l.nn); l._res = new Float64Array(l.b * l.nn); l._r = l._r || new Float64Array(l.b * l.nn); l._dx = l._dx || new Float64Array(l.b * l.nn); }
    this.setupMs = nowMs() - t0;
    this.name = 'MG';
    this.info = { levels: this.levels.map(l => ({ kind: l.kind, nx: l.nx, ny: l.ny, nn: l.nn, dof: l.b * l.nn })), setupMs: this.setupMs, coarsestDof: lv.denseN };
  }

  /** New fine values (same mesh): rebuild factors and coarse operators. */
  update(val, s) {
    const t0 = nowMs();
    const fine = this.levels[0];
    fine.val = val; this.s = s;
    factorColumns(fine);
    shellWeights(fine, s);
    for (let l = 0; l + 1 < this.levels.length; l++) {
      galerkinProduct(this.levels[l]);
      const co = this.levels[l + 1];
      co.P = this.levels[l].coarse.P; co.val = this.levels[l].coarse.val;
      factorShellColumns(co);
    }
    factorCoarsest(this.levels[this.levels.length - 1]);
    this.setupMs = nowMs() - t0;
  }

  _cycle(li, bvec, x) {
    const lv = this.levels[li];
    x.fill(0);
    if (li === this.levels.length - 1) { x.set(bvec); cholSolveDense(lv.dense, lv.denseN, x, 0); return; }
    for (let s = 0; s < this.opts.pre; s++) { columnSweep(lv, bvec, x, false); if (this.opts.symmetric) columnSweep(lv, bvec, x, true); }
    const res = lv._res;
    blockMatVec(lv.P, lv.val, lv.b, x, res);
    for (let i = 0; i < res.length; i++) res[i] = bvec[i] - res[i];
    const co = this.levels[li + 1], prol = lv.prol, bf = lv.b, bc = co.b, bfc = bf * bc;
    const rc = co._b; rc.fill(0);
    for (let f = 0; f < lv.nn; f++) {
      for (let q = prol.ptr[f]; q < prol.ptr[f + 1]; q++) {
        const c = prol.idx[q], w = bfc * q;
        for (let a = 0; a < bc; a++) { let s = 0; for (let p = 0; p < bf; p++) s += prol.W[w + p * bc + a] * res[bf * f + p]; rc[bc * c + a] += s; }
      }
    }
    this._cycle(li + 1, rc, co._x);
    const ec = co._x;
    for (let f = 0; f < lv.nn; f++) {
      for (let q = prol.ptr[f]; q < prol.ptr[f + 1]; q++) {
        const c = prol.idx[q], w = bfc * q;
        for (let p = 0; p < bf; p++) { let s = 0; for (let a = 0; a < bc; a++) s += prol.W[w + p * bc + a] * ec[bc * c + a]; x[bf * f + p] += s; }
      }
    }
    for (let s = 0; s < this.opts.post; s++) { if (this.opts.symmetric) columnSweep(lv, bvec, x, false); columnSweep(lv, bvec, x, true); }
  }

  apply(r, z) { this._cycle(0, r, z); return z; }
}

// ---- IC(0) ----------------------------------------------------------------------------

/** Scalar upper CSR (sorted columns) from the full block pattern. */
function scalarUpperCSR(P, val) {
  const n = 3 * P.n;
  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < P.n; i++) for (let p = 0; p < 3; p++) {
    let c = 0;
    for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) { const j = P.col[k]; if (j > i) c += 3; else if (j === i) c += 3 - p; }
    rowPtr[3 * i + p + 1] = rowPtr[3 * i + p] + c;
  }
  const col = new Int32Array(rowPtr[n]), v = new Float64Array(rowPtr[n]);
  for (let i = 0; i < P.n; i++) for (let p = 0; p < 3; p++) {
    let w = rowPtr[3 * i + p];
    for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
      const j = P.col[k];
      if (j < i) continue;
      for (let q = (j === i ? p : 0); q < 3; q++) { col[w] = 3 * j + q; v[w] = val[9 * k + 3 * p + q]; w++; }
    }
  }
  return { n, rowPtr, col, v };
}

/** IC(0) with Manteuffel shift: K + a diag(K) ~ U^T U. */
class ICPC {
  constructor(P, val) {
    const t0 = nowMs();
    this.name = 'IC(0)';
    this.P = P;
    this.build(val);
    this.setupMs = nowMs() - t0;
    this.info = { shift: this.shift, setupMs: this.setupMs };
  }
  build(val) {
    const U0 = scalarUpperCSR(this.P, val);
    let shift = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const U = { n: U0.n, rowPtr: U0.rowPtr, col: U0.col, v: Float64Array.from(U0.v) };
      if (shift > 0) for (let i = 0; i < U.n; i++) U.v[U.rowPtr[i]] *= 1 + shift;
      if (this._factor(U)) { this.U = U; this.shift = shift; return; }
      shift = shift === 0 ? CONST.IC_SHIFT0 : shift * 10;
      if (shift > CONST.IC_SHIFT_MAX) shift = CONST.IC_SHIFT_MAX;
    }
    throw new Error('IC(0) failed even with the maximum diagonal shift');
  }
  _factor(U) {
    const n = U.n, rp = U.rowPtr, col = U.col, v = U.v;
    for (let i = 0; i < n; i++) {
      const d = v[rp[i]];
      if (!(d > 0)) return false;
      const uii = Math.sqrt(d);
      v[rp[i]] = uii;
      for (let k = rp[i] + 1; k < rp[i + 1]; k++) v[k] /= uii;
      for (let k1 = rp[i] + 1; k1 < rp[i + 1]; k1++) {
        const j1 = col[k1], u1 = v[k1];
        // merge-walk row j1 against the remaining entries of row i (k2 >= k1)
        let kk = rp[j1];
        const kend = rp[j1 + 1];
        for (let k2 = k1; k2 < rp[i + 1]; k2++) {
          const j2 = col[k2];
          while (kk < kend && col[kk] < j2) kk++;
          if (kk < kend && col[kk] === j2) v[kk] -= u1 * v[k2];
        }
      }
    }
    return true;
  }
  update(val) { const t0 = nowMs(); this.build(val); this.setupMs = nowMs() - t0; }
  apply(r, z) {
    const U = this.U, n = U.n, rp = U.rowPtr, col = U.col, v = U.v;
    z.set(r);
    for (let i = 0; i < n; i++) {
      const yi = z[i] / v[rp[i]];
      z[i] = yi;
      for (let k = rp[i] + 1; k < rp[i + 1]; k++) z[col[k]] -= v[k] * yi;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = z[i];
      for (let k = rp[i] + 1; k < rp[i + 1]; k++) s -= v[k] * z[col[k]];
      z[i] = s / v[rp[i]];
    }
    return z;
  }
}

// ---- PCG with warm start and rebuild policy --------------------------------------------

/**
 * Solver bound to an FEModel: scales the assembled matrix, keeps the
 * preconditioner across temperature evaluations, warm-starts from previous
 * solutions and logs every solve.
 */
class LinearSolver {
  constructor(model, opts) {
    this.model = model;
    this.opts = Object.assign({ precond: 'mg', tol: CONST.PCG_TOL, maxit: CONST.PCG_MAXIT, warm: CONST.WARM_START_MAX, log: null, mg: {} }, opts || {});
    this.n = model.ndof;
    this.s = new Float64Array(this.n);
    this.pc = null;
    this.itersAtBuild = 0;
    this.needRebuild = true;
    this.basis = [];
    this.log = [];
    this.lastResult = null;
    this._r = new Float64Array(this.n); this._z = new Float64Array(this.n); this._p = new Float64Array(this.n); this._q = new Float64Array(this.n);
    this._bs = new Float64Array(this.n); this._x = new Float64Array(this.n);
  }

  /** Jacobi scaling of the assembled values in place; returns S = diag^-1/2. */
  _scale() {
    const P = this.model.pattern, val = this.model.val, s = this.s;
    for (let i = 0; i < P.n; i++) {
      const v = 9 * P.diag[i];
      s[3 * i] = 1 / Math.sqrt(Math.max(val[v], 1e-300));
      s[3 * i + 1] = 1 / Math.sqrt(Math.max(val[v + 4], 1e-300));
      s[3 * i + 2] = 1 / Math.sqrt(Math.max(val[v + 8], 1e-300));
    }
    for (let i = 0; i < P.n; i++) {
      for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
        const j = P.col[k], v = 9 * k;
        for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) val[v + 3 * p + q] *= s[3 * i + p] * s[3 * j + q];
      }
    }
  }

  _buildPC(kind) {
    const m = this.model;
    const t0 = nowMs();
    if (this.pc && this.pcKind === kind) {
      if (kind === 'mg') this.pc.update(m.val, this.s); else this.pc.update(m.val);
    } else if (kind === 'mg') this.pc = new MultigridPC(m.mesh, m.pattern, m.val, this.s, this.opts.mg);
    else this.pc = new ICPC(m.pattern, m.val);
    this.pcKind = kind;
    this.needRebuild = false;
    return nowMs() - t0;
  }

  /** Galerkin projection of the rhs onto stored solutions (unscaled space). */
  _warmStart(fs, x) {
    const m = this.basis.length;
    x.fill(0);
    if (!m) return;
    const P = this.model.pattern, val = this.model.val, s = this.s, n = this.n;
    const KV = [], tmp = new Float64Array(n), tmp2 = new Float64Array(n);
    for (let i = 0; i < m; i++) {
      // K v = S^-1 Ks S^-1 v
      const v = this.basis[i];
      for (let q = 0; q < n; q++) tmp[q] = v[q] / s[q];
      fullMatVec(P, val, tmp, tmp2);
      const kv = new Float64Array(n);
      for (let q = 0; q < n; q++) kv[q] = tmp2[q] / s[q];
      KV.push(kv);
    }
    const A = new Float64Array(m * m), b = new Float64Array(m);
    // rhs in unscaled space: f = fs / s
    for (let i = 0; i < m; i++) {
      let bi = 0;
      for (let q = 0; q < n; q++) bi += this.basis[i][q] * fs[q] / s[q];
      b[i] = bi;
      for (let j = 0; j < m; j++) A[i * m + j] = dot(this.basis[i], KV[j]);
    }
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) { const v = 0.5 * (A[i * m + j] + A[j * m + i]); A[i * m + j] = A[j * m + i] = v; }
    let c;
    try { c = solveDense(A, m, b); } catch (e) { return; }
    for (let i = 0; i < m; i++) if (!isFinite(c[i])) return;
    for (let i = 0; i < m; i++) axpy(c[i], this.basis[i], x);
    // to scaled coordinates
    for (let q = 0; q < n; q++) x[q] /= s[q];
  }

  _storeSolution(u) {
    const v = Float64Array.from(u);
    for (const b of this.basis) axpy(-dot(b, v), b, v);
    for (const b of this.basis) axpy(-dot(b, v), b, v); // second pass for stability
    const nv = norm2(v);
    if (!(nv > 1e-14 * (norm2(u) + 1e-300))) return;
    for (let q = 0; q < v.length; q++) v[q] /= nv;
    this.basis.push(v);
    if (this.basis.length > this.opts.warm) this.basis.shift();
  }

  /**
   * Solve K u = f for the currently assembled model values. Returns
   * {u, iters, relres, ms, precond, rebuilt}. The model values are scaled in
   * place (the caller must reassemble before another solve).
   */
  solve(f, label, key) {
    const t0 = nowMs();
    const n = this.n, m = this.model, tol = this.opts.tol;
    // a different matrix structure (process stage) always needs a fresh preconditioner
    if (key !== undefined && key !== this.pcKey) this.needRebuild = true;
    this.pcKey = key;
    this._scale();
    const s = this.s, fs = this._bs;
    for (let q = 0; q < n; q++) fs[q] = f[q] * s[q];
    const x = this._x;
    const bnorm = norm2(fs);
    let rebuilt = false, pcMs = 0;
    if (bnorm === 0) {
      const u = new Float64Array(n);
      const rec = { label, iters: 0, relres: 0, ms: nowMs() - t0, precond: this.pcKind || this.opts.precond, rebuilt: false, warm: this.basis.length, note: 'zero load' };
      this.log.push(rec); this.lastResult = rec;
      return Object.assign({ u }, rec);
    }
    if (!this.pc || this.needRebuild) { pcMs = this._buildPC(this.opts.precond); rebuilt = true; }
    this._warmStart(fs, x);
    // iteration budget before a rebuild: twice the count right after the last build
    let budget = rebuilt ? this.opts.maxit : Math.max(2 * this.itersAtBuild, CONST.REBUILD_MIN_ITERS);
    let res = this._pcg(fs, x, tol, Math.min(budget, this.opts.maxit));
    let fallback = null, totalIters = res.iters, itersAfterBuild = rebuilt ? res.iters : 0;
    if (!res.converged && !rebuilt) {
      // stale preconditioner (e.g. a material event between evaluations): rebuild the preferred kind and continue
      pcMs += this._buildPC(this.opts.precond); rebuilt = true;
      res = this._pcg(fs, x, tol, this.opts.maxit);
      totalIters += res.iters; itersAfterBuild = res.iters;
    }
    if (!res.converged) {
      // rebuild with the other method once (keep the current iterate)
      const other = this.pcKind === 'mg' ? 'ic' : 'mg';
      fallback = { first: this.pcKind, iters: totalIters, relres: res.relres };
      pcMs += this._buildPC(other); rebuilt = true;
      res = this._pcg(fs, x, tol, this.opts.maxit);
      totalIters += res.iters;
      this.needRebuild = true; // return to the preferred preconditioner on the next solve
    }
    res.iters = totalIters;
    const u = new Float64Array(n);
    for (let q = 0; q < n; q++) u[q] = x[q] * s[q];
    if (rebuilt && !fallback) this.itersAtBuild = Math.max(itersAfterBuild, 1);
    else if (!fallback && res.iters > CONST.REBUILD_FACTOR * this.itersAtBuild) this.needRebuild = true;
    if (res.converged) this._storeSolution(u);
    const rec = { label, iters: res.iters, relres: res.relres, converged: res.converged, ms: nowMs() - t0, pcMs, precond: this.pcKind, rebuilt, warm: this.basis.length, iters0: res.iters0, fallback };
    this.log.push(rec); this.lastResult = rec;
    if (this.opts.log) this.opts.log(rec);
    return Object.assign({ u }, rec);
  }

  _pcg(b, x, tol, maxit) {
    const P = this.model.pattern, val = this.model.val, n = this.n;
    const r = this._r, z = this._z, p = this._p, q = this._q;
    const isC = this.model.isConstrained;
    fullMatVec(P, val, x, r);
    for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
    if (isC) for (let i = 0; i < n; i++) if (isC[i]) { r[i] = 0; x[i] = 0; }
    const bnorm = norm2(b);
    let rnorm = norm2(r);
    const r0 = rnorm / bnorm;
    if (rnorm / bnorm < tol) return { iters: 0, relres: rnorm / bnorm, converged: true, iters0: r0 };
    this.pc.apply(r, z);
    if (isC) for (let i = 0; i < n; i++) if (isC[i]) z[i] = 0;
    p.set(z);
    let rz = dot(r, z), it = 0;
    for (it = 1; it <= maxit; it++) {
      fullMatVec(P, val, p, q);
      const pq = dot(p, q);
      if (!(pq > 0)) break;
      const alpha = rz / pq;
      axpy(alpha, p, x);
      axpy(-alpha, q, r);
      rnorm = norm2(r);
      if (rnorm / bnorm < tol) return { iters: it, relres: rnorm / bnorm, converged: true, iters0: r0 };
      this.pc.apply(r, z);
      if (isC) for (let i = 0; i < n; i++) if (isC[i]) z[i] = 0;
      const rz2 = dot(r, z);
      const beta = rz2 / rz;
      rz = rz2;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    return { iters: Math.min(it, maxit), relres: rnorm / bnorm, converged: false, iters0: r0 };
  }
}
