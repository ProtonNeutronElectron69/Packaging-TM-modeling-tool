// ===== Small utilities and dense linear algebra =========================

function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

/** Value of a database parameter: either a bare number or {v: number, ...meta}. */
function pv(p) {
  if (p !== null && typeof p === 'object' && 'v' in p) return p.v;
  return p;
}

/** Index i with a[i] <= x < a[i+1], clamped to [0, n-2]. a is ascending. */
function findInterval(a, x) {
  const n = a.length;
  if (x <= a[0]) return 0;
  if (x >= a[n - 1]) return n - 2;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= x) lo = mid; else hi = mid;
  }
  return lo;
}

/** Piecewise-linear interpolation in a table, with 'hold' or 'linear' extrapolation. */
function interpTable(xs, ys, x, extrap) {
  const n = xs.length;
  if (n === 1) return ys[0];
  if (x <= xs[0] && extrap !== 'linear') return ys[0];
  if (x >= xs[n - 1] && extrap !== 'linear') return ys[n - 1];
  const i = findInterval(xs, x);
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + t * (ys[i + 1] - ys[i]);
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/** Deterministic JSON (sorted keys) used for configuration hashing. */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !isFinite(v)) return 'null';
    return JSON.stringify(v);
  }
  if (ArrayBuffer.isView(v)) return '[' + Array.prototype.join.call(v, ',') + ']';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/** cyrb53 string hash (53-bit), returned as a hex string. */
function hashString(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const v = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return v.toString(16).padStart(14, '0');
}
function hashObject(o) { return hashString(stableStringify(o)); }

/**
 * In-place dense Cholesky A = L L^T of an n x n row-major SPD matrix (lower
 * triangle used, L overwrites it). A diagonal jitter rel*max(diag) is added
 * when a pivot is not positive, so singular coarse operators stay usable as
 * preconditioners. Returns the number of jittered pivots.
 */
function cholDense(A, n, rel) {
  let dmax = 0;
  for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.abs(A[i * n + i]));
  const jitter = (rel || CONST.CHOL_JITTER) * (dmax || 1);
  let fixes = 0;
  for (let j = 0; j < n; j++) {
    const rj = j * n;
    let d = A[rj + j];
    for (let k = 0; k < j; k++) d -= A[rj + k] * A[rj + k];
    if (!(d > jitter)) { d = Math.max(Math.abs(d), jitter); fixes++; }
    const ljj = Math.sqrt(d);
    A[rj + j] = ljj;
    const inv = 1 / ljj;
    for (let i = j + 1; i < n; i++) {
      const ri = i * n;
      let s = A[ri + j];
      for (let k = 0; k < j; k++) s -= A[ri + k] * A[rj + k];
      A[ri + j] = s * inv;
    }
  }
  return fixes;
}

/** Solve L L^T x = b in place (b overwritten by x) with the factor from cholDense. */
function cholSolveDense(L, n, b, off) {
  off = off || 0;
  for (let i = 0; i < n; i++) {
    let s = b[off + i];
    const ri = i * n;
    for (let k = 0; k < i; k++) s -= L[ri + k] * b[off + k];
    b[off + i] = s / L[ri + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[off + i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * b[off + k];
    b[off + i] = s / L[i * n + i];
  }
}

/** General dense inverse by Gauss-Jordan with partial pivoting (small matrices). */
function invDense(A, n) {
  const M = new Float64Array(n * 2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i * 2 * n + j] = A[i * n + j];
    M[i * 2 * n + n + i] = 1;
  }
  const w = 2 * n;
  for (let c = 0; c < n; c++) {
    let p = c, best = Math.abs(M[c * w + c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(M[r * w + c]); if (v > best) { best = v; p = r; } }
    if (best === 0) throw new Error('singular matrix in invDense');
    if (p !== c) for (let j = 0; j < w; j++) { const t = M[c * w + j]; M[c * w + j] = M[p * w + j]; M[p * w + j] = t; }
    const inv = 1 / M[c * w + c];
    for (let j = 0; j < w; j++) M[c * w + j] *= inv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r * w + c];
      if (f === 0) continue;
      for (let j = 0; j < w; j++) M[r * w + j] -= f * M[c * w + j];
    }
  }
  const R = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) R[i * n + j] = M[i * w + n + j];
  return R;
}

/** Solve a small dense system A x = b (A not modified). */
function solveDense(A, n, b) {
  const Ai = invDense(A, n);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += Ai[i * n + j] * b[j]; x[i] = s; }
  return x;
}

/**
 * Eigenvalues of a symmetric 3x3 tensor given in Voigt order
 * [sxx, syy, szz, sxy, syz, szx] (closed form, Smith 1961). Returned descending.
 */
function eigSym3(s, out) {
  const a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5];
  const p1 = d * d + e * e + f * f;
  out = out || new Float64Array(3);
  if (p1 <= 1e-30 * (a * a + b * b + c * c + 1e-300)) {
    let x = a, y = b, z = c, t;
    if (x < y) { t = x; x = y; y = t; }
    if (y < z) { t = y; y = z; z = t; }
    if (x < y) { t = x; x = y; y = t; }
    out[0] = x; out[1] = y; out[2] = z; return out;
  }
  const q = (a + b + c) / 3;
  const p2 = (a - q) * (a - q) + (b - q) * (b - q) + (c - q) * (c - q) + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const B0 = (a - q) / p, B1 = (b - q) / p, B2 = (c - q) / p, B3 = d / p, B4 = e / p, B5 = f / p;
  // det(B) for the symmetric matrix [[B0,B3,B5],[B3,B1,B4],[B5,B4,B2]]
  const detB = B0 * (B1 * B2 - B4 * B4) - B3 * (B3 * B2 - B4 * B5) + B5 * (B3 * B4 - B1 * B5);
  const r = clamp(detB / 2, -1, 1);
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3);
  out[0] = e1; out[2] = e3; out[1] = 3 * q - e1 - e3;
  return out;
}

function maxPrincipal(s) { return eigSym3(s)[0]; }

/** Least-squares plane w = c0 + c1 x + c2 y through points (x[i], y[i], w[i]). */
function fitPlane(xs, ys, ws) {
  const n = ws.length;
  let sx = 0, sy = 0, sw = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sw += ws[i]; }
  const mx = sx / n, my = sy / n, mw = sw / n;
  let sxx = 0, sxy = 0, syy = 0, sxw = 0, syw = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my, dw = ws[i] - mw;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxw += dx * dw; syw += dy * dw;
  }
  const det = sxx * syy - sxy * sxy;
  let c1 = 0, c2 = 0;
  if (Math.abs(det) > 1e-300) { c1 = (sxw * syy - syw * sxy) / det; c2 = (syw * sxx - sxw * sxy) / det; }
  return { c0: mw - c1 * mx - c2 * my, c1, c2 };
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/** Simpson integration of f over [a, b] with n (even) sub-intervals. */
function simpson(f, a, b, n) {
  if (n % 2) n++;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}
