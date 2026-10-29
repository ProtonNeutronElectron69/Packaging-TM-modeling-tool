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
  // sign robustness: |sum| relative to the magnitude; small values mean a saddle or ring shape whose
  // JEITA sign can flip between neighbouring states while the magnitude barely changes
  const signConf = mag > 0 ? Math.abs(sum) / mag : 0;
  const shape = classifyWarpageShape(res, b, pl, mag, AB, CD);
  const lim = (cfg.limits.jeita || JEITA_TABLE).find(r => Math.abs(r.pitch - cfg.bga.pitch) < 1e-6) || null;
  // residual grid over the whole bottom plane for contours
  const grid = planeGrid(mesh, u, 0, 2);
  for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) grid[i * mesh.ny + j] -= pl.c0 + pl.c1 * mesh.xs[i] + pl.c2 * mesh.ys[j];
  return { signed: sign * mag, mag, sign, signConf, marginal: signConf < CONST.SIGN_MARGINAL, shape, plane: pl, ballW: w, ballRes: res, diagAB: AB, diagCD: CD, limitHot: lim ? lim.hot : null, limitRT: lim ? lim.rt : null, grid, rmin, rmax };
}

/**
 * Shape class of the warpage surface from the two diagonal profiles relative
 * to their corner-to-corner lines (the JEITA sign data):
 *  'dome' / 'bowl': both diagonals have their dominant extremum at the centre,
 *  above / below the corner line;
 *  'ring': the centre is on one side of the corner line but an intermediate
 *  ring of comparable depth lies on the other (W or M profile), which is where
 *  the JEITA sign stops describing the centre;
 *  'saddle': the two diagonals disagree about the centre; 'flat': no warpage.
 */
function classifyWarpageShape(res, b, pl, mag, AB, CD) {
  if (!(mag > 0)) return 'flat';
  const prof = D => {
    const m = D.rel.length, ic = (m - 1) >> 1;
    const rc = D.rel[ic];
    let imax = 0, imin = 0;
    for (let q = 0; q < m; q++) { if (D.rel[q] > D.rel[imax]) imax = q; if (D.rel[q] < D.rel[imin]) imin = q; }
    const interior = i => { const t = i / (m - 1); return (t > 0.08 && t < 0.4) || (t > 0.6 && t < 0.92); };
    return { rc, max: D.rel[imax], min: D.rel[imin], maxInterior: interior(imax), minInterior: interior(imin) };
  };
  const a = prof(AB), c = prof(CD);
  const up = a.rc > 0.1 * mag && c.rc > 0.1 * mag, down = a.rc < -0.1 * mag && c.rc < -0.1 * mag;
  if (!up && !down) return 'saddle';
  if (up && (a.min < -0.2 * mag && a.minInterior || c.min < -0.2 * mag && c.minInterior)) return 'ring';
  if (down && (a.max > 0.2 * mag && a.maxInterior || c.max > 0.2 * mag && c.maxInterior)) return 'ring';
  // M or W profile on the same side of the corner line: the dominant extremum sits on an intermediate ring
  if (up && a.maxInterior && c.maxInterior && a.rc < 0.5 * a.max && c.rc < 0.5 * c.max) return 'ring';
  if (down && a.minInterior && c.minInterior && a.rc > 0.5 * a.min && c.rc > 0.5 * c.min) return 'ring';
  return up ? 'dome' : 'bowl';
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
 * Nodal-averaged stress tensor on one surface (top or bottom) of a silicon part
 * (geom.siParts: monolithic dies, chiplets, Si bases of stacked modules) from
 * the Gauss-point stresses of the adjacent elements of that part, extrapolated
 * to nodes and averaged only among them. Returns grids over the part's columns.
 */
function dieSurfaceStress(view, geom, dieIdx, which) {
  const mesh = view.model.mesh, d = geom.siParts[dieIdx], T = view.T;
  const top = which === 'top';
  const kPlane = planeIndex(mesh, top ? d.ztop : d.zb);
  const kElem = top ? kPlane - 1 : kPlane;
  const zetaFace = top ? 1 : -1;
  const i0 = findInterval(mesh.xs, d.rect.x0 + 1e-9), i1 = findInterval(mesh.xs, d.rect.x1 - 1e-9) + 1;
  const j0 = findInterval(mesh.ys, d.rect.y0 + 1e-9), j1 = findInterval(mesh.ys, d.rect.y1 - 1e-9) + 1;
  const nxd = i1 - i0 + 1, nyd = j1 - j0 + 1;
  const sum = new Float64Array(nxd * nyd * 6), cnt = new Int32Array(nxd * nyd);
  const gp = new Float64Array(48), st = { eps: new Float64Array(6), sig: new Float64Array(6) };
  let gpPeak = -Infinity, gpPeakAll = -Infinity;
  const band = CONST.DIE_EDGE_BAND;
  const inner = { x0: d.rect.x0 + band, x1: d.rect.x1 - band, y0: d.rect.y0 + band, y1: d.rect.y1 - band };
  const group = mesh.groupIndex[d.gkey];
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const e = elementInCell(mesh, i, j, kElem, d.part);
    if (e < 0 || mesh.eGroup[e] !== group) continue;
    for (let g = 0; g < 8; g++) {
      view.point(e, HEX_XI[g] * GP2, HEX_ETA[g] * GP2, HEX_ZETA[g] * GP2, st);
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
  // corners 1 to 4 clockwise from the bottom-right (+x, -y) corner; mid-edge k-(k+1) lies on the side from corner k to corner k+1
  const corners = dieCorners(r).map(c => ({ name: 'corner ' + c.n + ' (' + c.dir + ')', x: c.x, y: c.y, value: patch(c.sx > 0 ? c.x - P : c.x, c.sy > 0 ? c.y - P : c.y) }));
  const cx = 0.5 * (r.x0 + r.x1), cy = 0.5 * (r.y0 + r.y1);
  const midEdges = [
    { name: 'mid-edge 1-2 (-y side)', x: cx, y: r.y0, value: patch(cx - P / 2, r.y0) },
    { name: 'mid-edge 2-3 (-x side)', x: r.x0, y: cy, value: patch(r.x0, cy - P / 2) },
    { name: 'mid-edge 3-4 (+y side)', x: cx, y: r.y1, value: patch(cx - P / 2, r.y1 - P) },
    { name: 'mid-edge 4-1 (+x side)', x: r.x1, y: cy, value: patch(r.x1 - P, cy - P / 2) },
  ];
  return { die: d.name, which, xs, ys, nx: nxd, ny: nyd, smax, sxx, syy, peakInterior: peak, peakX: px, peakY: py, gpPeakInterior: gpPeak, gpPeakAll, corners, midEdges, T };
}

/** Per-bump axial and shear forces from the solder-phase stress at each site (Section 8.3). */
function bumpLoads(view, geom, dieIdx) {
  const d = geom.dies[dieIdx];
  return jointLoads(view, d, geom.zt + 0.5 * geom.so, PART.SOLDER, d.abump);
}

/**
 * Per-microbump axial and shear forces of chiplet ci of module mi from the DDI
 * microbump phase at mid-height of the DDI gap. The phase is a Cu pillar and a
 * solder cap in series, so its axial and shear stresses are those of both.
 */
function ddiLoads(view, geom, mi, ci) {
  const m = geom.modules[mi], c = m.chiplets[ci];
  const r = jointLoads(view, c, 0.5 * (m.zBaseTop + m.zDdiTop), PART.DDI_SOLDER, c.abump);
  r.module = mi; r.chiplet = ci;
  return r;
}

/** Axial and shear forces N = szz A, V = |(tyz, txz)| A at the joint sites of a bump field at height zmid in elements of a part. */
function jointLoads(view, d, zmid, part, A) {
  const mesh = view.model.mesh, T = view.T;
  const sites = dieBumpSites(d);
  const n = sites.x.length;
  const N = new Float64Array(n).fill(NaN), V = new Float64Array(n).fill(NaN), szz = new Float64Array(n).fill(NaN);
  const kb = findInterval(mesh.zs, zmid);
  const byElem = new Map();
  for (let q = 0; q < n; q++) {
    const i = findInterval(mesh.xs, sites.x[q]), j = findInterval(mesh.ys, sites.y[q]);
    const e = elementInCell(mesh, i, j, kb, part);
    if (e < 0) continue;
    if (!byElem.has(e)) byElem.set(e, []);
    byElem.get(e).push(q);
  }
  const st = { eps: new Float64Array(6), sig: new Float64Array(6) };
  for (const [e, list] of byElem) {
    for (const q of list) {
      const [xi, eta, zeta] = naturalCoords(mesh, e, sites.x[q], sites.y[q], zmid);
      view.point(e, xi, eta, zeta, st);
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
 * Die corner numbering used everywhere in the tool: corners 1 to 4 run
 * clockwise seen from the top (x right, y up), starting at the bottom-right
 * (+x, -y) corner. sx, sy are the outward signs of each corner.
 */
function dieCorners(r) {
  return [
    { n: 1, x: r.x1, y: r.y0, sx: 1, sy: -1, dir: '+x, -y' },
    { n: 2, x: r.x0, y: r.y0, sx: -1, sy: -1, dir: '-x, -y' },
    { n: 3, x: r.x0, y: r.y1, sx: -1, sy: 1, dir: '-x, +y' },
    { n: 4, x: r.x1, y: r.y1, sx: 1, sy: 1, dir: '+x, +y' },
  ];
}

/**
 * Underfill interface tractions along the die perimeter (Section 8.4): die
 * sidewall to fillet (normal = outward die normal) and die active face to
 * underfill near the edge (normal = z), from underfill-side stresses averaged
 * over 50 um x 50 um patches.
 */
function ufTractions(view, geom, dieIdx) {
  const d = geom.dies[dieIdx];
  return perimeterTractions(view, d.name, d.rect, d.zaf, [PART.UF_FILLET], PART.UF_BUMP);
}

/**
 * Wafer underfill (or, for mold-only modules, wafer mold) tractions around
 * chiplet ci of module mi: chiplet sidewall to the wCUF fillet or mold, and
 * chiplet active face to the DDI fill near the edge.
 */
function wcufTractions(view, geom, mi, ci) {
  const m = geom.modules[mi], c = m.chiplets[ci];
  const r = perimeterTractions(view, c.name, c.rect, m.zDdiTop, [PART.WCUF_FILLET, PART.MOLD], PART.DDI_FILL);
  r.module = mi; r.chiplet = ci; r.fill = geom.wcuf ? 'wcuf' : 'mold';
  return r;
}

/**
 * Tractions along the perimeter of rectangle r (clockwise from corner 1) on
 * the sidewall just outside it, from z0 up by one patch (first of sideParts
 * found in the cell), and on the face just below z0, one patch inside the edge
 * (facePart), each averaged over a TRACTION_PATCH square patch.
 */
function perimeterTractions(view, name, r, z0, sideParts, facePart) {
  const mesh = view.model.mesh, T = view.T;
  const step = CONST.TRACTION_PATCH, ns = CONST.TRACTION_SAMPLES;
  // perimeter walked clockwise from corner 1 (+x, -y): side k runs from corner k to corner k+1, outward normal (nx, ny)
  const cs = dieCorners(r);
  const edges = cs.map((c, k) => { const e = cs[(k + 1) % 4]; return { x0: c.x, y0: c.y, x1: e.x, y1: e.y, nx: c.sx === e.sx ? c.sx : 0, ny: c.sy === e.sy ? c.sy : 0 }; });
  const s = [], px = [], py = [], peelSide = [], shearSide = [], peelFace = [], shearFace = [];
  const corners = [0];
  let s0 = 0;
  const st = { eps: new Float64Array(6), sig: new Float64Array(6) };
  const sigAt = (x, y, z, part) => {
    const [i, j, k] = cellAt(mesh, x, y, z);
    const e = elementInCell(mesh, i, j, k, part);
    if (e < 0) return null;
    const [xi, eta, zeta] = naturalCoords(mesh, e, x, y, z);
    view.point(e, xi, eta, zeta, st);
    return st.sig;
  };
  const sideSig = (x, y, z) => { for (const p of sideParts) { const sg = sigAt(x, y, z, p); if (sg) return sg; } return sigAt(x, y, z, null); };
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
        // sidewall patch: just outside the edge, z from z0 up by one patch
        const zS = z0 + (b + 0.5) / ns * step;
        const sg = sideSig(xs + ed.nx * eps, ys + ed.ny * eps, zS);
        if (sg) {
          // traction t = sigma n, n = (nx, ny, 0)
          const t0 = sg[0] * ed.nx + sg[3] * ed.ny, t1 = sg[3] * ed.nx + sg[1] * ed.ny, t2 = sg[5] * ed.nx + sg[4] * ed.ny;
          const tn = t0 * ed.nx + t1 * ed.ny;
          pS += tn; vS += Math.hypot(t0 - tn * ed.nx, t1 - tn * ed.ny, t2); cS++;
        }
        // face patch: inside the edge by one patch, just below z0
        const inX = xs - ed.nx * (b + 0.5) / ns * step, inY = ys - ed.ny * (b + 0.5) / ns * step;
        const sf = sigAt(inX, inY, z0 - eps, facePart);
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
  return { die: name, s: Float64Array.from(s), x: Float64Array.from(px), y: Float64Array.from(py), peelSide: Float64Array.from(peelSide), shearSide: Float64Array.from(shearSide), peelFace: Float64Array.from(peelFace), shearFace: Float64Array.from(shearFace), corners, maxPeelSide: mx(peelSide), maxShearSide: mx(shearSide), maxPeelFace: mx(peelFace), maxShearFace: mx(shearFace), T };
}

/**
 * Traction field on side k of a die (ufTractionMap) or chiplet (wcufTractionMap),
 * unfolded at the edge: see tractionMap. depth: width of the active-face band, mm.
 */
function ufTractionMap(view, geom, dieIdx, side, depth) {
  const d = geom.dies[dieIdx];
  return tractionMap(view, d.name, d.rect, d.zaf, side, Math.min(1, geom.uf.Hf) * d.t, depth, [PART.UF_FILLET], PART.UF_BUMP);
}
function wcufTractionMap(view, geom, mi, ci, side, depth) {
  const m = geom.modules[mi], c = m.chiplets[ci];
  // the wafer underfill fillet, then the mold over it (or mold only): the sidewall interface runs up the whole chiplet
  const r = tractionMap(view, c.name, c.rect, m.zDdiTop, side, geom.stack.chipletT, depth, [PART.WCUF_FILLET, PART.MOLD], PART.DDI_FILL);
  r.module = mi; r.chiplet = ci; r.fill = geom.wcuf ? 'wcuf' : 'mold';
  return r;
}

/**
 * Traction field on side k of rectangle r (from corner k + 1 to corner k + 2 of
 * dieCorners, clockwise from corner 1), unfolded at the edge into one map: the
 * sidewall just outside the side from z0 up to z0 + hSide (first of sideParts
 * found in the cell, as perimeterTractions) and the face just below z0 from the
 * edge inward to depth (facePart, depth at most half the rectangle across the
 * side). Point values of the underfill-side stress, no patch averaging, at cell
 * centres of a grid of columns along the side (TRACTION_MAP_DS apart, at most
 * TRACTION_MAP_COLS_MAX) and TRACTION_MAP_ROWS rows through each part. For each
 * point: peel = traction normal to the interface (tension positive), along =
 * shear traction along the side (toward the side's second corner), cross =
 * shear traction across it (sidewall: upward; face: outward, toward the edge).
 * NaN where no element of the parts is found.
 */
function tractionMap(view, name, r, z0, side, hSide, depth, sideParts, facePart) {
  const mesh = view.model.mesh, cs = dieCorners(r), c0 = cs[side], c1 = cs[(side + 1) % 4];
  const L = Math.hypot(c1.x - c0.x, c1.y - c0.y), tx = (c1.x - c0.x) / L, ty = (c1.y - c0.y) / L;
  const nx = c0.sx === c1.sx ? c0.sx : 0, ny = c0.sy === c1.sy ? c0.sy : 0;
  const across = nx ? r.x1 - r.x0 : r.y1 - r.y0;
  depth = Math.min(depth, 0.5 * across);
  const m = Math.min(CONST.TRACTION_MAP_COLS_MAX, Math.max(CONST.TRACTION_MAP_COLS_MIN, Math.round(L / CONST.TRACTION_MAP_DS)));
  const nr = CONST.TRACTION_MAP_ROWS, eps = 1e-6;
  const st = { eps: new Float64Array(6), sig: new Float64Array(6) };
  const sigAt = (x, y, z, part) => {
    const [i, j, k] = cellAt(mesh, x, y, z);
    const e = elementInCell(mesh, i, j, k, part);
    if (e < 0) return null;
    const [xi, eta, zeta] = naturalCoords(mesh, e, x, y, z);
    view.point(e, xi, eta, zeta, st);
    return st.sig;
  };
  const sideSig = (x, y, z) => { for (const p of sideParts) { const sg = sigAt(x, y, z, p); if (sg) return sg; } return sigAt(x, y, z, null); };
  const mk = () => ({ peel: new Float32Array(nr * m).fill(NaN), along: new Float32Array(nr * m).fill(NaN), cross: new Float32Array(nr * m).fill(NaN) });
  const wall = mk(), face = mk(), s = new Float64Array(m), vWall = new Float64Array(nr), vFace = new Float64Array(nr);
  for (let b = 0; b < nr; b++) { vWall[b] = (b + 0.5) / nr * hSide; vFace[b] = (b + 0.5) / nr * depth; }
  for (let p = 0; p < m; p++) {
    const sc = s[p] = (p + 0.5) * L / m, x = c0.x + tx * sc, y = c0.y + ty * sc;
    for (let b = 0; b < nr; b++) {
      const o = b * m + p;
      // sidewall: traction t = sigma n, n = (nx, ny, 0)
      const sg = sideSig(x + nx * eps, y + ny * eps, z0 + vWall[b]);
      if (sg) {
        const t0 = sg[0] * nx + sg[3] * ny, t1 = sg[3] * nx + sg[1] * ny, t2 = sg[5] * nx + sg[4] * ny;
        wall.peel[o] = t0 * nx + t1 * ny; wall.along[o] = t0 * tx + t1 * ty; wall.cross[o] = t2;
      }
      // active face: traction on the plane z = z0 from the stress just below it, t = (txz, tyz, szz)
      const sf = sigAt(x - nx * vFace[b], y - ny * vFace[b], z0 - eps, facePart);
      if (sf) { face.peel[o] = sf[2]; face.along[o] = sf[5] * tx + sf[4] * ty; face.cross[o] = sf[5] * nx + sf[4] * ny; }
    }
  }
  return { name, side, from: c0.n, to: c1.n, L, hSide, depth, m, nr, s, vWall, vFace, wall, face, T: view.T };
}

/**
 * Stress in one sub-layer of a layered substrate element at (xi, eta, zeta),
 * recovered as in laminate theory: the in-plane strains are the element's, while
 * the out-of-plane stresses (szz, tyz, txz) are continuous through the band and
 * equal to their thickness average over the sub-layers. The layered integration
 * gives every sub-layer the element's out-of-plane strain (iso-strain), which is
 * right for the band's stiffness but not for one sub-layer's stress (a thin soft
 * layer would show the szz of its stiff neighbours). With sigma_V the iso-strain
 * stress of the sub-layer and o = (zz, yz, xz), p = (xx, yy, xy):
 * d_eps_o = D_oo^-1 (sigma_o,avg - sigma_V,o), sigma_p = sigma_V,p + D_po d_eps_o.
 */
function layeredPointStress(view, e, xi, eta, zeta, st) {
  const model = view.model, mesh = model.mesh, k = mesh.eIJK[3 * e + 2];
  const sec = model.sectionOf(e), z0 = mesh.zs[k], hz = mesh.zs[k + 1] - z0;
  const O = [2, 4, 5], Pp = [0, 1, 3];
  const avg = [0, 0, 0];
  for (const [za, zb] of sec.subZ) {
    view.point(e, xi, eta, (za + zb - 2 * z0) / hz - 1, st);
    for (let r = 0; r < 3; r++) avg[r] += (zb - za) / hz * st.sig[O[r]];
  }
  view.point(e, xi, eta, zeta, st);
  // tangent stiffness of the sub-layer at the point, at the view temperature
  const D = sectionSubD(sec, model.subLayerAt(e, zeta), view.T), Doo = new Float64Array(9), inv = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Doo[3 * r + c] = D[6 * O[r] + O[c]];
  inv3(Doo, inv);
  const r0 = avg[0] - st.sig[2], r1 = avg[1] - st.sig[4], r2 = avg[2] - st.sig[5];
  const de = [inv[0] * r0 + inv[1] * r1 + inv[2] * r2, inv[3] * r0 + inv[4] * r1 + inv[5] * r2, inv[6] * r0 + inv[7] * r1 + inv[8] * r2];
  for (const p of Pp) st.sig[p] += D[6 * p + 2] * de[0] + D[6 * p + 4] * de[1] + D[6 * p + 5] * de[2];
  for (let r = 0; r < 3; r++) st.sig[O[r]] = avg[r];
  return st;
}

/**
 * Stress on the vertical cut plane under a horizontal (cut.axis 'x') or
 * vertical (cut.axis 'y') floorplan line from cut.a0 to cut.a1 at the
 * crossing coordinate cut.c, from the bottom of the top solder resist up to
 * the package top. Recovery follows Section 7.1: in every element the plane
 * cuts, the stress is sampled at the 2 x 2 Gauss positions of the cut face
 * (at the plane's position across the element) and extrapolated bilinearly
 * to the face corners; corner values are averaged only among elements of the
 * same group (material), never across interfaces. In the layered substrate
 * band only the solder resist sub-layer is sampled (layeredPointStress).
 * Superposed bump-layer cells give one quad per phase (pair = 1). Partly filled
 * fillet cells carry the wedge surface height at both ends (topA, topB).
 * Quad corners run (s0, z0), (s1, z0), (s1, z1), (s0, z1); sig holds the six
 * components xx, yy, zz, xy, yz, xz per corner.
 */
function sectionStress(view, geom, cut) {
  const model = view.model, mesh = model.mesh, T = view.T;
  const alongY = cut.axis === 'y';
  const along = alongY ? mesh.ys : mesh.xs, across = alongY ? mesh.xs : mesh.ys;
  const lo = Math.max(Math.min(cut.a0, cut.a1), along[0]), hi = Math.min(Math.max(cut.a0, cut.a1), along[along.length - 1]);
  if (!(hi - lo > CONST.SECTION_MIN_LENGTH)) throw new Error('The section line has no length inside the substrate.');
  const c = clamp(cut.c, across[0], across[across.length - 1]);
  const jc = findInterval(across, c);
  const pc = clamp(2 * (c - across[jc]) / (across[jc + 1] - across[jc]) - 1, -1, 1);
  const sl = [lo];
  for (const v of along) if (v > lo + 1e-9 && v < hi - 1e-9) sl.push(v);
  sl.push(hi);
  const topRow = geom.sub.rows[geom.sub.rows.length - 1];
  const zMin = topRow && topRow.row.type === 'sr' ? topRow.z0 : geom.zt;
  const zl = [zMin];
  for (const v of mesh.zs) if (v > zMin + 1e-9) zl.push(v);
  const ns = sl.length, nzl = zl.length, nn = ns * nzl, ng = model.groups.length;
  const acc = new Float64Array(ng * nn * 7);
  const quads = [];
  const st = { eps: new Float64Array(6), sig: new Float64Array(6) };
  const gp = new Float64Array(24), g = GP2;
  const ncy = mesh.ny - 1, ncz = mesh.nz - 1;
  for (let b = 0; b + 1 < nzl; b++) {
    const k = findInterval(mesh.zs, 0.5 * (zl[b] + zl[b + 1]));
    const hz = mesh.zs[k + 1] - mesh.zs[k];
    const zeta = z => 2 * (z - mesh.zs[k]) / hz - 1;
    for (let a = 0; a + 1 < ns; a++) {
      const ia = findInterval(along, 0.5 * (sl[a] + sl[a + 1]));
      const ha = along[ia + 1] - along[ia];
      const nat = s => 2 * (s - along[ia]) / ha - 1;
      const i = alongY ? jc : ia, j = alongY ? ia : jc;
      const cell = (i * ncy + j) * ncz + k;
      const e0 = mesh.cellElems[2 * cell], e1 = mesh.cellElems[2 * cell + 1];
      for (const e of [e0, e1]) {
        if (e < 0) continue;
        const grp = mesh.eGroup[e], layered = model.groups[grp].kind === 'layered';
        // sampled face: the whole element, or the solder resist sub-layer of a layered element
        const zm = layered ? 0.5 * (zeta(zl[b]) + zeta(zl[b + 1])) : 0, zh = layered ? 0.5 * (zeta(zl[b + 1]) - zeta(zl[b])) : 1;
        for (let pp = 0; pp < 2; pp++) for (let zz = 0; zz < 2; zz++) {
          const p = (2 * pp - 1) * g, zt = zm + (2 * zz - 1) * g * zh;
          if (layered) layeredPointStress(view, e, alongY ? pc : p, alongY ? p : pc, zt, st);
          else view.point(e, alongY ? pc : p, alongY ? p : pc, zt, st);
          gp.set(st.sig, 6 * (2 * pp + zz));
        }
        const corners = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]];
        corners.forEach(([ca, cb]) => {
          // bilinear through the Gauss values, in coordinates scaled so the Gauss points sit at -1 and +1
          const P = nat(sl[ca]) / g, Z = (zeta(zl[cb]) - zm) / (g * zh);
          const w = [(1 - P) * (1 - Z) / 4, (1 - P) * (1 + Z) / 4, (1 + P) * (1 - Z) / 4, (1 + P) * (1 + Z) / 4];
          const o = (grp * nn + ca * nzl + cb) * 7;
          for (let cc = 0; cc < 6; cc++) {
            acc[o + cc] += w[0] * gp[cc] + w[1] * gp[6 + cc] + w[2] * gp[12 + cc] + w[3] * gp[18 + cc];
          }
          acc[o + 6]++;
        });
        quads.push({ a, b, e, grp, part: mesh.ePart[e], pair: e0 >= 0 && e1 >= 0 ? 1 : 0, cutBelow: zl[b] > mesh.zs[k] + 1e-12 ? 1 : 0 });
      }
    }
  }
  const n = quads.length, sig = new Float32Array(24 * n);
  const out = { T, axis: alongY ? 'y' : 'x', c, a0: lo, a1: hi, zMin, zTop: zl[nzl - 1], zt: geom.zt, sl: Float64Array.from(sl), zl: Float64Array.from(zl), n,
    qa: new Int32Array(n), qb: new Int32Array(n), part: new Int8Array(n), grp: new Int16Array(n), pair: new Int8Array(n), cutBelow: new Int8Array(n), sig };
  quads.forEach((Q, t) => {
    out.qa[t] = Q.a; out.qb[t] = Q.b; out.part[t] = Q.part; out.grp[t] = Q.grp; out.pair[t] = Q.pair; out.cutBelow[t] = Q.cutBelow;
    [[Q.a, Q.b], [Q.a + 1, Q.b], [Q.a + 1, Q.b + 1], [Q.a, Q.b + 1]].forEach(([ca, cb], v) => {
      const o = (Q.grp * nn + ca * nzl + cb) * 7;
      for (let cc = 0; cc < 6; cc++) sig[24 * t + 6 * v + cc] = acc[o + cc] / acc[o + 6];
    });
  });
  // fillet cells above the active face are partly filled (stiffness scaled by the filled fraction): the
  // wedge surface z at both ends of each such quad, so the plot can clip the cell to the fillet
  out.topA = new Float32Array(n).fill(NaN); out.topB = new Float32Array(n).fill(NaN);
  const surf = s => geom.zaf + filletHeight(geom, alongY ? c : s, alongY ? s : c).h;
  // wafer underfill fillets of stacked modules: the wedge above the chiplet bottom (the mold fills the rest of the cell)
  const surfW = s => { const x = alongY ? c : s, y = alongY ? s : c, m = dieAt(geom, x, y); return m && m.kind === 'module' ? m.zDdiTop + wcufHeight(geom, m, x, y).h : NaN; };
  quads.forEach((Q, t) => {
    if (Q.part === PART.WCUF_FILLET) {
      const m = dieAt(geom, alongY ? c : 0.5 * (sl[Q.a] + sl[Q.a + 1]), alongY ? 0.5 * (sl[Q.a] + sl[Q.a + 1]) : c);
      if (m && m.kind === 'module' && zl[Q.b] >= m.zDdiTop - 1e-9) { out.topA[t] = surfW(sl[Q.a]); out.topB[t] = surfW(sl[Q.a + 1]); }
      return;
    }
    if (Q.part !== PART.UF_FILLET || zl[Q.b] < geom.zaf - 1e-9) return;
    out.topA[t] = surf(sl[Q.a]); out.topB[t] = surf(sl[Q.a + 1]);
  });
  const lib = model.lib;
  out.groups = model.groups.map(gr => ({ name: gr.name, part: gr.part,
    material: gr.kind === 'layered' ? (gr.part === PART.RDL ? 'RDL stack' : (topRow && topRow.row.type === 'sr' ? findMaterial(lib, topRow.row.mat).name : '')) : (gr.material ? gr.material.name : '') }));
  return out;
}

/**
 * Surface quads of every part for the 3D view: [n0 n1 n2 n3] per face plus part id.
 * A face is drawn where the cell faces a void cell or a cell of another part, so each
 * part is a closed surface and hiding one part shows the faces of the parts it covered.
 */
function boundaryFaces(mesh) {
  const nx = mesh.nx, ny = mesh.ny, nz = mesh.nz, ncy = ny - 1, ncz = nz - 1;
  const faces = [], parts = [], elems = [];
  const partOf = (i, j, k) => { if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ncy || k >= ncz) return -1; const e = mesh.cellElems[2 * ((i * ncy + j) * ncz + k)]; return e < 0 ? -1 : mesh.ePart[e]; };
  const nid = (i, j, k) => mesh.nodeId[(i * ny + j) * nz + k];
  const dirs = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  for (let e = 0; e < mesh.ne; e++) {
    const i = mesh.eIJK[3 * e], j = mesh.eIJK[3 * e + 1], k = mesh.eIJK[3 * e + 2];
    // superposed pair: only the first element of the cell draws faces
    const c = (i * ncy + j) * ncz + k;
    if (mesh.cellElems[2 * c] !== e) continue;
    for (let dd = 0; dd < 6; dd++) {
      const [di, dj, dk] = dirs[dd];
      if (partOf(i + di, j + dj, k + dk) === mesh.ePart[e]) continue;
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
function faceStressField(view, faces) {
  const mesh = view.model.mesh;
  const sum = new Map(); // key part*nn + node -> [sum, count]
  const gp = new Float64Array(48), st = { eps: new Float64Array(6), sig: new Float64Array(6) };
  const tens = new Float64Array(6);
  const touched = new Set(Array.from(faces.elem));
  for (const e of touched) {
    for (let g = 0; g < 8; g++) { view.point(e, HEX_XI[g] * GP2, HEX_ETA[g] * GP2, HEX_ZETA[g] * GP2, st); gp.set(st.sig, 6 * g); }
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
