// ===== Derived geometry and validation ====================================

function rectArea(r) { return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0); }
function rectIntersectArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
function pointInRect(r, x, y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
/** Euclidean distance from a point to a rectangle (0 inside). */
function distToRect(r, x, y) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(dx, dy);
}
/** Euclidean gap between two rectangles (negative extent means overlap). */
function rectGap(a, b) {
  const gx = Math.max(a.x0 - b.x1, b.x0 - a.x1), gy = Math.max(a.y0 - b.y1, b.y0 - a.y1);
  if (gx < 0 && gy < 0) return Math.max(gx, gy); // overlap depth (negative)
  return Math.hypot(Math.max(gx, 0), Math.max(gy, 0));
}

/** Bump centre positions along one axis: n = floor((L - 2k)/p) + 1, centred. */
function bumpAxis(c, L, k, p) {
  const span0 = L - 2 * k;
  if (span0 < -1e-12 || p <= 0) return { n: 0, first: c, last: c };
  const n = Math.floor(span0 / p + 1e-9) + 1;
  const span = (n - 1) * p;
  return { n, first: c - span / 2, last: c + span / 2 };
}

/**
 * Rectangle, flip chip (C4) bump field and bump sites of an object on the
 * substrate's bump layer (a monolithic die or a module base) of footprint
 * w x h centred at (cx, cy), with bump pitch (px, py) in package axes.
 */
function c4Field(cx, cy, w, h, bump, px, py, so) {
  const rect = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
  const prof = bumpProfile(bump.ubm, bump.sro, bump.dmax, so);
  const f = bumpFieldRects(cx, cy, w, h, rect, bump, px, py);
  const abump = Math.PI * prof.deff * prof.deff / 4;
  return Object.assign(f, { cx, cy, w, h, rect, px, py, profile: prof, deff: prof.deff, abump, density: abump / (px * py) });
}

/** Bump field rectangle (and the inner void of a peripheral array) of a rectangular footprint. */
function bumpFieldRects(cx, cy, w, h, rect, bump, px, py) {
  const ax = bumpAxis(cx, w, bump.keepout, px), ay = bumpAxis(cy, h, bump.keepout, py);
  const field = (ax.n > 0 && ay.n > 0) ? {
    x0: Math.max(rect.x0, ax.first - px / 2), x1: Math.min(rect.x1, ax.last + px / 2),
    y0: Math.max(rect.y0, ay.first - py / 2), y1: Math.min(rect.y1, ay.last + py / 2),
  } : null;
  let inner = null;
  const N = Math.max(1, Math.round(bump.rows || 1));
  if (field && bump.type === 'peripheral' && ax.n > 2 * N && ay.n > 2 * N) {
    inner = { x0: ax.first + (N - 0.5) * px, x1: ax.last - (N - 0.5) * px, y0: ay.first + (N - 0.5) * py, y1: ay.last - (N - 0.5) * py };
  }
  return { nbx: ax.n, nby: ay.n, bx0: ax.first, by0: ay.first, field, inner, rows: N, peripheral: !!inner };
}

/** Total thickness (mm) of a stack of rows. */
function stackThickness(rows) { return rows.reduce((t, r) => t + r.t, 0); }

/**
 * Element bands of an organic RDL interposer whose bottom is at z0: the rows
 * (listed top to bottom) bottom-up with z ranges, split into
 * MIN_LAYERS_PER_REGION layered bands of equal thickness (as a substrate group).
 */
function rdlBands(rowsTopDown, z0) {
  const rows = [];
  let z = z0;
  for (let i = rowsTopDown.length - 1; i >= 0; i--) { rows.push({ idx: i, row: rowsTopDown[i], z0: z, z1: z + rowsTopDown[i].t }); z += rowsTopDown[i].t; }
  const nb = CONST.MIN_LAYERS_PER_REGION, bands = [];
  for (let q = 0; q < nb; q++) {
    const a = z0 + (z - z0) * q / nb, b = z0 + (z - z0) * (q + 1) / nb;
    const subs = [];
    for (const r of rows) { const lo = Math.max(a, r.z0), hi = Math.min(b, r.z1); if (hi - lo > 1e-12) subs.push({ row: r.row, rowIdx: r.idx, z0: lo, z1: hi }); }
    bands.push({ z0: a, z1: b, subs });
  }
  return { total: z - z0, rows, bands };
}

/**
 * Derived geometry from a configuration: z levels, the objects on the flip chip
 * bump layer (g.dies: monolithic dies, then module bases), module chiplets and
 * DDI fields, silicon parts for the die stress (g.siParts), fillets, lid /
 * stiffener footprints, BGA ball sites.
 */
function deriveGeometry(cfg) {
  const sub = substrateBands(cfg.substrate.layers);
  const zt = sub.total;
  const so = cfg.bump.standoff;
  const zaf = zt + so;
  const sx = cfg.substrate.sx, sy = cfg.substrate.sy;
  const substrate = { x0: -sx / 2, x1: sx / 2, y0: -sy / 2, y1: sy / 2 };
  const siParts = [];
  const dies = cfg.dies.map((d, i) => {
    const rot = d.rot === 90;
    const w = rot ? d.sy : d.sx, h = rot ? d.sx : d.sy;
    const px = rot ? d.bump.py : d.bump.px, py = rot ? d.bump.px : d.bump.py;
    const o = Object.assign(c4Field(d.x, d.y, w, h, d.bump, px, py, so), {
      index: i, kind: 'die', cfgIndex: i, id: d.id, name: d.name, t: d.t, si: d.si || 'aniso', zaf, zb: zaf, ztop: zaf + d.t, gkey: 'die' + i, part: PART.DIE,
    });
    siParts.push(o);
    return o;
  });
  const mods = cfg.modules || [];
  const st = mods.length ? cfg.stack : null;
  const modules = mods.map((m, mi) => {
    const rot = m.rot === 90;
    const w = rot ? m.sy : m.sx, h = rot ? m.sx : m.sy;
    const px = rot ? m.bump.py : m.bump.px, py = rot ? m.bump.px : m.bump.py;
    const rdl = m.base === 'rdl';
    const tBase = rdl ? stackThickness(m.rdl) : m.tBase;
    const zBaseTop = zaf + tBase, zDdiTop = zBaseTop + st.ddi.standoff, H = tBase + st.ddi.standoff + st.chipletT;
    const o = Object.assign(c4Field(m.x, m.y, w, h, m.bump, px, py, so), {
      index: cfg.dies.length + mi, kind: 'module', modIndex: mi, id: m.id, name: m.name, t: H, zaf, ztop: zaf + H,
      base: rdl ? 'rdl' : 'si', tBase, zBaseTop, zDdiTop, si: m.si || 'aniso', tsv: rdl ? 0 : Math.max(0, m.tsv || 0),
    });
    if (rdl) o.rdl = rdlBands(m.rdl, zaf);
    // chiplets: centres rotated with the module, sizes and DDI pitch swapped by the module and the chiplet rotation
    const dpx = st.ddi.px, dpy = st.ddi.py, abump = Math.PI * st.ddi.d * st.ddi.d / 4;
    o.chiplets = m.chiplets.map((c, ci) => {
      const ccx = m.x + (rot ? -c.y : c.x), ccy = m.y + (rot ? c.x : c.y);
      const swap = rot !== (c.rot === 90);
      const cw = swap ? c.sy : c.sx, ch = swap ? c.sx : c.sy;
      const cpx = swap ? dpy : dpx, cpy = swap ? dpx : dpy;
      const rect = { x0: ccx - cw / 2, x1: ccx + cw / 2, y0: ccy - ch / 2, y1: ccy + ch / 2 };
      const f = bumpFieldRects(ccx, ccy, cw, ch, rect, c.ddi, cpx, cpy);
      return Object.assign(f, {
        index: ci, modIndex: mi, id: c.id, name: m.name + ' / ' + c.name, short: c.name, cx: ccx, cy: ccy, w: cw, h: ch, rect, px: cpx, py: cpy,
        t: st.chipletT, si: c.si || 'aniso', zaf: zDdiTop, zb: zDdiTop, ztop: zDdiTop + st.chipletT, deff: st.ddi.d, abump, density: abump / (cpx * cpy),
        gkey: 'chip' + mi + '_' + ci, part: PART.CHIPLET, kind: 'chiplet',
      });
    });
    for (const c of o.chiplets) siParts.push(c);
    if (!rdl) siParts.push({ kind: 'base', modIndex: mi, name: m.name + ' (Si base)', rect: o.rect, cx: o.cx, cy: o.cy, w, h, t: tBase, zb: zaf, ztop: zBaseTop, gkey: 'base' + mi, part: PART.BASE_SI });
    return o;
  });
  const objs = dies.concat(modules);
  const tmax = objs.reduce((m, d) => Math.max(m, d.t), 0);
  const g = { cfg, sub, zt, zaf, so, substrate, dies: objs, monoDies: dies, modules, siParts, tmax, type: cfg.packageType, stack: st };
  g.uf = { Wf: cfg.underfill.Wf, Hf: cfg.underfill.Hf };
  if (st) g.wcuf = st.fill === 'wcuf' ? { Wf: st.wcuf.Wf, Hf: st.wcuf.Hf } : null;
  if (cfg.packageType === 'lid') {
    const L = cfg.lid;
    const outer = { x0: -L.ox / 2, x1: L.ox / 2, y0: -L.oy / 2, y1: L.oy / 2 };
    const inner = { x0: outer.x0 + L.footW, x1: outer.x1 - L.footW, y0: outer.y0 + L.footW, y1: outer.y1 - L.footW };
    const zLidBot = zaf + tmax + L.blt;
    g.lid = {
      outer, inner, adhT: L.adhT, zAdhTop: zt + L.adhT, zLidBot, zLidTop: zLidBot + L.tPlate,
      footH: so + tmax + L.blt - L.adhT, blt: objs.map(d => zLidBot - d.ztop),
    };
  }
  if (cfg.packageType === 'stiffener') {
    const S = cfg.stiffener;
    const outer = { x0: -S.ox / 2, x1: S.ox / 2, y0: -S.oy / 2, y1: S.oy / 2 };
    const inner = { x0: outer.x0 + S.ringW, x1: outer.x1 - S.ringW, y0: outer.y0 + S.ringW, y1: outer.y1 - S.ringW };
    g.stiff = { outer, inner, adhT: S.adhT, zAdhTop: zt + S.adhT, zTop: zt + S.adhT + S.t };
  }
  g.bga = bgaSites(cfg);
  return g;
}

/** BGA ball sites (measuring zone = outermost ball centres). */
function bgaSites(cfg) {
  const b = cfg.bga, sx = cfg.substrate.sx, sy = cfg.substrate.sy;
  const ax = bumpAxis(0, sx, b.inset, b.pitch), ay = bumpAxis(0, sy, b.inset, b.pitch);
  const xs = [], ys = [];
  for (let i = 0; i < ax.n; i++) for (let j = 0; j < ay.n; j++) {
    const x = ax.first + i * b.pitch, y = ay.first + j * b.pitch;
    if (b.depop && b.depop.on && Math.abs(x) < b.depop.sx / 2 && Math.abs(y) < b.depop.sy / 2) continue;
    xs.push(x); ys.push(y);
  }
  return {
    x: Float64Array.from(xs), y: Float64Array.from(ys),
    zone: { x0: ax.first, x1: ax.last, y0: ay.first, y1: ay.last }, nx: ax.n, ny: ay.n,
  };
}

/** All bump sites of a die: {x, y, ix, iy, row} (row = distance in rows from the field edge). */
function dieBumpSites(d) {
  const xs = [], ys = [], ix = [], iy = [], row = [];
  for (let i = 0; i < d.nbx; i++) for (let j = 0; j < d.nby; j++) {
    const r = Math.min(i, j, d.nbx - 1 - i, d.nby - 1 - j);
    if (d.peripheral && r >= d.rows) continue;
    xs.push(d.bx0 + i * d.px); ys.push(d.by0 + j * d.py); ix.push(i); iy.push(j); row.push(r);
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), ix: Int32Array.from(ix), iy: Int32Array.from(iy), row: Int32Array.from(row) };
}

/** Bump area fraction f_b of a cell rectangle under die d (Section 5.4). */
function cellBumpFraction(d, cell) {
  if (!d.field) return 0;
  let a = rectIntersectArea(cell, d.field);
  if (d.inner) a -= rectIntersectArea(cell, d.inner);
  const ac = rectArea(cell);
  return ac > 0 ? clamp(a * d.density / ac, 0, 1) : 0;
}

/**
 * Underfill fillet height above the die active face at (x, y) outside dies:
 * linear wedge h(d) = Hf t (1 - d / Wf) from the nearest die, the larger of two
 * wedges between dies, and gaps narrower than Wf filled to Hf times the
 * thinner neighbouring die. Returns {h, inFootprint}.
 */
function filletHeight(g, x, y) { return wedgeHeight(g.dies, g.uf.Wf, g.uf.Hf, x, y); }

/** Fillet wedge height at (x, y) around a set of rectangles with thicknesses t (see filletHeight). */
function wedgeHeight(objs, Wf, Hf, x, y) {
  let h = 0, inFp = false;
  for (const d of objs) {
    const dist = distToRect(d.rect, x, y);
    if (dist <= Wf + 1e-12) {
      inFp = true;
      if (Wf > 0) h = Math.max(h, Hf * d.t * (1 - dist / Wf));
    }
  }
  // narrow gaps between die pairs
  for (let a = 0; a < objs.length; a++) for (let b = a + 1; b < objs.length; b++) {
    const A = objs[a].rect, B = objs[b].rect;
    const tmin = Math.min(objs[a].t, objs[b].t);
    const oy0 = Math.max(A.y0, B.y0), oy1 = Math.min(A.y1, B.y1);
    const ox0 = Math.max(A.x0, B.x0), ox1 = Math.min(A.x1, B.x1);
    const gx = Math.max(A.x0 - B.x1, B.x0 - A.x1), gy = Math.max(A.y0 - B.y1, B.y0 - A.y1);
    if (gx > 0 && gx < Wf && oy1 > oy0 && y >= oy0 && y <= oy1) {
      const lo = Math.min(A.x1, B.x1), hi = Math.max(A.x0, B.x0);
      if (x >= lo && x <= hi) { inFp = true; h = Math.max(h, Hf * tmin); }
    }
    if (gy > 0 && gy < Wf && ox1 > ox0 && x >= ox0 && x <= ox1) {
      const lo = Math.min(A.y1, B.y1), hi = Math.max(A.y0, B.y0);
      if (y >= lo && y <= hi) { inFp = true; h = Math.max(h, Hf * tmin); }
    }
  }
  return { h, inFootprint: inFp };
}

/**
 * Wafer underfill (wCUF) fillet height above the DDI top (chiplet bottom) at
 * (x, y) on module m outside its chiplets: the same wedge rule around the
 * chiplets, clipped at the base edge (the wafer mold fills the rest). Mold-only
 * modules have none.
 */
function wcufHeight(g, m, x, y) {
  if (!g.wcuf || !pointInRect(m.rect, x, y)) return { h: 0, inFootprint: false };
  return wedgeHeight(m.chiplets, g.wcuf.Wf, g.wcuf.Hf, x, y);
}

/** Object on the flip chip bump layer (die or module base) whose footprint holds (x, y), or null. */
function dieAt(g, x, y) {
  for (const d of g.dies) if (x > d.rect.x0 && x < d.rect.x1 && y > d.rect.y0 && y < d.rect.y1) return d;
  return null;
}

/** Chiplet of module m whose footprint holds (x, y), or null. */
function chipletAt(m, x, y) {
  for (const c of m.chiplets) if (x > c.rect.x0 && x < c.rect.x1 && y > c.rect.y0 && y < c.rect.y1) return c;
  return null;
}

/** Clearances of die i for the live readouts while dragging. */
function dieClearances(g, i) {
  const d = g.dies[i];
  const out = { gaps: [], edges: null, lidFoot: null, dnp: 0 };
  for (const o of g.dies) if (o !== d) out.gaps.push({ to: o.name, gap: rectGap(d.rect, o.rect) });
  const s = g.substrate;
  out.edges = { left: d.rect.x0 - s.x0, right: s.x1 - d.rect.x1, bottom: d.rect.y0 - s.y0, top: s.y1 - d.rect.y1 };
  const ring = g.lid ? g.lid.inner : (g.stiff ? g.stiff.inner : null);
  if (ring) out.lidFoot = Math.min(d.rect.x0 - ring.x0, ring.x1 - d.rect.x1, d.rect.y0 - ring.y0, ring.y1 - d.rect.y1);
  for (const [x, y] of [[d.rect.x0, d.rect.y0], [d.rect.x1, d.rect.y0], [d.rect.x0, d.rect.y1], [d.rect.x1, d.rect.y1]]) out.dnp = Math.max(out.dnp, Math.hypot(x, y));
  return out;
}

/**
 * Continuous validation (Section 4.3). Errors block solving; warnings inform.
 * Each message: {level, text, die (index or undefined)}.
 */
function validateConfig(cfg, g) {
  const errors = [], warnings = [];
  const err = (text, die) => errors.push({ level: 'error', text, die });
  const warn = (text, die) => warnings.push({ level: 'warning', text, die });
  const pos = (v, what) => { if (!(v > 0)) err(what + ' must be positive.'); };
  pos(cfg.substrate.sx, 'Substrate x size'); pos(cfg.substrate.sy, 'Substrate y size');
  cfg.substrate.layers.forEach((r, i) => pos(r.t, 'Thickness of substrate row ' + (i + 1)));
  pos(cfg.bump.standoff, 'Bump standoff');
  pos(cfg.bga.pitch, 'BGA pitch');
  pos(cfg.underfill.Wf, 'Fillet width'); pos(cfg.underfill.Hf, 'Fillet height fraction');
  const mods = cfg.modules || [];
  if (!cfg.dies.length && !mods.length) err('Add at least one die or stacked module.');
  try { g = g || deriveGeometry(cfg); } catch (e) { err('Geometry could not be derived: ' + e.message); return { errors, warnings }; }
  const bumpChecks = (d, b, i, who) => {
    for (const [v, n] of [[b.px, 'bump pitch x'], [b.py, 'bump pitch y'], [b.ubm, 'UBM diameter'], [b.sro, 'SRO diameter'], [b.dmax, 'maximum bump diameter']]) if (!(v > 0)) err(who + ': ' + n + ' must be positive.', i);
    if (b.keepout < 0) err(who + ': bump keep-out cannot be negative.', i);
    if (!d.field) err(who + ': the bump field is empty (keep-out larger than half the footprint).', i);
    if (b.dmax < Math.max(b.ubm, b.sro)) err(who + ': maximum bump diameter is smaller than the UBM or SRO diameter.', i);
    if (b.dmax >= Math.min(d.px, d.py)) err(who + ': maximum bump diameter reaches the bump pitch (bumps would touch).', i);
  };
  g.dies.forEach((d, i) => {
    const c = d.kind === 'die' ? cfg.dies[d.cfgIndex] : mods[d.modIndex];
    for (const [v, n] of [[c.sx, 'x size'], [c.sy, 'y size'], [d.t, 'thickness']]) if (!(v > 0)) err(d.name + ': ' + n + ' must be positive.', i);
    bumpChecks(d, c.bump, i, d.name);
    const s = g.substrate;
    if (d.rect.x0 < s.x0 - 1e-9 || d.rect.x1 > s.x1 + 1e-9 || d.rect.y0 < s.y0 - 1e-9 || d.rect.y1 > s.y1 + 1e-9) err(d.name + ' lies outside the substrate.', i);
    else if (Math.min(d.rect.x0 - s.x0, s.x1 - d.rect.x1, d.rect.y0 - s.y0, s.y1 - d.rect.y1) < 2) warn(d.name + ' edge is within 2 mm of the substrate edge.', i);
    for (let j = i + 1; j < g.dies.length; j++) {
      const gap = rectGap(d.rect, g.dies[j].rect);
      if (gap < -1e-9) { err(d.name + ' overlaps ' + g.dies[j].name + '.', i); err(g.dies[j].name + ' overlaps ' + d.name + '.', j); }
      else if (gap < 0.10) warn('Gap between ' + d.name + ' and ' + g.dies[j].name + ' is ' + (gap * 1000).toFixed(0) + ' µm (< 100 µm): underfill flow risk.', i);
    }
    const ring = g.lid ? g.lid.inner : (g.stiff ? g.stiff.inner : null);
    const what = g.lid ? 'lid foot' : 'stiffener ring';
    if (ring) {
      const cl = Math.min(d.rect.x0 - ring.x0, ring.x1 - d.rect.x1, d.rect.y0 - ring.y0, ring.y1 - d.rect.y1);
      if (cl < 0) err(d.name + ' intersects the ' + what + ' footprint.', i);
      else if (cl < g.uf.Wf) err('Underfill fillet of ' + d.name + ' intersects the ' + what + ' footprint.', i);
      else if (cl < g.uf.Wf + 0.5) warn('Underfill fillet of ' + d.name + ' is within 0.5 mm of the ' + what + '.', i);
    }
    if (d.kind === 'die') {
      if (c.t < CONST.BOUNDS.dieT[0] || c.t > CONST.BOUNDS.dieT[1]) err(d.name + ': die thickness outside 0.05 to 1.5 mm.', i);
      return;
    }
    // stacked module: base, chiplets, DDI microbumps
    const mi = d.modIndex, merr = (text, ci) => errors.push({ level: 'error', text, die: i, mod: mi, chip: ci }), mwarn = (text, ci) => warnings.push({ level: 'warning', text, die: i, mod: mi, chip: ci });
    if (d.base === 'si') { if (!(c.tBase >= CONST.BOUNDS.baseT[0] && c.tBase <= CONST.BOUNDS.baseT[1])) merr(d.name + ': Si base thickness outside 0.02 to 1.5 mm.'); }
    else {
      if (!c.rdl.length) merr(d.name + ': the RDL interposer stack is empty.');
      c.rdl.forEach((r, k) => { if (!(r.t > 0)) merr(d.name + ': thickness of RDL row ' + (k + 1) + ' must be positive.'); });
    }
    if (!(d.tsv >= 0 && d.tsv < 0.5)) merr(d.name + ': TSV Cu fraction outside 0 to 0.5.');
    if (!d.chiplets.length) merr(d.name + ': add at least one chiplet.');
    d.chiplets.forEach((ch, ci) => {
      const cc = c.chiplets[ci];
      if (!(cc.sx > 0 && cc.sy > 0)) merr(ch.name + ': size must be positive.', ci);
      const r = ch.rect, b = d.rect;
      const inset = Math.min(r.x0 - b.x0, b.x1 - r.x1, r.y0 - b.y0, b.y1 - r.y1);
      if (inset < -1e-9) merr(ch.name + ' extends beyond its base.', ci);
      else if (g.wcuf && inset < g.wcuf.Wf - 1e-9) mwarn('Wafer underfill fillet of ' + ch.name + ' reaches the base edge and is clipped there.', ci);
      if (!(cc.ddi.keepout >= 0)) merr(ch.name + ': DDI keep-out cannot be negative.', ci);
      if (!ch.field) merr(ch.name + ': the DDI microbump field is empty (keep-out larger than half the chiplet).', ci);
      for (let cj = ci + 1; cj < d.chiplets.length; cj++) {
        const gap = rectGap(r, d.chiplets[cj].rect);
        if (gap < -1e-9) merr(ch.name + ' overlaps ' + d.chiplets[cj].short + '.', ci);
        else if (gap < CONST.CHIPLET_GAP_WARN) mwarn('Gap between ' + ch.name + ' and ' + d.chiplets[cj].short + ' is ' + (gap * 1000).toFixed(0) + ' µm: fill flow risk.', ci);
      }
    });
  });
  if (mods.length) {
    const st = cfg.stack, dd = st.ddi;
    const B = CONST.BOUNDS;
    if (!(st.chipletT >= B.dieT[0] && st.chipletT <= B.dieT[1])) err('Chiplet thickness outside 0.05 to 1.5 mm.');
    if (!(dd.standoff >= B.ddiStandoff[0] && dd.standoff <= B.ddiStandoff[1])) err('DDI standoff outside 5 to 100 µm.');
    if (!(dd.pillarH >= 0 && dd.pillarH < dd.standoff)) err('DDI Cu pillar height must be at least 0 and below the DDI standoff (the solder cap needs a height).');
    if (!(dd.d > 0 && dd.px > 0 && dd.py > 0)) err('DDI microbump diameter and pitch must be positive.');
    else if (dd.d >= Math.min(dd.px, dd.py)) err('DDI microbump diameter reaches the DDI pitch (bumps would touch).');
    if (st.fill === 'wcuf') { pos(st.wcuf.Wf, 'Wafer underfill fillet width'); pos(st.wcuf.Hf, 'Wafer underfill fillet height fraction'); if (st.wcuf.Hf > 1) err('Wafer underfill fillet height fraction above 1 (above the chiplet backside).'); }
    for (const [k, n] of [['Tddi', 'Chiplet join'], ['Twcuf', 'Wafer underfill cure'], ['Tmold', 'Wafer mold cure']]) {
      const T = st.process[k];
      if (!(T >= CONST.TGRID_MIN && T <= CONST.TGRID_MAX)) err(n + ' temperature outside ' + CONST.TGRID_MIN + ' to ' + CONST.TGRID_MAX + ' °C.');
    }
  }
  if (cfg.bump.standoff < CONST.BOUNDS.standoff[0] || cfg.bump.standoff > CONST.BOUNDS.standoff[1]) err('Standoff outside 20 to 200 µm.');
  const core = cfg.substrate.layers.find(r => r.type === 'core');
  if (core && (core.t < CONST.BOUNDS.coreT[0] || core.t > CONST.BOUNDS.coreT[1])) err('Core thickness outside 0.1 to 2.0 mm.');
  if (g.lid) {
    const L = cfg.lid;
    for (const [v, n] of [[L.ox, 'Lid outer x'], [L.oy, 'Lid outer y'], [L.tPlate, 'Lid plate thickness'], [L.footW, 'Lid foot width'], [L.adhT, 'Lid adhesive thickness'], [L.blt, 'TIM bond line thickness']]) pos(v, n);
    if (L.blt <= 0) err('Die top is above the lid underside (TIM bond line is not positive).');
    if (!(g.lid.footH > 0)) err('Lid foot height (standoff + max die thickness + TIM BLT - adhesive thickness) is not positive.');
    if (L.ox > cfg.substrate.sx + 1e-9 || L.oy > cfg.substrate.sy + 1e-9) err('Lid outline is larger than the substrate.');
    if (g.lid.inner.x1 <= g.lid.inner.x0 || g.lid.inner.y1 <= g.lid.inner.y0) err('Lid foot width leaves no cavity.');
  }
  if (g.stiff) {
    const S = cfg.stiffener;
    for (const [v, n] of [[S.ox, 'Stiffener outer x'], [S.oy, 'Stiffener outer y'], [S.ringW, 'Stiffener ring width'], [S.t, 'Stiffener thickness'], [S.adhT, 'Stiffener adhesive thickness']]) pos(v, n);
    if (S.ox > cfg.substrate.sx + 1e-9 || S.oy > cfg.substrate.sy + 1e-9) err('Stiffener outline is larger than the substrate.');
    if (g.stiff.inner.x1 <= g.stiff.inner.x0 || g.stiff.inner.y1 <= g.stiff.inner.y0) err('Stiffener ring width leaves no opening.');
  }
  if (g.bga.x.length < 3) err('BGA field has fewer than three balls; check pitch and inset.');
  // material sanity
  for (const m of cfg.materials) {
    forEachParam(m.elastic || {}, (p, path) => {
      if (/^nu/.test(path.split('.').pop()) && (pv(p) < CONST.BOUNDS.nu[0] || pv(p) > CONST.BOUNDS.nu[1])) err(m.name + ': Poisson ratio ' + path + ' outside 0 to 0.49.');
    });
  }
  return { errors, warnings };
}
