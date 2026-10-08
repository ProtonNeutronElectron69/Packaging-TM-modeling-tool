// ===== Post-processing (Section 8) ==========================================

/** Natural coordinates of (x, y, z) inside element e. */
function naturalCoords(mesh, e, x, y, z) {
  const i = mesh.eIJK[3 * e], j = mesh.eIJK[3 * e + 1], k = mesh.eIJK[3 * e + 2];
  return [
    clamp(2 * (x - mesh.xs[i]) / (mesh.xs[i + 1] - mesh.xs[i]) - 1, -1, 1),
    clamp(2 * (y - mesh.ys[j]) / (mesh.ys[j + 1] - mesh.ys[j]) - 1, -1, 1),
    clamp(2 * (z - mesh.zs[k]) / (mesh.zs[k + 1] - mesh.zs[k]) - 1, -1, 1),
  ];
}

/** Cell indices (i, j, k) containing (x, y, z). */
function cellAt(mesh, x, y, z) {
  return [findInterval(mesh.xs, x), findInterval(mesh.ys, y), findInterval(mesh.zs, z)];
}

/** Element of a given part in cell (i, j, k), or -1. */
function elementInCell(mesh, i, j, k, part) {
  const ncy = mesh.ny - 1, ncz = mesh.nz - 1;
  const c = (i * ncy + j) * ncz + k;
  for (let q = 0; q < 2; q++) {
    const e = mesh.cellElems[2 * c + q];
    if (e >= 0 && (part == null || mesh.ePart[e] === part)) return e;
  }
  return -1;
}

/** Bilinear interpolation of a nodal field component on plane k at (x, y); NaN outside existing nodes. */
function samplePlane(mesh, u, k, comp, x, y) {
  const i = findInterval(mesh.xs, x), j = findInterval(mesh.ys, y);
  const tx = (x - mesh.xs[i]) / (mesh.xs[i + 1] - mesh.xs[i]), ty = (y - mesh.ys[j]) / (mesh.ys[j + 1] - mesh.ys[j]);
  const id = (a, b) => mesh.nodeId[((i + a) * mesh.ny + j + b) * mesh.nz + k];
  const n00 = id(0, 0), n10 = id(1, 0), n01 = id(0, 1), n11 = id(1, 1);
  if (n00 < 0 || n10 < 0 || n01 < 0 || n11 < 0) return NaN;
  return (1 - tx) * (1 - ty) * u[3 * n00 + comp] + tx * (1 - ty) * u[3 * n10 + comp] + (1 - tx) * ty * u[3 * n01 + comp] + tx * ty * u[3 * n11 + comp];
}

/** Nodal field component on plane k as an nx x ny grid (NaN where absent). */
function planeGrid(mesh, u, k, comp) {
  const g = new Float64Array(mesh.nx * mesh.ny).fill(NaN);
  for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) {
    const n = mesh.nodeId[(i * mesh.ny + j) * mesh.nz + k];
    if (n >= 0) g[i * mesh.ny + j] = u[3 * n + comp];
  }
  return g;
}

/** Plane index of a z level. */
function planeIndex(mesh, z) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < mesh.nz; k++) { const d = Math.abs(mesh.zs[k] - z); if (d < bd) { bd = d; best = k; } }
  return best;
}

/**
 * JEITA ED-7306 / JESD22-B112 warpage of the substrate bottom surface over the
 * BGA measuring zone from displacement field u (Section 8.1).
 */
function warpageJEITA(mesh, geom, u, cfg, sampler) {
  const b = geom.bga, n = b.x.length;
  const sample = sampler || ((x, y) => samplePlane(mesh, u, 0, 2, x, y));
  const w = new Float64Array(n);
  for (let q = 0; q < n; q++) w[q] = sample(b.x[q], b.y[q]);
  const pl = fitPlane(b.x, b.y, w);
  const res = new Float64Array(n);
  let rmin = Infinity, rmax = -Infinity;
  for (let q = 0; q < n; q++) { res[q] = w[q] - (pl.c0 + pl.c1 * b.x[q] + pl.c2 * b.y[q]); rmin = Math.min(rmin, res[q]); rmax = Math.max(rmax, res[q]); }
  const mag = rmax - rmin;
  // sign from the two diagonals of the measuring zone
  const z = b.zone;
  const diag = (xa, ya, xb, yb) => {
    const m = CONST.DIAG_SAMPLES, s = new Float64Array(m), rel = new Float64Array(m), wv = new Float64Array(m);
    const wa = sample(xa, ya), wb = sample(xb, yb);
    let mx = 0, mn = 0;
    for (let q = 0; q < m; q++) {
      const t = q / (m - 1);
      const x = xa + t * (xb - xa), y = ya + t * (yb - ya);
      wv[q] = sample(x, y);
      s[q] = t * Math.hypot(xb - xa, yb - ya);
      rel[q] = wv[q] - (wa + t * (wb - wa));
      if (rel[q] > mx) mx = rel[q];
      if (rel[q] < mn) mn = rel[q];
    }
    return { s, w: wv, rel, max: mx, min: mn };
  };
  const AB = diag(z.x0, z.y0, z.x1, z.y1), CD = diag(z.x0, z.y1, z.x1, z.y0);
  const sum = AB.max + AB.min + CD.max + CD.min;
  const sign = sum > 0 ? 1 : (sum < 0 ? -1 : 0);
  const lim = (cfg.limits.jeita || JEITA_TABLE).find(r => Math.abs(r.pitch - cfg.bga.pitch) < 1e-6) || null;
  // residual grid over the whole bottom plane for contours
  const grid = planeGrid(mesh, u, 0, 2);
  for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) grid[i * mesh.ny + j] -= pl.c0 + pl.c1 * mesh.xs[i] + pl.c2 * mesh.ys[j];
  return { signed: sign * mag, mag, sign, plane: pl, ballW: w, ballRes: res, diagAB: AB, diagCD: CD, limitHot: lim ? lim.hot : null, limitRT: lim ? lim.rt : null, grid, rmin, rmax };
}

/** Least-squares quadratic w = c0 + c1 x + c2 y + c3 x^2 + c4 y^2 + c5 xy over samples; returns curvatures. */
function fitCurvature(xs, ys, ws) {
  const m = 6, A = new Float64Array(36), b = new Float64Array(6);
  let n = 0;
  for (let q = 0; q < ws.length; q++) {
    if (!isFinite(ws[q])) continue;
    n++;
    const f = [1, xs[q], ys[q], xs[q] * xs[q], ys[q] * ys[q], xs[q] * ys[q]];
    for (let i = 0; i < m; i++) { b[i] += f[i] * ws[q]; for (let j = 0; j < m; j++) A[i * m + j] += f[i] * f[j]; }
  }
  if (n < 8) return { kxx: NaN, kyy: NaN, kxy: NaN };
  let c;
  try { c = solveDense(A, m, b); } catch (e) { return { kxx: NaN, kyy: NaN, kxy: NaN }; }
  return { kxx: 2 * c[3], kyy: 2 * c[4], kxy: c[5] };
}

/** Substrate top-surface warpage map and die-to-substrate relative curvature. */
function substrateTopWarpage(mesh, geom, u) {
  const k = planeIndex(mesh, geom.zt);
  const grid = planeGrid(mesh, u, k, 2);
  const xs = [], ys = [], ws = [];
  for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) { const v = grid[i * mesh.ny + j]; if (isFinite(v)) { xs.push(mesh.xs[i]); ys.push(mesh.ys[j]); ws.push(v); } }
  const pl = fitPlane(xs, ys, ws);
  for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) grid[i * mesh.ny + j] -= pl.c0 + pl.c1 * mesh.xs[i] + pl.c2 * mesh.ys[j];
  let mn = Infinity, mx = -Infinity;
  for (const v of grid) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const dies = geom.dies.map(d => {
    const kt = planeIndex(mesh, d.ztop);
    const sx = [], sy = [], wt = [], wb = [];
    for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) {
      const x = mesh.xs[i], y = mesh.ys[j];
      if (!pointInRect(d.rect, x, y)) continue;
      const nt = mesh.nodeId[(i * mesh.ny + j) * mesh.nz + kt], nb = mesh.nodeId[(i * mesh.ny + j) * mesh.nz + k];
      if (nt < 0 || nb < 0) continue;
      sx.push(x); sy.push(y); wt.push(u[3 * nt + 2]); wb.push(u[3 * nb + 2]);
    }
    const ct = fitCurvature(sx, sy, wt), cs = fitCurvature(sx, sy, wb);
    return { die: d.name, dieKxx: ct.kxx, dieKyy: ct.kyy, subKxx: cs.kxx, subKyy: cs.kyy, relKxx: ct.kxx - cs.kxx, relKyy: ct.kyy - cs.kyy };
  });
  return { grid, mag: mx - mn, dies };
}

/**
 * Nodal-averaged stress tensor on one surface (top or bottom) of a die from the
 * Gauss-point stresses of the adjacent die elements, extrapolated to nodes and
 * averaged only among elements of that die. Returns grids over the die columns.
 */
function dieSurfaceStress(model, geom, dieIdx, which, T, stage, u) {
  const mesh = model.mesh, d = geom.dies[dieIdx];
  const top = which === 'top';
  const kPlane = planeIndex(mesh, top ? d.ztop : d.zaf);
  const kElem = top ? kPlane - 1 : kPlane;
  const zetaFace = top ? 1 : -1;
  const i0 = findInterval(mesh.xs, d.rect.x0 + 1e-9), i1 = findInterval(mesh.xs, d.rect.x1 - 1e-9) + 1;
  const j0 = findInterval(mesh.ys, d.rect.y0 + 1e-9), j1 = findInterval(mesh.ys, d.rect.y1 - 1e-9) + 1;
  const nxd = i1 - i0 + 1, nyd = j1 - j0 + 1;
  const sum = new Float64Array(nxd * nyd * 6), cnt = new Int32Array(nxd * nyd);
  const q = new Float64Array(33), gp = new Float64Array(48), st = { eps: new Float64Array(6), sig: new Float64Array(6), mech: new Float64Array(6) };
  let gpPeak = -Infinity, gpPeakAll = -Infinity;
  const band = CONST.DIE_EDGE_BAND;
  const inner = { x0: d.rect.x0 + band, x1: d.rect.x1 - band, y0: d.rect.y0 + band, y1: d.rect.y1 - band };
  const group = mesh.G.die[dieIdx];
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const e = elementInCell(mesh, i, j, kElem, PART.DIE);
    if (e < 0 || mesh.eGroup[e] !== group) continue;
    model.elementState(e, T, stage, u, q);
    for (let g = 0; g < 8; g++) {
      model.pointStress(e, T, stage, q, HEX_XI[g] * GP2, HEX_ETA[g] * GP2, HEX_ZETA[g] * GP2, st);
      gp.set(st.sig, 6 * g);
      const sp = maxPrincipal(st.sig);
      if (HEX_ZETA[g] === zetaFace) {
        const gx = 0.5 * (mesh.xs[i] + mesh.xs[i + 1]) + HEX_XI[g] * GP2 * 0.5 * (mesh.xs[i + 1] - mesh.xs[i]);
        const gy = 0.5 * (mesh.ys[j] + mesh.ys[j + 1]) + HEX_ETA[g] * GP2 * 0.5 * (mesh.ys[j + 1] - mesh.ys[j]);
        gpPeakAll = Math.max(gpPeakAll, sp);
        if (pointInRect(inner, gx, gy)) gpPeak = Math.max(gpPeak, sp);
      }
    }
    // extrapolate to the 4 face nodes
    for (let a = 0; a < 8; a++) {
      if (HEX_ZETA[a] !== zetaFace) continue;
      const gi = i - i0 + (HEX_XI[a] > 0 ? 1 : 0), gj = j - j0 + (HEX_ETA[a] > 0 ? 1 : 0);
      const o = (gi * nyd + gj) * 6;
      for (let c = 0; c < 6; c++) { let v = 0; for (let g = 0; g < 8; g++) v += GP_TO_NODE[a * 8 + g] * gp[6 * g + c]; sum[o + c] += v; }
      cnt[gi * nyd + gj]++;
    }
  }
  const smax = new Float64Array(nxd * nyd).fill(NaN), sxx = new Float64Array(nxd * nyd).fill(NaN), syy = new Float64Array(nxd * nyd).fill(NaN);
  const tens = new Float64Array(6);
  for (let p = 0; p < nxd * nyd; p++) {
    if (!cnt[p]) continue;
    for (let c = 0; c < 6; c++) tens[c] = sum[6 * p + c] / cnt[p];
    smax[p] = maxPrincipal(tens); sxx[p] = tens[0]; syy[p] = tens[1];
  }
  const xs = Float64Array.from(mesh.xs.subarray(i0, i1 + 1)), ys = Float64Array.from(mesh.ys.subarray(j0, j1 + 1));
  // interior peak (nodal) excluding the edge band
  let peak = -Infinity, px = NaN, py = NaN;
  for (let a = 0; a < nxd; a++) for (let b = 0; b < nyd; b++) {
    const v = smax[a * nyd + b];
    if (!isFinite(v) || !pointInRect(inner, xs[a], ys[b])) continue;
    if (v > peak) { peak = v; px = xs[a]; py = ys[b]; }
  }
  // patch averages at corners and mid-edges (100 um x 100 um, 5 x 5 samples)
  const sampleGrid = (x, y) => {
    const a = findInterval(xs, x), b = findInterval(ys, y);
    const tx = (x - xs[a]) / (xs[a + 1] - xs[a]), ty = (y - ys[b]) / (ys[b + 1] - ys[b]);
    const v00 = smax[a * nyd + b], v10 = smax[(a + 1) * nyd + b], v01 = smax[a * nyd + b + 1], v11 = smax[(a + 1) * nyd + b + 1];
    return (1 - tx) * (1 - ty) * v00 + tx * (1 - ty) * v10 + (1 - tx) * ty * v01 + tx * ty * v11;
  };
  const patch = (xa, ya) => {
    const P = CONST.CORNER_PATCH, m = CONST.PATCH_SAMPLES;
    let s = 0;
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) s += sampleGrid(xa + P * (a + 0.5) / m, ya + P * (b + 0.5) / m);
    return s / (m * m);
  };
  const P = CONST.CORNER_PATCH, r = d.rect;
  const corners = [
    { name: 'corner (-x,-y)', x: r.x0, y: r.y0, value: patch(r.x0, r.y0) },
    { name: 'corner (+x,-y)', x: r.x1, y: r.y0, value: patch(r.x1 - P, r.y0) },
    { name: 'corner (+x,+y)', x: r.x1, y: r.y1, value: patch(r.x1 - P, r.y1 - P) },
    { name: 'corner (-x,+y)', x: r.x0, y: r.y1, value: patch(r.x0, r.y1 - P) },
  ];
  const cx = 0.5 * (r.x0 + r.x1), cy = 0.5 * (r.y0 + r.y1);
  const midEdges = [
    { name: 'mid-edge -y', x: cx, y: r.y0, value: patch(cx - P / 2, r.y0) },
    { name: 'mid-edge +x', x: r.x1, y: cy, value: patch(r.x1 - P, cy - P / 2) },
    { name: 'mid-edge +y', x: cx, y: r.y1, value: patch(cx - P / 2, r.y1 - P) },
    { name: 'mid-edge -x', x: r.x0, y: cy, value: patch(r.x0, cy - P / 2) },
  ];
  return { die: d.name, which, xs, ys, nx: nxd, ny: nyd, smax, sxx, syy, peakInterior: peak, peakX: px, peakY: py, gpPeakInterior: gpPeak, gpPeakAll, corners, midEdges, T };
}

/** Per-bump axial and shear forces from the solder-phase stress at each site (Section 8.3). */
function bumpLoads(model, geom, dieIdx, T, stage, u) {
  const mesh = model.mesh, d = geom.dies[dieIdx];
  const sites = dieBumpSites(d);
  const n = sites.x.length;
  const N = new Float64Array(n).fill(NaN), V = new Float64Array(n).fill(NaN), szz = new Float64Array(n).fill(NaN);
  const zmid = geom.zt + 0.5 * geom.so;
  const kb = findInterval(mesh.zs, zmid);
  const byElem = new Map();
  for (let q = 0; q < n; q++) {
    const i = findInterval(mesh.xs, sites.x[q]), j = findInterval(mesh.ys, sites.y[q]);
    const e = elementInCell(mesh, i, j, kb, PART.SOLDER);
    if (e < 0) continue;
    if (!byElem.has(e)) byElem.set(e, []);
    byElem.get(e).push(q);
  }
  const qv = new Float64Array(33), st = { eps: new Float64Array(6), sig: new Float64Array(6), mech: new Float64Array(6) };
  const A = d.abump;
  for (const [e, list] of byElem) {
    model.elementState(e, T, stage, u, qv);
    for (const q of list) {
      const [xi, eta, zeta] = naturalCoords(mesh, e, sites.x[q], sites.y[q], zmid);
      model.pointStress(e, T, stage, qv, xi, eta, zeta, st);
      szz[q] = st.sig[2];
      N[q] = st.sig[2] * A;
      V[q] = Math.hypot(st.sig[4], st.sig[5]) * A;
    }
  }
  let worstN = -Infinity, worstV = -Infinity, iN = -1, iV = -1;
  for (let q = 0; q < n; q++) {
    if (isFinite(N[q]) && Math.abs(N[q]) > worstN) { worstN = Math.abs(N[q]); iN = q; }
    if (isFinite(V[q]) && V[q] > worstV) { worstV = V[q]; iV = q; }
  }
  const order = Array.from({ length: n }, (_, q) => q).filter(q => isFinite(V[q])).sort((a, b) => Math.hypot(N[b], V[b]) - Math.hypot(N[a], V[a])).slice(0, 10);
  return { die: d.name, x: sites.x, y: sites.y, ix: sites.ix, iy: sites.iy, N, V, szz, worstN: iN >= 0 ? N[iN] : NaN, worstV: iV >= 0 ? V[iV] : NaN, worstNidx: iN, worstVidx: iV, worst: order.map(q => ({ q, x: sites.x[q], y: sites.y[q], N: N[q], V: V[q] })), T, abump: A };
}

/**
 * Underfill interface tractions along the die perimeter (Section 8.4): die
 * sidewall to fillet (normal = outward die normal) and die active face to
 * underfill near the edge (normal = z), from underfill-side stresses averaged
 * over 50 um x 50 um patches.
 */
function ufTractions(model, geom, dieIdx, T, stage, u) {
  const mesh = model.mesh, d = geom.dies[dieIdx], r = d.rect;
  const step = CONST.TRACTION_PATCH, ns = CONST.TRACTION_SAMPLES;
  const edges = [
    { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y0, nx: 0, ny: -1 },
    { x0: r.x1, y0: r.y0, x1: r.x1, y1: r.y1, nx: 1, ny: 0 },
    { x0: r.x1, y0: r.y1, x1: r.x0, y1: r.y1, nx: 0, ny: 1 },
    { x0: r.x0, y0: r.y1, x1: r.x0, y1: r.y0, nx: -1, ny: 0 },
  ];
  const s = [], px = [], py = [], peelSide = [], shearSide = [], peelFace = [], shearFace = [];
  const corners = [0];
  let s0 = 0;
  const qv = new Float64Array(33), st = { eps: new Float64Array(6), sig: new Float64Array(6), mech: new Float64Array(6) };
  const cache = new Map();
  const stateOf = e => { if (!cache.has(e)) { const q = new Float64Array(33); model.elementState(e, T, stage, u, q); cache.set(e, q); } return cache.get(e); };
  const sigAt = (x, y, z, part) => {
    const [i, j, k] = cellAt(mesh, x, y, z);
    const e = elementInCell(mesh, i, j, k, part);
    if (e < 0) return null;
    const q = stateOf(e);
    const [xi, eta, zeta] = naturalCoords(mesh, e, x, y, z);
    model.pointStress(e, T, stage, q, xi, eta, zeta, st);
    return st.sig;
  };
  const eps = 1e-6;
  for (const ed of edges) {
    const L = Math.hypot(ed.x1 - ed.x0, ed.y1 - ed.y0);
    const tx = (ed.x1 - ed.x0) / L, ty = (ed.y1 - ed.y0) / L;
    const m = Math.max(1, Math.round(L / step));
    for (let p = 0; p < m; p++) {
      const sc = (p + 0.5) * L / m;
      const xc = ed.x0 + tx * sc, yc = ed.y0 + ty * sc;
      let pS = 0, vS = 0, pF = 0, vF = 0, cS = 0, cF = 0;
      for (let a = 0; a < ns; a++) for (let b = 0; b < ns; b++) {
        const ds = (a + 0.5) / ns * step - step / 2;
        const xs = xc + tx * ds, ys = yc + ty * ds;
        // sidewall patch: just outside the die, z from the active face up by one patch
        const zS = d.zaf + (b + 0.5) / ns * step;
        const sg = sigAt(xs + ed.nx * eps, ys + ed.ny * eps, zS, PART.UF_FILLET) || sigAt(xs + ed.nx * eps, ys + ed.ny * eps, zS, null);
        if (sg) {
          // traction t = sigma n, n = (nx, ny, 0)
          const t0 = sg[0] * ed.nx + sg[3] * ed.ny, t1 = sg[3] * ed.nx + sg[1] * ed.ny, t2 = sg[5] * ed.nx + sg[4] * ed.ny;
          const tn = t0 * ed.nx + t1 * ed.ny;
          pS += tn; vS += Math.hypot(t0 - tn * ed.nx, t1 - tn * ed.ny, t2); cS++;
        }
        // active-face patch: inside the die edge by one patch, just below the active face
        const inX = xs - ed.nx * (b + 0.5) / ns * step, inY = ys - ed.ny * (b + 0.5) / ns * step;
        const sf = sigAt(inX, inY, d.zaf - eps, PART.UF_BUMP);
        if (sf) { pF += sf[2]; vF += Math.hypot(sf[4], sf[5]); cF++; }
      }
      s.push(s0 + sc); px.push(xc); py.push(yc);
      peelSide.push(cS ? pS / cS : NaN); shearSide.push(cS ? vS / cS : NaN);
      peelFace.push(cF ? pF / cF : NaN); shearFace.push(cF ? vF / cF : NaN);
    }
    s0 += L;
    corners.push(s0);
  }
  const mx = arr => arr.reduce((m, v) => isFinite(v) && v > m ? v : m, -Infinity);
  return { die: d.name, s: Float64Array.from(s), x: Float64Array.from(px), y: Float64Array.from(py), peelSide: Float64Array.from(peelSide), shearSide: Float64Array.from(shearSide), peelFace: Float64Array.from(peelFace), shearFace: Float64Array.from(shearFace), corners, maxPeelSide: mx(peelSide), maxShearSide: mx(shearSide), maxPeelFace: mx(peelFace), maxShearFace: mx(shearFace), T };
}

/** Boundary quads of the structured mesh for the 3D view: [n0 n1 n2 n3] per face plus part id. */
function boundaryFaces(mesh) {
  const nx = mesh.nx, ny = mesh.ny, nz = mesh.nz, ncy = ny - 1, ncz = nz - 1;
  const faces = [], parts = [], elems = [];
  const has = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ncy || k >= ncz) ? false : mesh.cellElems[2 * ((i * ncy + j) * ncz + k)] >= 0;
  const nid = (i, j, k) => mesh.nodeId[(i * ny + j) * nz + k];
  const dirs = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  for (let e = 0; e < mesh.ne; e++) {
    const i = mesh.eIJK[3 * e], j = mesh.eIJK[3 * e + 1], k = mesh.eIJK[3 * e + 2];
    // superposed pair: only the first element of the cell draws faces
    const c = (i * ncy + j) * ncz + k;
    if (mesh.cellElems[2 * c] !== e) continue;
    for (let dd = 0; dd < 6; dd++) {
      const [di, dj, dk] = dirs[dd];
      if (has(i + di, j + dj, k + dk)) continue;
      let f;
      switch (dd) {
        case 0: f = [nid(i, j, k), nid(i, j, k + 1), nid(i, j + 1, k + 1), nid(i, j + 1, k)]; break;
        case 1: f = [nid(i + 1, j, k), nid(i + 1, j + 1, k), nid(i + 1, j + 1, k + 1), nid(i + 1, j, k + 1)]; break;
        case 2: f = [nid(i, j, k), nid(i + 1, j, k), nid(i + 1, j, k + 1), nid(i, j, k + 1)]; break;
        case 3: f = [nid(i, j + 1, k), nid(i, j + 1, k + 1), nid(i + 1, j + 1, k + 1), nid(i + 1, j + 1, k)]; break;
        case 4: f = [nid(i, j, k), nid(i, j + 1, k), nid(i + 1, j + 1, k), nid(i + 1, j, k)]; break;
        default: f = [nid(i, j, k + 1), nid(i + 1, j, k + 1), nid(i + 1, j + 1, k + 1), nid(i, j + 1, k + 1)]; break;
      }
      faces.push(f[0], f[1], f[2], f[3]); parts.push(mesh.ePart[e]); elems.push(e);
    }
  }
  return { quads: Int32Array.from(faces), part: Int8Array.from(parts), elem: Int32Array.from(elems) };
}

/**
 * Nodal max principal stress per boundary face vertex, averaged among elements
 * of the same part (for the 3D view). Returns Float32Array(4 x nfaces).
 */
function faceStressField(model, faces, T, stage, u) {
  const mesh = model.mesh;
  const sum = new Map(); // key part*nn + node -> [sum, count]
  const q = new Float64Array(33), gp = new Float64Array(48), st = { eps: new Float64Array(6), sig: new Float64Array(6), mech: new Float64Array(6) };
  const tens = new Float64Array(6);
  const touched = new Set(Array.from(faces.elem));
  for (const e of touched) {
    model.elementState(e, T, stage, u, q);
    for (let g = 0; g < 8; g++) { model.pointStress(e, T, stage, q, HEX_XI[g] * GP2, HEX_ETA[g] * GP2, HEX_ZETA[g] * GP2, st); gp.set(st.sig, 6 * g); }
    const part = mesh.ePart[e];
    for (let a = 0; a < 8; a++) {
      for (let c = 0; c < 6; c++) { let v = 0; for (let g = 0; g < 8; g++) v += GP_TO_NODE[a * 8 + g] * gp[6 * g + c]; tens[c] = v; }
      const key = part * mesh.nn + mesh.conn[8 * e + a];
      const sp = maxPrincipal(tens);
      const rec = sum.get(key);
      if (rec) { rec[0] += sp; rec[1]++; } else sum.set(key, [sp, 1]);
    }
  }
  const nf = faces.part.length, out = new Float32Array(4 * nf);
  for (let f = 0; f < nf; f++) for (let v = 0; v < 4; v++) {
    const rec = sum.get(faces.part[f] * mesh.nn + faces.quads[4 * f + v]);
    out[4 * f + v] = rec ? rec[0] / rec[1] : 0;
  }
  return out;
}
