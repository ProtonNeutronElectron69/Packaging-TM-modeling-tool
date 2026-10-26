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

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function norm2(a) { return Math.sqrt(dot(a, a)); }
function axpy(alpha, x, y) { for (let i = 0; i < y.length; i++) y[i] += alpha * x[i]; }
