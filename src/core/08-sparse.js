// ===== Symmetric 3x3 block CSR, upper triangle (Section 7.2) =============
//
// Row i holds blocks (i, j) with j >= i, ascending j; the diagonal block is
// stored in full. Values are 9 doubles per block, row-major.

/** Sparsity pattern from element connectivity (nodes per element = npe). */
function bcsrFromElements(nn, conn, ne, npe) {
  npe = npe || 8;
  // node -> elements adjacency
  const cnt = new Int32Array(nn + 1);
  for (let q = 0; q < ne * npe; q++) cnt[conn[q] + 1]++;
  for (let i = 0; i < nn; i++) cnt[i + 1] += cnt[i];
  const adj = new Int32Array(ne * npe), fill = cnt.slice(0, nn);
  for (let e = 0; e < ne; e++) for (let a = 0; a < npe; a++) { const n = conn[e * npe + a]; adj[fill[n]++] = e; }
  const mark = new Int32Array(nn).fill(-1);
  const rowPtr = new Int32Array(nn + 1);
  const tmp = [];
  // first pass: count
  for (let i = 0; i < nn; i++) {
    let c = 0;
    for (let q = cnt[i]; q < cnt[i + 1]; q++) {
      const e = adj[q];
      for (let a = 0; a < npe; a++) { const j = conn[e * npe + a]; if (j >= i && mark[j] !== i) { mark[j] = i; c++; } }
    }
    rowPtr[i + 1] = rowPtr[i] + c;
  }
  const col = new Int32Array(rowPtr[nn]);
  mark.fill(-1);
  for (let i = 0; i < nn; i++) {
    tmp.length = 0;
    for (let q = cnt[i]; q < cnt[i + 1]; q++) {
      const e = adj[q];
      for (let a = 0; a < npe; a++) { const j = conn[e * npe + a]; if (j >= i && mark[j] !== i) { mark[j] = i; tmp.push(j); } }
    }
    tmp.sort((a, b) => a - b);
    col.set(tmp, rowPtr[i]);
  }
  return { n: nn, rowPtr, col, nb: rowPtr[nn] };
}

/** Block index of (i, j), j >= i; -1 if absent. */
function bcsrFind(P, i, j) {
  const c = P.col;
  let lo = P.rowPtr[i], hi = P.rowPtr[i + 1] - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, v = c[m];
    if (v === j) return m;
    if (v < j) lo = m + 1; else hi = m - 1;
  }
  return -1;
}

/**
 * Element-to-block map: for each element and each ordered local pair (a, b)
 * with node(a) <= node(b), the block index (npe*npe entries, -1 otherwise).
 */
function elementBlockMap(P, conn, ne, npe) {
  npe = npe || 8;
  const map = new Int32Array(ne * npe * npe).fill(-1);
  for (let e = 0; e < ne; e++) {
    for (let a = 0; a < npe; a++) {
      const na = conn[e * npe + a];
      for (let b = 0; b < npe; b++) {
        const nb = conn[e * npe + b];
        if (na <= nb) map[(e * npe + a) * npe + b] = bcsrFind(P, na, nb);
      }
    }
  }
  return map;
}

/** Scatter c * Ke (3npe x 3npe) of element e into block values val. */
function scatterElement(val, Ke, c, conn, e, bmap, npe) {
  npe = npe || 8;
  const n3 = 3 * npe;
  for (let a = 0; a < npe; a++) {
    const na = conn[e * npe + a];
    for (let b = 0; b < npe; b++) {
      const k = bmap[(e * npe + a) * npe + b];
      if (k < 0) continue;
      // node(a) <= node(b): block (na, nb) receives Ke[a, b]
      const v = 9 * k;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) val[v + p * 3 + q] += c * Ke[(3 * a + p) * n3 + 3 * b + q];
    }
  }
}

/** y = K x for the symmetric upper-stored block matrix. */
function bcsrMatVec(P, val, x, y) {
  const n = P.n, rp = P.rowPtr, col = P.col;
  y.fill(0);
  for (let i = 0; i < n; i++) {
    const xi0 = x[3 * i], xi1 = x[3 * i + 1], xi2 = x[3 * i + 2];
    let y0 = 0, y1 = 0, y2 = 0;
    for (let k = rp[i]; k < rp[i + 1]; k++) {
      const j = col[k], v = 9 * k;
      const a0 = val[v], a1 = val[v + 1], a2 = val[v + 2], a3 = val[v + 3], a4 = val[v + 4], a5 = val[v + 5], a6 = val[v + 6], a7 = val[v + 7], a8 = val[v + 8];
      const xj0 = x[3 * j], xj1 = x[3 * j + 1], xj2 = x[3 * j + 2];
      y0 += a0 * xj0 + a1 * xj1 + a2 * xj2;
      y1 += a3 * xj0 + a4 * xj1 + a5 * xj2;
      y2 += a6 * xj0 + a7 * xj1 + a8 * xj2;
      if (j !== i) {
        y[3 * j] += a0 * xi0 + a3 * xi1 + a6 * xi2;
        y[3 * j + 1] += a1 * xi0 + a4 * xi1 + a7 * xi2;
        y[3 * j + 2] += a2 * xi0 + a5 * xi1 + a8 * xi2;
      }
    }
    y[3 * i] += y0; y[3 * i + 1] += y1; y[3 * i + 2] += y2;
  }
  return y;
}

/** Diagonal of the scalar matrix. */
function bcsrDiag(P, val, d) {
  d = d || new Float64Array(3 * P.n);
  for (let i = 0; i < P.n; i++) {
    const v = 9 * P.rowPtr[i]; // diagonal block is first in row (j = i is smallest)
    d[3 * i] = val[v]; d[3 * i + 1] = val[v + 4]; d[3 * i + 2] = val[v + 8];
  }
  return d;
}

/**
 * Apply homogeneous Dirichlet constraints (zero rows and columns, keep the
 * diagonal). Returns the saved full rows of the constrained DOFs (for reactions).
 */
function bcsrConstrain(P, val, dofs) {
  const isC = new Uint8Array(3 * P.n);
  for (const d of dofs) isC[d] = 1;
  for (let i = 0; i < P.n; i++) {
    for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
      const j = P.col[k], v = 9 * k;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
        const r = 3 * i + p, c = 3 * j + q;
        if ((isC[r] || isC[c]) && !(r === c)) val[v + p * 3 + q] = 0;
      }
    }
  }
  return isC;
}

/** Extract full scalar rows of given DOFs (before constraining) as sparse lists. */
function bcsrRows(P, val, dofs) {
  const want = new Map();
  dofs.forEach((d, q) => want.set(d, q));
  const rows = dofs.map(() => ({ idx: [], val: [] }));
  for (let i = 0; i < P.n; i++) {
    for (let k = P.rowPtr[i]; k < P.rowPtr[i + 1]; k++) {
      const j = P.col[k], v = 9 * k;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
        const r = 3 * i + p, c = 3 * j + q, a = val[v + p * 3 + q];
        if (want.has(r)) { rows[want.get(r)].idx.push(c); rows[want.get(r)].val.push(a); }
        if (i !== j && want.has(c)) { rows[want.get(c)].idx.push(r); rows[want.get(c)].val.push(a); }
      }
    }
  }
  return rows;
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function norm2(a) { return Math.sqrt(dot(a, a)); }
function axpy(alpha, x, y) { for (let i = 0; i < y.length; i++) y[i] += alpha * x[i]; }
