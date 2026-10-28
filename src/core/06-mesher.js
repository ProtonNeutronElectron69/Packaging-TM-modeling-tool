// ===== Structured extruded hexahedral mesher (Section 5) ==================

const PART = Object.freeze({ SUB: 0, SOLDER: 1, UF_BUMP: 2, UF_FILLET: 3, DIE: 4, TIM: 5, LID: 6, LIDADH: 7, STIFF: 8, STIFFADH: 9,
  CHIPLET: 10, BASE_SI: 11, TSV: 12, RDL: 13, DDI_SOLDER: 14, DDI_FILL: 15, WCUF_FILLET: 16, MOLD: 17 });
const PART_NAMES = ['Substrate', 'Solder bumps', 'Underfill (bump layer)', 'Underfill fillet', 'Die', 'TIM1', 'Lid', 'Lid adhesive', 'Stiffener', 'Stiffener adhesive',
  'Chiplets', 'Si base die / interposer', 'TSV Cu', 'RDL interposer', 'DDI microbumps', 'DDI fill (wCUF or mold)', 'Wafer underfill fillet', 'Wafer mold'];

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

/**
 * Three support nodes of a stacked module on its base bottom (plane k), all inside its footprint: n0 nearest the
 * centre, n1 the farthest from n0 along the same grid row (with uy and uz held, it stops the rotations about z and y),
 * n2 the farthest from that row (uz held: the rotation about x). Points picked by distance alone can coincide on a
 * coarse grid and leave a rotation free. Returns null when the footprint has too few nodes.
 */
function moduleSupport(mesh, r, cx, cy, k) {
  const tol = 1e-9, cand = [];
  for (let i = 0; i < mesh.nx; i++) {
    const x = mesh.xs[i];
    if (x < r.x0 - tol || x > r.x1 + tol) continue;
    for (let j = 0; j < mesh.ny; j++) {
      const y = mesh.ys[j], id = mesh.nodeId[(i * mesh.ny + j) * mesh.nz + k];
      if (id >= 0 && y >= r.y0 - tol && y <= r.y1 + tol) cand.push({ id, x, y });
    }
  }
  if (cand.length < 3) return null;
  const pick = (score, ok) => { let best = null, bs = -Infinity; for (const c of cand) if (ok(c)) { const s = score(c); if (s > bs + tol) { bs = s; best = c; } } return best; };
  const a = pick(c => -Math.hypot(c.x - cx, c.y - cy), () => true);
  const b = pick(c => Math.abs(c.x - a.x), c => Math.abs(c.y - a.y) < tol && c.id !== a.id);
  if (!b) return null;
  const c = pick(c => Math.abs(c.y - a.y) - 1e-6 * Math.abs(c.x - a.x), c => Math.abs(c.y - a.y) > tol);
  return c ? [a.id, b.id, c.id] : null;
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
 * s(x) = min(hmax, min over refined edges of hmin + (r - 1) max(0, |x - e| - zone))
 * (geometric growth at ratio r, Section 5.2; zone = 2 t at a die edge) and
 * per-interval minimum counts.
 */
function gridLines(lines, edges, hmin, hmax, spans) {
  const r = CONST.GROWTH_RATIO_MAX;
  const size = x => {
    let s = hmax;
    for (const e of edges) s = Math.min(s, hmin + (r - 1) * Math.max(0, Math.abs(x - e.v) - e.zone));
    return Math.max(s, 1e-6);
  };
  // minimum element count per interval from ring spans
  const nmin = new Int32Array(lines.length - 1).fill(1);
  for (const sp of spans) {
    const ids = [];
    for (let q = 0; q + 1 < lines.length; q++) if (lines[q] >= sp.a - 1e-9 && lines[q + 1] <= sp.b + 1e-9) ids.push(q);
    if (!ids.length) continue;
    // fillet columns: up to MIN_ELEMS_ACROSS_FILLET, but no narrower than FILLET_COL_MIN_FRACTION x h_min, so the
    // grid has no abrupt size jump next to the fillet on coarse presets (it slows the multigrid solver)
    // (a wafer underfill fillet span may drop to one column on coarse grids: its wedge is carried by the cell fill fractions)
    const n = sp.fillet ? clamp(Math.ceil((sp.b - sp.a) / (CONST.FILLET_COL_MIN_FRACTION * hmin)), sp.min || CONST.MIN_ELEMS_ACROSS_RING, CONST.MIN_ELEMS_ACROSS_FILLET) : CONST.MIN_ELEMS_ACROSS_RING;
    const need = Math.ceil(n / ids.length);
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

/**
 * Feature lines and refinement data along one axis ('x' or 'y'): die edges
 * (edges) and the lid foot or stiffener ring edges (ringEdges), where the
 * adhesive and the top solder resist under the ring edge carry a stress
 * concentration that a grid sized for the dies alone would miss.
 */
function axisFeatures(g, axis) {
  const lo = axis === 'x' ? g.substrate.x0 : g.substrate.y0, hi = axis === 'x' ? g.substrate.x1 : g.substrate.y1;
  const k0 = axis === 'x' ? 'x0' : 'y0', k1 = axis === 'x' ? 'x1' : 'y1';
  const feats = [{ v: lo, prio: 3, label: 'substrate edge' }, { v: hi, prio: 3, label: 'substrate edge' }];
  const edges = [], spans = [], ringEdges = [];
  const add = (v, prio, label) => { if (v > lo + 1e-12 && v < hi - 1e-12) feats.push({ v, prio, label }); };
  for (const d of g.dies) {
    add(d.rect[k0], 2, d.name + ' edge'); add(d.rect[k1], 2, d.name + ' edge');
    edges.push({ v: d.rect[k0], zone: CONST.REFINE_ZONE_FACTOR * d.t }, { v: d.rect[k1], zone: CONST.REFINE_ZONE_FACTOR * d.t });
    const fa = d.rect[k0] - g.uf.Wf, fb = d.rect[k1] + g.uf.Wf;
    add(fa, 1, d.name + ' fillet'); add(fb, 1, d.name + ' fillet');
    spans.push({ a: Math.max(lo, fa), b: d.rect[k0], fillet: true }, { a: d.rect[k1], b: Math.min(hi, fb), fillet: true });
    if (d.field) { add(d.field[k0], 1, d.name + ' bump field'); add(d.field[k1], 1, d.name + ' bump field'); }
    if (d.inner) { add(d.inner[k0], 1, d.name + ' bump ring'); add(d.inner[k1], 1, d.name + ' bump ring'); }
    if (d.kind !== 'module') continue;
    // chiplet edges refine like die edges; the wafer underfill fillet gets its own columns (clipped at the base edge).
    // The DDI microbump field lines are not grid lines: the solder fraction of a cell comes from its area overlap.
    for (const c of d.chiplets) {
      add(c.rect[k0], 2, c.name + ' edge'); add(c.rect[k1], 2, c.name + ' edge');
      edges.push({ v: c.rect[k0], zone: CONST.REFINE_ZONE_FACTOR * c.t }, { v: c.rect[k1], zone: CONST.REFINE_ZONE_FACTOR * c.t });
      if (!g.wcuf) continue;
      const wa = Math.max(d.rect[k0], c.rect[k0] - g.wcuf.Wf), wb = Math.min(d.rect[k1], c.rect[k1] + g.wcuf.Wf);
      add(wa, 1, c.name + ' wCUF fillet'); add(wb, 1, c.name + ' wCUF fillet');
      if (c.rect[k0] - wa > 1e-9) spans.push({ a: wa, b: c.rect[k0], fillet: true, min: 1 });
      if (wb - c.rect[k1] > 1e-9) spans.push({ a: c.rect[k1], b: wb, fillet: true, min: 1 });
    }
  }
  const ring = g.lid || g.stiff;
  if (ring) {
    const what = g.lid ? 'lid' : 'stiffener';
    add(ring.outer[k0], 2, what + ' outer'); add(ring.outer[k1], 2, what + ' outer');
    add(ring.inner[k0], 2, what + ' inner'); add(ring.inner[k1], 2, what + ' inner');
    spans.push({ a: ring.outer[k0], b: ring.inner[k0] }, { a: ring.inner[k1], b: ring.outer[k1] });
    const zone = CONST.RING_EDGE_ZONE * (g.lid ? g.lid.footH : g.stiff.zTop - g.stiff.zAdhTop);
    for (const v of [ring.outer[k0], ring.inner[k0], ring.inner[k1], ring.outer[k1]]) ringEdges.push({ v, zone });
  }
  return { feats, edges, spans, ringEdges };
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
  for (const m of g.modules) {
    add(m.zBaseTop, m.name + ' base top', 2);
    add(m.zDdiTop, m.name + ' chiplet bottom', 2);
    if (m.rdl) for (const b of m.rdl.bands) add(b.z1, m.name + ' RDL band', 2);
    if (g.wcuf && g.wcuf.Hf > 0 && g.wcuf.Hf < 1) add(m.zDdiTop + g.wcuf.Hf * g.stack.chipletT, m.name + ' wCUF fillet top', 1);
  }
  if (g.lid) { add(g.lid.zAdhTop, 'lid adhesive top', 2); add(g.lid.zLidBot, 'lid underside', 2); add(g.lid.zLidTop, 'lid top', 2); }
  if (g.stiff) { add(g.stiff.zAdhTop, 'stiffener adhesive top', 2); add(g.stiff.zTop, 'stiffener top', 2); }
  const merged = mergeFeatures(pl, CONST.PLANE_MERGE_TOL);
  const base = merged.lines;
  // element layers per band: die bands (except slivers) and the lid plate start at two layers; then every
  // physical region gets at least MIN_LAYERS_PER_REGION layers through its thickness (bump layer, fillet
  // height, each die, lid plate and foot, adhesives, stiffener), each extra layer going to the band of
  // the region with the largest element thickness. The TIM keeps one layer: the gel carries almost no load,
  // and four layers changed no result by more than 0.3 % while adding PCG iterations on the lid stages.
  // Substrate bands stay one layer each (substrateBands already splits the build-up and core groups).
  const nsub = [];
  for (let b = 0; b + 1 < base.length; b++) {
    const za = base[b], zb = base[b + 1], zc = 0.5 * (za + zb);
    let n = 1;
    if (zb > g.zt + 1e-9) {
      let tDie = Infinity;
      for (const d of g.dies) if (zc > g.zaf && zc < d.ztop) tDie = Math.min(tDie, d.t);
      if (isFinite(tDie) && zb - za >= CONST.SLIVER_FRACTION * tDie) n = 2;
      if (g.lid && zc > g.lid.zLidBot && zc < g.lid.zLidTop) n = 2;
    }
    nsub.push(n);
  }
  const regions = [[g.zt, g.zaf]];
  for (const d of g.dies) {
    regions.push([g.zaf, d.ztop]);
    if (g.uf.Hf > 0) regions.push([g.zaf, g.zaf + Math.min(1, g.uf.Hf) * d.t]);
  }
  // stacked modules: the base (each RDL band is a base band of its own), the DDI gap, the chiplets and mold, the wCUF fillet
  for (const m of g.modules) {
    if (!m.rdl) regions.push([g.zaf, m.zBaseTop]);
    regions.push([m.zBaseTop, m.zDdiTop], [m.zDdiTop, m.ztop]);
    if (g.wcuf && g.wcuf.Hf > 0) regions.push([m.zDdiTop, m.zDdiTop + Math.min(1, g.wcuf.Hf) * g.stack.chipletT]);
  }
  if (g.lid) regions.push([g.zt, g.lid.zAdhTop], [g.lid.zAdhTop, g.lid.zLidBot], [g.lid.zLidBot, g.lid.zLidTop]);
  if (g.stiff) regions.push([g.zt, g.stiff.zAdhTop], [g.stiff.zAdhTop, g.stiff.zTop]);
  for (const [za, zb] of regions) {
    const ids = [];
    for (let b = 0; b + 1 < base.length; b++) { const zc = 0.5 * (base[b] + base[b + 1]); if (zc > za && zc < zb) ids.push(b); }
    if (!ids.length) continue;
    let total = ids.reduce((t, b) => t + nsub[b], 0);
    while (total < CONST.MIN_LAYERS_PER_REGION) {
      let best = ids[0];
      for (const b of ids) if ((base[b + 1] - base[b]) / nsub[b] > (base[best + 1] - base[best]) / nsub[best]) best = b;
      nsub[best]++; total++;
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
  // the joints are separate columns between two pads: axial and transverse shear stiffness only (columnD)
  G.solder = add('solder', { name: 'Solder phase', kind: 'homog', mat: cfg.bump.solder, stage: 1, part: PART.SOLDER, column: true });
  G.uf = add('uf', { name: 'Underfill', kind: 'homog', mat: cfg.underfill.mat, stage: 2, part: PART.UF_BUMP });
  G.die = g.monoDies.map((d, i) => add('die' + i, { name: d.name, kind: 'homog', mat: 'si', siModel: d.si, stage: 1, part: PART.DIE, die: i }));
  if (g.lid) {
    G.tim = add('tim', { name: 'TIM1', kind: 'homog', mat: cfg.lid.timMat, stage: 3, part: PART.TIM });
    G.lid = add('lid', { name: 'Lid', kind: 'homog', mat: cfg.lid.mat, stage: 3, part: PART.LID });
    G.lidadh = add('lidadh', { name: 'Lid adhesive', kind: 'homog', mat: cfg.lid.adhMat, stage: 3, part: PART.LIDADH });
  }
  if (g.stiff) {
    G.stiff = add('stiff', { name: 'Stiffener', kind: 'homog', mat: cfg.stiffener.mat, stage: 3, part: PART.STIFF });
    G.stiffadh = add('stiffadh', { name: 'Stiffener adhesive', kind: 'homog', mat: cfg.stiffener.adhMat, stage: 3, part: PART.STIFFADH });
  }
  if (g.modules.length) {
    // stacked modules are built before the substrate stage (negative stages): chiplets, base and DDI microbumps at chip join,
    // then the wafer underfill, then the wafer mold; the C4 bumps and the flip chip underfill below them follow in stages 1 and 2
    const st = g.stack, S = CONST.STAGE;
    G.chip = []; G.base = []; G.tsv = []; G.rdl = [];
    g.modules.forEach((m, mi) => {
      G.chip[mi] = m.chiplets.map((c, ci) => add(c.gkey, { name: c.name, kind: 'homog', mat: 'si', siModel: c.si, stage: S.DDI, part: PART.CHIPLET, module: mi, chiplet: ci }));
      if (m.base === 'rdl') G.rdl[mi] = add('rdl' + mi, { name: m.name + ' RDL', kind: 'layered', stage: S.DDI, part: PART.RDL, module: mi, layerMats: cfg.modules[mi].rdl.flatMap(r => [r.mat, r.fill]).filter(Boolean) });
      else {
        G.base[mi] = add('base' + mi, { name: m.name + ' Si base', kind: 'homog', mat: 'si', siModel: m.si, stage: S.DDI, part: PART.BASE_SI, module: mi });
        if (m.tsv > 0) G.tsv[mi] = add('tsv' + mi, { name: m.name + ' TSV Cu', kind: 'homog', mat: 'cu', stage: S.DDI, part: PART.TSV, module: mi });
      }
    });
    // DDI joints: separate columns of a Cu pillar and a solder cap in series (columnD with the series moduli)
    G.ddi = add('ddi', { name: 'DDI microbumps', kind: 'homog', mat: st.ddi.solder, column: true, series: { mat: 'cu', f: st.ddi.pillarH / st.ddi.standoff }, stage: S.DDI, part: PART.DDI_SOLDER });
    if (g.wcuf) G.wcuf = add('wcuf', { name: 'Wafer underfill', kind: 'homog', mat: st.wcuf.mat, stage: S.WCUF, part: PART.WCUF_FILLET });
    G.mold = add('mold', { name: 'Wafer mold', kind: 'homog', mat: st.moldMat, stage: S.MOLD, part: PART.MOLD });
  }
  return { groups, G };
}

/** Volume fraction of the cell slab z0..z1 lying below the fillet surface z = zBase + h, averaged over the samples hs. */
function fillFraction(hs, zBase, z0, z1) {
  let f = 0;
  for (let q = 0; q < hs.length; q++) f += clamp((zBase + hs[q] - z0) / (z1 - z0), 0, 1);
  return f / hs.length;
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
    // fillet surface heights at S x S points of the column, for the filled fraction of the cells the wedge cuts
    const S = CONST.FILLET_FILL_SAMPLES;
    const surf = fn => { const hs = new Float64Array(S * S); for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) hs[a * S + b] = fn(xs[i] + (xs[i + 1] - xs[i]) * (a + 0.5) / S, ys[j] + (ys[j + 1] - ys[j]) * (b + 0.5) / S).h; return hs; };
    if (c.fil && c.fil.inFootprint) c.hs = surf((x, y) => filletHeight(g, x, y));
    if (die && die.kind === 'module') {
      c.chip = chipletAt(die, xc, yc);
      c.fbd = c.chip ? cellBumpFraction(c.chip, cell) : 0;
      c.wc = c.chip ? null : wcufHeight(g, die, xc, yc);
      if (c.wc && c.wc.inFootprint) c.hsw = surf((x, y) => wcufHeight(g, die, x, y));
    }
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
      if (d.kind === 'module') {
        const mi = d.modIndex;
        if (zc < d.zBaseTop) {
          if (d.base === 'rdl') return [{ group: G.rdl[mi], scale: 1, part: PART.RDL }];
          // TSV Cu superposed on the Si (Voigt, as the core PTH Cu)
          if (d.tsv > 0) return [{ group: G.base[mi], scale: 1 - d.tsv, part: PART.BASE_SI }, { group: G.tsv[mi], scale: d.tsv, part: PART.TSV }];
          return [{ group: G.base[mi], scale: 1, part: PART.BASE_SI }];
        }
        if (zc < d.zDdiTop) {
          // DDI gap: microbump columns superposed on the fill under a chiplet; wCUF fillet or mold between chiplets
          const fill = G.wcuf != null ? G.wcuf : G.mold;
          if (c.chip) return c.fbd > 1e-12 ? [{ group: G.ddi, scale: c.fbd, part: PART.DDI_SOLDER }, { group: fill, scale: 1 - c.fbd, part: PART.DDI_FILL }] : [{ group: fill, scale: 1, part: PART.DDI_FILL }];
          if (c.wc && c.wc.inFootprint) return [{ group: G.wcuf, scale: 1, part: PART.WCUF_FILLET }];
          return [{ group: G.mold, scale: 1, part: PART.MOLD }];
        }
        if (zc < d.ztop) {
          if (c.chip) return [{ group: G.chip[mi][c.chip.index], scale: 1, part: PART.CHIPLET }];
          if (c.wc && c.wc.inFootprint) {
            // the wedge cuts the cell: wCUF and mold superposed by their volume fractions
            const f = fillFraction(c.hsw, d.zDdiTop, zs[k], zs[k + 1]);
            if (f > 1 - CONST.FILLET_FILL_MIN) return [{ group: G.wcuf, scale: 1, part: PART.WCUF_FILLET }];
            if (f >= CONST.FILLET_FILL_MIN) return [{ group: G.wcuf, scale: f, part: PART.WCUF_FILLET }, { group: G.mold, scale: 1 - f, part: PART.MOLD }];
          }
          return [{ group: G.mold, scale: 1, part: PART.MOLD }];
        }
        if (lid && zc < lid.zLidBot) return [{ group: G.tim, scale: 1, part: PART.TIM }];
        return [];
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
      if (zc < g.zaf) return [{ group: G.uf, scale: 1, part: PART.UF_FILLET }];
      // above the active face the linear wedge cuts through cells: the element carries the filled volume
      // fraction of its cell as a stiffness and load scale, so the fillet acts as a continuous wedge
      const f = fillFraction(c.hs, g.zaf, zs[k], zs[k + 1]);
      if (f >= CONST.FILLET_FILL_MIN) return [{ group: G.uf, scale: f, part: PART.UF_FILLET }];
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
 * proportionally until the DOF estimate is under the cap (Section 5.2). The
 * lid foot or stiffener ring edges are then refined to the same h_min on top
 * of that grid, so the ring refinement never coarsens the dies (the DOF ends
 * above the cap by that refinement: about 1.45 to 1.56 x on the presets).
 */
function buildPackageMesh(cfg, override) {
  const t0 = nowMs();
  const g = deriveGeometry(cfg);
  const pre = presetParams(cfg, override);
  const fx = axisFeatures(g, 'x'), fy = axisFeatures(g, 'y');
  const mx = mergeFeatures(fx.feats, CONST.FEATURE_SNAP_TOL), my = mergeFeatures(fy.feats, CONST.FEATURE_SNAP_TOL);
  const zp = zPlanes(g);
  const { groups, G } = packageGroups(cfg, g);
  let hmin = pre.hmin, hmax = pre.hmax, mesh = null, scaled = false, capDof = 0, floor = false;
  // the cap loop grows h_min at most to the preset h_max, and with stacked modules at most to MODULE_HMIN_PER_HEIGHT
  // times the height of the lowest module (base, DDI gap and chiplet): wider elements leave the thin module layers so
  // flat that the solver stalls in the module stages, and too coarse to carry the load transfer at the chiplet edges
  const modH = g.dies.filter(d => d.kind === 'module').map(d => d.t);
  const hminLimit = Math.max(pre.hmin, Math.min(pre.hmax, modH.length ? CONST.MODULE_HMIN_PER_HEIGHT * Math.min(...modH) : Infinity));
  const moduleLimited = hminLimit < pre.hmax;
  const build = ring => {
    const xs = gridLines(mx.lines, ring ? fx.edges.concat(fx.ringEdges) : fx.edges, hmin, hmax, fx.spans);
    const ys = gridLines(my.lines, ring ? fy.edges.concat(fy.ringEdges) : fy.edges, hmin, hmax, fy.spans);
    return buildStructuredMesh(xs, ys, zp.zs, groups, makePackageAssign(g, xs, ys, zp.zs, G, zp.layerBand));
  };
  for (let it = 0; it < CONST.CAP_MAX_ITER; it++) {
    mesh = build(false);
    capDof = 3 * mesh.nn;
    if (capDof <= pre.cap || override && override.noCap || floor) break;
    let f = Math.sqrt(capDof / pre.cap) * CONST.CAP_GROWTH_PAD;
    // h_min never grows past its limit: beyond it the feature lines and minimum element counts (stacked modules with
    // many thin layers) keep the DOF up while the elements next to thin layers get extremely flat and the solver slows
    if (hmin * f >= hminLimit) { f = hminLimit / hmin; floor = true; }
    hmin *= f; hmax *= f; scaled = true;
  }
  const ringRefined = fx.ringEdges.length > 0;
  if (ringRefined) mesh = build(true);
  mesh.layerBand = Int32Array.from(zp.layerBand);
  // indices of the in-plane feature lines (kept at every multigrid coarse level)
  // (structural lines only: die edges and lid foot or stiffener ring edges)
  const featIdx = (lines, labels, grid) => { const out = []; lines.forEach((v, q) => { if (!/ edge$|outer$|inner$/.test(labels[q]) || /substrate/.test(labels[q])) return; let best = -1, bd = Infinity; for (let i = 0; i < grid.length; i++) { const d = Math.abs(grid[i] - v); if (d < bd) { bd = d; best = i; } } if (bd < 1e-9) out.push(best); }); return Int32Array.from(out); };
  mesh.featureX = featIdx(mx.lines, mx.labels, mesh.xs); mesh.featureY = featIdx(my.lines, my.labels, mesh.ys);
  mesh.subBand = new Int32Array(zp.zs.length - 1).fill(-1);
  for (let k = 0; k + 1 < zp.zs.length; k++) {
    const zc = 0.5 * (zp.zs[k] + zp.zs[k + 1]);
    for (let b = 0; b < g.sub.bands.length; b++) if (zc > g.sub.bands[b].z0 && zc < g.sub.bands[b].z1) mesh.subBand[k] = b;
  }
  // layered sections: the substrate bands, then each RDL interposer cut at the element layers through it (planes of other
  // parts can split an RDL band, so its sections follow the layers); a layered group maps each layer to its section (secK)
  mesh.layeredBands = g.sub.bands.map(b => Object.assign({ group: G.sub }, b));
  groups[G.sub].secK = mesh.subBand;
  const secKey = new Map();
  for (const m of g.modules) {
    if (!m.rdl) continue;
    const gi = G.rdl[m.modIndex], secK = new Int32Array(zp.zs.length - 1).fill(-1);
    for (let k = 0; k + 1 < zp.zs.length; k++) {
      const z0 = zp.zs[k], z1 = zp.zs[k + 1], zc = 0.5 * (z0 + z1);
      if (zc < g.zaf || zc > m.zBaseTop) continue;
      const subs = [];
      for (const r of m.rdl.rows) { const a = Math.max(z0, r.z0), b = Math.min(z1, r.z1); if (b - a > 1e-12) subs.push({ row: r.row, rowIdx: r.idx, z0: a, z1: b }); }
      const key = gi + '|' + k;
      if (!secKey.has(key)) { secKey.set(key, mesh.layeredBands.length); mesh.layeredBands.push({ group: gi, z0, z1, subs }); }
      secK[k] = secKey.get(key);
    }
    groups[gi].secK = secK;
  }
  mesh.groupIndex = {};
  groups.forEach((gr, i) => { mesh.groupIndex[gr.key] = i; });
  mesh.G = G;
  mesh.geom = g;
  mesh.constraints = constraints321(mesh, CONST.CONSTRAINT_SPAN * Math.min(g.substrate.x1, g.substrate.y1));
  // stacked modules are free bodies in their own process stages (the rest of the package is not yet born): each gets
  // a statically determinate 3-2-1 support on its base bottom for those stages, which carries no reaction under the
  // module's self-equilibrated thermal load
  if (g.modules.length) {
    const kb = zp.zs.findIndex(z => Math.abs(z - g.zaf) < 1e-9), dofs = [];
    for (const m of g.modules) {
      const s = moduleSupport(mesh, m.rect, m.cx, m.cy, kb);
      if (!s) throw new Error(m.name + ': too few mesh nodes under the module base for its support in the module stages.');
      dofs.push(3 * s[0], 3 * s[0] + 1, 3 * s[0] + 2, 3 * s[1] + 1, 3 * s[1] + 2, 3 * s[2] + 2);
    }
    mesh.moduleConstraints = Int32Array.from(dofs);
  }
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
    preset: pre.label, hmin, hmax, hminPreset: pre.hmin, hmaxPreset: pre.hmax, cap: pre.cap, scaled, capDof, capFloor: floor, hminLimit, moduleLimited, ringRefined, ringLabel: g.lid ? 'lid foot' : (g.stiff ? 'stiffener ring' : null),
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
  if (inf.capDof > inf.cap) w.push({ level: 'warning', text: 'DOF ' + inf.capDof + ' above the ' + inf.preset + ' cap ' + inf.cap + (inf.capFloor ? (inf.moduleLimited ? ': h_min has reached its limit of ' + inf.hminLimit.toFixed(3) + ' mm (' + CONST.MODULE_HMIN_PER_HEIGHT + ' times the height of the lowest stacked module, so that its thin layers stay solvable and resolved); expect a longer run.' : ': h_min has reached the preset h_max (' + inf.hmaxPreset + ' mm), and the many thin layers (stacked modules) keep the DOF above the cap; expect a longer run.') : '.') });
  else if (inf.ringRefined && inf.nDof > inf.cap) w.push({ level: 'info', text: 'The refinement at the ' + inf.ringLabel + ' edges (elements from h_min, ' + (1000 * inf.hmin).toFixed(0) + ' µm) adds ' + (inf.nDof - inf.capDof) + ' DOF to the grid sized for the ' + inf.preset + ' cap of ' + inf.cap + ' (total ' + inf.nDof + ').' });
  if (inf.scaled) w.push({ level: 'info', text: 'Mesh sizes enlarged to h_min ' + inf.hmin.toFixed(3) + ' mm and h_max ' + inf.hmax.toFixed(3) + ' mm to stay under the ' + inf.preset + ' DOF cap.' });
  const sn = inf.snappedX.concat(inf.snappedY);
  if (sn.length) w.push({ level: 'info', text: sn.length + ' in-plane feature lines closer than 10 µm were merged (' + sn.slice(0, 3).map(s => s.a + ' / ' + s.b).join('; ') + (sn.length > 3 ? '; ...' : '') + ').' });
  return w;
}
