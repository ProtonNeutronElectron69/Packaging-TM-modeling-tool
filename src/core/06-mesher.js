// ===== Structured extruded hexahedral mesher (Section 5) ==================

const PART = Object.freeze({ SUB: 0, SOLDER: 1, UF_BUMP: 2, UF_FILLET: 3, DIE: 4, TIM: 5, LID: 6, LIDADH: 7, STIFF: 8, STIFFADH: 9 });
const PART_NAMES = ['Substrate', 'Solder bumps', 'Underfill (bump layer)', 'Underfill fillet', 'Die', 'TIM1', 'Lid', 'Lid adhesive', 'Stiffener', 'Stiffener adhesive'];

/**
 * Generic structured mesh from grid lines xs, ys and planes zs. assign(i, j, k)
 * returns the elements of cell (i, j, k): [{group, scale, part}] (empty = void;
 * two entries = superposed phases sharing nodes). Nodes exist only where
 * attached to an element and are numbered z fastest, then y, then x.
 */
function buildStructuredMesh(xs, ys, zs, groups, assign) {
  const nx = xs.length, ny = ys.length, nz = zs.length;
  const ncy = ny - 1, ncz = nz - 1;
  const ncells = (nx - 1) * ncy * ncz;
  const eGroup = [], ePart = [], eScale = [], eCell = [];
  const cellElems = new Int32Array(ncells * 2).fill(-1);
  const exist = new Uint8Array(nx * ny * nz);
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < ncy; j++) {
      for (let k = 0; k < ncz; k++) {
        const list = assign(i, j, k);
        if (!list || !list.length) continue;
        const c = (i * ncy + j) * ncz + k;
        for (let q = 0; q < list.length; q++) {
          const it = list[q];
          cellElems[c * 2 + q] = eGroup.length;
          eGroup.push(it.group); ePart.push(it.part); eScale.push(it.scale); eCell.push(c);
        }
        for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) for (let dk = 0; dk < 2; dk++) exist[((i + di) * ny + j + dj) * nz + k + dk] = 1;
      }
    }
  }
  const nodeId = new Int32Array(nx * ny * nz).fill(-1);
  let nn = 0;
  for (let q = 0; q < exist.length; q++) if (exist[q]) nodeId[q] = nn++;
  const coords = new Float64Array(nn * 3), nodeIJK = new Int32Array(nn * 3);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const id = nodeId[(i * ny + j) * nz + k];
    if (id < 0) continue;
    coords[3 * id] = xs[i]; coords[3 * id + 1] = ys[j]; coords[3 * id + 2] = zs[k];
    nodeIJK[3 * id] = i; nodeIJK[3 * id + 1] = j; nodeIJK[3 * id + 2] = k;
  }
  const ne = eGroup.length;
  const conn = new Int32Array(ne * 8);
  const eIJK = new Int32Array(ne * 3);
  const loc = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  for (let e = 0; e < ne; e++) {
    const c = eCell[e];
    const k = c % ncz, j = Math.floor(c / ncz) % ncy, i = Math.floor(c / (ncz * ncy));
    eIJK[3 * e] = i; eIJK[3 * e + 1] = j; eIJK[3 * e + 2] = k;
    for (let a = 0; a < 8; a++) conn[8 * e + a] = nodeId[((i + loc[a][0]) * ny + j + loc[a][1]) * nz + k + loc[a][2]];
  }
  // column starts (column c = i * ny + j holds a contiguous node range)
  const colStart = new Int32Array(nx * ny + 1);
  {
    let cnt = 0;
    for (let c = 0; c < nx * ny; c++) {
      colStart[c] = cnt;
      for (let k = 0; k < nz; k++) if (nodeId[c * nz + k] >= 0) cnt++;
    }
    colStart[nx * ny] = cnt;
  }
  return {
    xs: Float64Array.from(xs), ys: Float64Array.from(ys), zs: Float64Array.from(zs), nx, ny, nz,
    nn, ne, coords, nodeIJK, nodeId, conn, eIJK, colStart, cellElems,
    eGroup: Int32Array.from(eGroup), ePart: Int8Array.from(ePart), eScale: Float64Array.from(eScale),
    groups,
  };
}

/** Nearest existing node on plane k to (x, y). */
function nearestNodeOnPlane(mesh, x, y, k) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < mesh.nx; i++) for (let j = 0; j < mesh.ny; j++) {
    const id = mesh.nodeId[(i * mesh.ny + j) * mesh.nz + k];
    if (id < 0) continue;
    const d = Math.hypot(mesh.xs[i] - x, mesh.ys[j] - y);
    if (d < bd - 1e-12) { bd = d; best = id; }
  }
  return best;
}

/** 3-2-1 rigid-body constraints on bottom nodes (Section 5.6). */
function constraints321(mesh, a) {
  const k = 0;
  const n0 = nearestNodeOnPlane(mesh, 0, 0, k), n1 = nearestNodeOnPlane(mesh, a, 0, k), n2 = nearestNodeOnPlane(mesh, 0, a, k);
  return { nodes: [n0, n1, n2], dofs: Int32Array.from([3 * n0, 3 * n0 + 1, 3 * n0 + 2, 3 * n1 + 1, 3 * n1 + 2, 3 * n2 + 2]) };
}

// ---- in-plane grid -------------------------------------------------------------

/** Merge feature lines closer than tol, keeping the higher-priority value. */
function mergeFeatures(feats, tol) {
  feats.sort((a, b) => a.v - b.v);
  const out = [], snapped = [];
  for (const f of feats) {
    const last = out[out.length - 1];
    if (last && f.v - last.v < tol) {
      if (f.v - last.v > 1e-12) snapped.push({ a: last.label, b: f.label, d: f.v - last.v });
      if (f.prio > last.prio) { last.v = f.v; last.label = f.label; last.prio = f.prio; }
      continue;
    }
    out.push(Object.assign({}, f));
  }
  return { lines: out.map(f => f.v), labels: out.map(f => f.label), snapped };
}

/**
 * Subdivide [lo, hi] between merged feature lines with the size function
 * s(x) = min(hmax, min over die edges of hmin + (r - 1) max(0, |x - e| - 2 t))
 * (geometric growth at ratio r, Section 5.2) and per-interval minimum counts.
 */
function gridLines(lines, edges, hmin, hmax, spans) {
  const r = CONST.GROWTH_RATIO_MAX;
  const size = x => {
    let s = hmax;
    for (const e of edges) s = Math.min(s, hmin + (r - 1) * Math.max(0, Math.abs(x - e.v) - CONST.REFINE_ZONE_FACTOR * e.t));
    return Math.max(s, 1e-6);
  };
  // minimum element count per interval from ring spans
  const nmin = new Int32Array(lines.length - 1).fill(1);
  for (const sp of spans) {
    const ids = [];
    for (let q = 0; q + 1 < lines.length; q++) if (lines[q] >= sp.a - 1e-9 && lines[q + 1] <= sp.b + 1e-9) ids.push(q);
    if (!ids.length) continue;
    const need = Math.ceil(CONST.MIN_ELEMS_ACROSS_RING / ids.length);
    for (const q of ids) nmin[q] = Math.max(nmin[q], need);
  }
  const out = [lines[0]];
  const M = CONST.SIZE_SAMPLES;
  const cum = new Float64Array(M + 1);
  for (let q = 0; q + 1 < lines.length; q++) {
    const a = lines[q], b = lines[q + 1], L = b - a;
    cum[0] = 0;
    let prev = 1 / size(a);
    for (let m = 1; m <= M; m++) {
      const x = m === M ? b : a + L * m / M;
      const cur = 1 / size(x);
      cum[m] = cum[m - 1] + 0.5 * (prev + cur) * L / M;
      prev = cur;
    }
    const I = cum[M];
    const n = Math.max(nmin[q], Math.ceil(I - 1e-6), 1);
    let m = 0;
    for (let p = 1; p < n; p++) {
      const target = I * p / n;
      while (m < M && cum[m + 1] < target) m++;
      const t = (target - cum[m]) / Math.max(cum[m + 1] - cum[m], 1e-300);
      out.push(a + L * (m + t) / M);
    }
    out.push(b);
  }
  return out;
}

/** Feature lines and refinement data along one axis ('x' or 'y'). */
function axisFeatures(g, axis) {
  const lo = axis === 'x' ? g.substrate.x0 : g.substrate.y0, hi = axis === 'x' ? g.substrate.x1 : g.substrate.y1;
  const k0 = axis === 'x' ? 'x0' : 'y0', k1 = axis === 'x' ? 'x1' : 'y1';
  const feats = [{ v: lo, prio: 3, label: 'substrate edge' }, { v: hi, prio: 3, label: 'substrate edge' }];
  const edges = [], spans = [];
  const add = (v, prio, label) => { if (v > lo + 1e-12 && v < hi - 1e-12) feats.push({ v, prio, label }); };
  for (const d of g.dies) {
    add(d.rect[k0], 2, d.name + ' edge'); add(d.rect[k1], 2, d.name + ' edge');
    edges.push({ v: d.rect[k0], t: d.t }, { v: d.rect[k1], t: d.t });
    const fa = d.rect[k0] - g.uf.Wf, fb = d.rect[k1] + g.uf.Wf;
    add(fa, 1, d.name + ' fillet'); add(fb, 1, d.name + ' fillet');
    spans.push({ a: Math.max(lo, fa), b: d.rect[k0] }, { a: d.rect[k1], b: Math.min(hi, fb) });
    if (d.field) { add(d.field[k0], 1, d.name + ' bump field'); add(d.field[k1], 1, d.name + ' bump field'); }
    if (d.inner) { add(d.inner[k0], 1, d.name + ' bump ring'); add(d.inner[k1], 1, d.name + ' bump ring'); }
  }
  const ring = g.lid || g.stiff;
  if (ring) {
    const what = g.lid ? 'lid' : 'stiffener';
    add(ring.outer[k0], 2, what + ' outer'); add(ring.outer[k1], 2, what + ' outer');
    add(ring.inner[k0], 2, what + ' inner'); add(ring.inner[k1], 2, what + ' inner');
    spans.push({ a: ring.outer[k0], b: ring.inner[k0] }, { a: ring.inner[k1], b: ring.outer[k1] });
  }
  return { feats, edges, spans };
}

// ---- z planes ---------------------------------------------------------------------

/** Global z planes, element-layer subdivision and band bookkeeping (Section 5.3). */
function zPlanes(g) {
  const pl = [];
  const add = (z, label, prio) => pl.push({ v: z, label, prio: prio || 1 });
  g.sub.planes.forEach((z, i) => add(z, i === 0 ? 'substrate bottom' : (i === g.sub.planes.length - 1 ? 'substrate top' : 'substrate band'), 3));
  add(g.zaf, 'die active face', 2);
  for (const d of g.dies) {
    add(d.ztop, d.name + ' top', 2);
    if (g.uf.Hf > 0 && g.uf.Hf < 1) add(g.zaf + g.uf.Hf * d.t, d.name + ' fillet top', 1);
  }
  if (g.lid) { add(g.lid.zAdhTop, 'lid adhesive top', 2); add(g.lid.zLidBot, 'lid underside', 2); add(g.lid.zLidTop, 'lid top', 2); }
  if (g.stiff) { add(g.stiff.zAdhTop, 'stiffener adhesive top', 2); add(g.stiff.zTop, 'stiffener top', 2); }
  const merged = mergeFeatures(pl, CONST.PLANE_MERGE_TOL);
  const base = merged.lines;
  // subdivision per band
  const nsub = [];
  for (let b = 0; b + 1 < base.length; b++) {
    const za = base[b], zb = base[b + 1], zc = 0.5 * (za + zb);
    let n = 1;
    if (zb <= g.zt + 1e-9) n = 1;
    else {
      let tDie = Infinity;
      for (const d of g.dies) if (zc > g.zaf && zc < d.ztop) tDie = Math.min(tDie, d.t);
      if (isFinite(tDie)) n = (zb - za) < CONST.SLIVER_FRACTION * tDie ? 1 : 2;
      if (g.lid && zc > g.lid.zLidBot && zc < g.lid.zLidTop) n = 2;
    }
    nsub.push(n);
  }
  // at least DIE_MIN_LAYERS element layers through every die
  for (const d of g.dies) {
    for (let guard = 0; guard < 20; guard++) {
      let total = 0, thick = -1, tb = 0;
      for (let b = 0; b + 1 < base.length; b++) {
        const zc = 0.5 * (base[b] + base[b + 1]);
        if (zc > g.zaf && zc < d.ztop) { total += nsub[b]; if (base[b + 1] - base[b] > tb) { tb = base[b + 1] - base[b]; thick = b; } }
      }
      if (total >= CONST.DIE_MIN_LAYERS || thick < 0) break;
      nsub[thick]++;
    }
  }
  const zs = [base[0]], band = [];
  for (let b = 0; b + 1 < base.length; b++) {
    for (let s = 1; s <= nsub[b]; s++) { zs.push(base[b] + (base[b + 1] - base[b]) * s / nsub[b]); band.push(b); }
  }
  return { zs, layerBand: band, basePlanes: base, baseLabels: merged.labels, snapped: merged.snapped };
}

// ---- package mesh -----------------------------------------------------------------

/** Assembly groups (material, birth stage, part) of a package. */
function packageGroups(cfg, g) {
  const groups = [];
  const add = (key, o) => { o.key = key; o.index = groups.length; groups.push(o); return o.index; };
  const G = {};
  G.sub = add('sub', { name: 'Substrate', kind: 'layered', stage: 0, part: PART.SUB });
  G.solder = add('solder', { name: 'Solder phase', kind: 'homog', mat: cfg.bump.solder, stage: 1, part: PART.SOLDER });
  G.uf = add('uf', { name: 'Underfill', kind: 'homog', mat: cfg.underfill.mat, stage: 2, part: PART.UF_BUMP });
  G.die = g.dies.map((d, i) => add('die' + i, { name: d.name, kind: 'homog', mat: 'si', siModel: d.si, stage: 1, part: PART.DIE, die: i }));
  if (g.lid) {
    G.tim = add('tim', { name: 'TIM1', kind: 'homog', mat: cfg.lid.timMat, stage: 3, part: PART.TIM });
    G.lid = add('lid', { name: 'Lid', kind: 'homog', mat: cfg.lid.mat, stage: 3, part: PART.LID });
    G.lidadh = add('lidadh', { name: 'Lid adhesive', kind: 'homog', mat: cfg.lid.adhMat, stage: 3, part: PART.LIDADH });
  }
  if (g.stiff) {
    G.stiff = add('stiff', { name: 'Stiffener', kind: 'homog', mat: cfg.stiffener.mat, stage: 3, part: PART.STIFF });
    G.stiffadh = add('stiffadh', { name: 'Stiffener adhesive', kind: 'homog', mat: cfg.stiffener.adhMat, stage: 3, part: PART.STIFFADH });
  }
  return { groups, G };
}

/**
 * Cell material assignment for the package (Section 5.4).
 * Column descriptor: die under the centroid, bump fraction, fillet height,
 * lid / stiffener footprints.
 */
function makePackageAssign(g, xs, ys, zs, G, layerBand) {
  const ncy = ys.length - 1;
  const colCache = new Map();
  const column = (i, j) => {
    const key = i * ncy + j;
    let c = colCache.get(key);
    if (c) return c;
    const xc = 0.5 * (xs[i] + xs[i + 1]), yc = 0.5 * (ys[j] + ys[j + 1]);
    const cell = { x0: xs[i], x1: xs[i + 1], y0: ys[j], y1: ys[j + 1] };
    const die = dieAt(g, xc, yc);
    c = { die, fb: die ? cellBumpFraction(die, cell) : 0, fil: die ? null : filletHeight(g, xc, yc) };
    if (g.lid) {
      c.lidOuter = pointInRect(g.lid.outer, xc, yc);
      c.lidFoot = c.lidOuter && !pointInRect(g.lid.inner, xc, yc);
    }
    if (g.stiff) c.ring = pointInRect(g.stiff.outer, xc, yc) && !pointInRect(g.stiff.inner, xc, yc);
    colCache.set(key, c);
    return c;
  };
  return (i, j, k) => {
    const zc = 0.5 * (zs[k] + zs[k + 1]);
    if (zc < g.zt) return [{ group: G.sub, scale: 1, part: PART.SUB }];
    const c = column(i, j);
    const lid = g.lid;
    if (lid && zc > lid.zLidBot && zc < lid.zLidTop && c.lidOuter) return [{ group: G.lid, scale: 1, part: PART.LID }];
    if (c.die) {
      const d = c.die;
      if (zc < g.zaf) {
        if (c.fb > 1e-12) return [{ group: G.solder, scale: c.fb, part: PART.SOLDER }, { group: G.uf, scale: 1 - c.fb, part: PART.UF_BUMP }];
        return [{ group: G.uf, scale: 1, part: PART.UF_BUMP }];
      }
      if (zc < d.ztop) return [{ group: G.die[d.index], scale: 1, part: PART.DIE }];
      if (lid && zc < lid.zLidBot) return [{ group: G.tim, scale: 1, part: PART.TIM }];
      return [];
    }
    if (lid && c.lidFoot) {
      if (zc < lid.zAdhTop) return [{ group: G.lidadh, scale: 1, part: PART.LIDADH }];
      if (zc < lid.zLidBot) return [{ group: G.lid, scale: 1, part: PART.LID }];
      return [];
    }
    if (g.stiff && c.ring) {
      if (zc < g.stiff.zAdhTop) return [{ group: G.stiffadh, scale: 1, part: PART.STIFFADH }];
      if (zc < g.stiff.zTop) return [{ group: G.stiff, scale: 1, part: PART.STIFF }];
      return [];
    }
    if (c.fil && c.fil.inFootprint) {
      if (zc < g.zaf || zc < g.zaf + c.fil.h) return [{ group: G.uf, scale: 1, part: PART.UF_FILLET }];
    }
    return [];
  };
}

function presetParams(cfg, override) {
  const p = Object.assign({}, CONST.MESH_PRESETS[(override && override.preset) || cfg.mesh.preset || 'standard']);
  if (override) for (const k of ['hmin', 'hmax', 'cap']) if (override[k] != null) p[k] = override[k];
  return p;
}

/**
 * Build the package mesh at a fidelity preset, enlarging h_min and h_max
 * proportionally until the DOF estimate is under the cap (Section 5.2).
 */
function buildPackageMesh(cfg, override) {
  const t0 = nowMs();
  const g = deriveGeometry(cfg);
  const pre = presetParams(cfg, override);
  const fx = axisFeatures(g, 'x'), fy = axisFeatures(g, 'y');
  const mx = mergeFeatures(fx.feats, CONST.FEATURE_SNAP_TOL), my = mergeFeatures(fy.feats, CONST.FEATURE_SNAP_TOL);
  const zp = zPlanes(g);
  const { groups, G } = packageGroups(cfg, g);
  let hmin = pre.hmin, hmax = pre.hmax, mesh = null, scaled = false;
  for (let it = 0; it < CONST.CAP_MAX_ITER; it++) {
    const xs = gridLines(mx.lines, fx.edges, hmin, hmax, fx.spans);
    const ys = gridLines(my.lines, fy.edges, hmin, hmax, fy.spans);
    const assign = makePackageAssign(g, xs, ys, zp.zs, G, zp.layerBand);
    mesh = buildStructuredMesh(xs, ys, zp.zs, groups, assign);
    const dof = 3 * mesh.nn;
    if (dof <= pre.cap || override && override.noCap) break;
    const f = Math.sqrt(dof / pre.cap) * CONST.CAP_GROWTH_PAD;
    hmin *= f; hmax *= f; scaled = true;
  }
  mesh.layerBand = Int32Array.from(zp.layerBand);
  mesh.subBand = new Int32Array(zp.zs.length - 1).fill(-1);
  for (let k = 0; k + 1 < zp.zs.length; k++) {
    const zc = 0.5 * (zp.zs[k] + zp.zs[k + 1]);
    for (let b = 0; b < g.sub.bands.length; b++) if (zc > g.sub.bands[b].z0 && zc < g.sub.bands[b].z1) mesh.subBand[k] = b;
  }
  mesh.G = G;
  mesh.geom = g;
  mesh.constraints = constraints321(mesh, CONST.CONSTRAINT_SPAN * Math.min(g.substrate.x1, g.substrate.y1));
  // quality statistics
  let amax = 0, nwarn = 0;
  for (let e = 0; e < mesh.ne; e++) {
    const i = mesh.eIJK[3 * e], j = mesh.eIJK[3 * e + 1], k = mesh.eIJK[3 * e + 2];
    const hx = mesh.xs[i + 1] - mesh.xs[i], hy = mesh.ys[j + 1] - mesh.ys[j], hz = mesh.zs[k + 1] - mesh.zs[k];
    const a = Math.max(hx, hy, hz) / Math.min(hx, hy, hz);
    if (a > amax) amax = a;
    if (a > CONST.ASPECT_WARN) nwarn++;
  }
  mesh.info = {
    preset: pre.label, hmin, hmax, hminPreset: pre.hmin, hmaxPreset: pre.hmax, cap: pre.cap, scaled,
    snappedX: mx.snapped, snappedY: my.snapped, snappedZ: zp.snapped,
    nx: mesh.nx, ny: mesh.ny, nz: mesh.nz, nNodes: mesh.nn, nElem: mesh.ne, nDof: 3 * mesh.nn,
    aspectMax: amax, nAspectWarn: nwarn, planeLabels: zp.baseLabels, basePlanes: zp.basePlanes,
    buildMs: nowMs() - t0,
  };
  return mesh;
}

/** Mesh-dependent warnings appended to the validation list. */
function meshWarnings(mesh) {
  const w = [];
  const inf = mesh.info;
  if (inf.nAspectWarn > 0) w.push({ level: 'warning', text: inf.nAspectWarn + ' elements have aspect ratio above ' + CONST.ASPECT_WARN + ' (max ' + inf.aspectMax.toFixed(0) + '); thin layers are handled by the incompatible-mode element but check mesh sensitivity.' });
  if (inf.nDof > inf.cap) w.push({ level: 'warning', text: 'DOF ' + inf.nDof + ' above the ' + inf.preset + ' cap ' + inf.cap + '.' });
  if (inf.scaled) w.push({ level: 'info', text: 'Mesh sizes enlarged to h_min ' + inf.hmin.toFixed(3) + ' mm and h_max ' + inf.hmax.toFixed(3) + ' mm to stay under the ' + inf.preset + ' DOF cap.' });
  const sn = inf.snappedX.concat(inf.snappedY);
  if (sn.length) w.push({ level: 'info', text: sn.length + ' in-plane feature lines closer than 10 µm were merged (' + sn.slice(0, 3).map(s => s.a + ' / ' + s.b).join('; ') + (sn.length > 3 ? '; ...' : '') + ').' });
  return w;
}
