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
 * Derived geometry from a configuration: z levels, die rectangles, bump fields
 * and sites, fillet, lid / stiffener footprints, BGA ball sites.
 */
function deriveGeometry(cfg) {
  const sub = substrateBands(cfg.substrate.layers);
  const zt = sub.total;
  const so = cfg.bump.standoff;
  const zaf = zt + so;
  const sx = cfg.substrate.sx, sy = cfg.substrate.sy;
  const substrate = { x0: -sx / 2, x1: sx / 2, y0: -sy / 2, y1: sy / 2 };
  const dies = cfg.dies.map((d, i) => {
    const rot = d.rot === 90;
    const w = rot ? d.sy : d.sx, h = rot ? d.sx : d.sy;
    const px = rot ? d.bump.py : d.bump.px, py = rot ? d.bump.px : d.bump.py;
    const rect = { x0: d.x - w / 2, x1: d.x + w / 2, y0: d.y - h / 2, y1: d.y + h / 2 };
    const prof = bumpProfile(d.bump.ubm, d.bump.sro, d.bump.dmax, so);
    const ax = bumpAxis(d.x, w, d.bump.keepout, px), ay = bumpAxis(d.y, h, d.bump.keepout, py);
    const field = (ax.n > 0 && ay.n > 0) ? {
      x0: Math.max(rect.x0, ax.first - px / 2), x1: Math.min(rect.x1, ax.last + px / 2),
      y0: Math.max(rect.y0, ay.first - py / 2), y1: Math.min(rect.y1, ay.last + py / 2),
    } : null;
    let inner = null;
    const N = Math.max(1, Math.round(d.bump.rows || 1));
    if (field && d.bump.type === 'peripheral' && ax.n > 2 * N && ay.n > 2 * N) {
      inner = { x0: ax.first + (N - 0.5) * px, x1: ax.last - (N - 0.5) * px, y0: ay.first + (N - 0.5) * py, y1: ay.last - (N - 0.5) * py };
    }
    const abump = Math.PI * prof.deff * prof.deff / 4;
    const density = abump / (px * py);
    return {
      index: i, id: d.id, name: d.name, cx: d.x, cy: d.y, w, h, t: d.t, rect, si: d.si || 'aniso',
      px, py, nbx: ax.n, nby: ay.n, bx0: ax.first, by0: ay.first, field, inner, rows: N,
      peripheral: !!inner, profile: prof, deff: prof.deff, abump, density,
      zaf, ztop: zaf + d.t,
    };
  });
  const tmax = dies.reduce((m, d) => Math.max(m, d.t), 0);
  const g = { cfg, sub, zt, zaf, so, substrate, dies, tmax, type: cfg.packageType };
  g.uf = { Wf: cfg.underfill.Wf, Hf: cfg.underfill.Hf };
  if (cfg.packageType === 'lid') {
    const L = cfg.lid;
    const outer = { x0: -L.ox / 2, x1: L.ox / 2, y0: -L.oy / 2, y1: L.oy / 2 };
    const inner = { x0: outer.x0 + L.footW, x1: outer.x1 - L.footW, y0: outer.y0 + L.footW, y1: outer.y1 - L.footW };
    const zLidBot = zaf + tmax + L.blt;
    g.lid = {
      outer, inner, adhT: L.adhT, zAdhTop: zt + L.adhT, zLidBot, zLidTop: zLidBot + L.tPlate,
      footH: so + tmax + L.blt - L.adhT, blt: dies.map(d => zLidBot - d.ztop),
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
function filletHeight(g, x, y) {
  const Wf = g.uf.Wf, Hf = g.uf.Hf;
  let h = 0, inFp = false;
  for (const d of g.dies) {
    const dist = distToRect(d.rect, x, y);
    if (dist <= Wf + 1e-12) {
      inFp = true;
      if (Wf > 0) h = Math.max(h, Hf * d.t * (1 - dist / Wf));
    }
  }
  // narrow gaps between die pairs
  for (let a = 0; a < g.dies.length; a++) for (let b = a + 1; b < g.dies.length; b++) {
    const A = g.dies[a].rect, B = g.dies[b].rect;
    const tmin = Math.min(g.dies[a].t, g.dies[b].t);
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

function dieAt(g, x, y) {
  for (const d of g.dies) if (x > d.rect.x0 && x < d.rect.x1 && y > d.rect.y0 && y < d.rect.y1) return d;
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
  if (!cfg.dies.length) err('Add at least one die.');
  try { g = g || deriveGeometry(cfg); } catch (e) { err('Geometry could not be derived: ' + e.message); return { errors, warnings }; }
  g.dies.forEach((d, i) => {
    const c = cfg.dies[i];
    for (const [v, n] of [[c.sx, 'x size'], [c.sy, 'y size'], [c.t, 'thickness'], [c.bump.px, 'bump pitch x'], [c.bump.py, 'bump pitch y'],
      [c.bump.ubm, 'UBM diameter'], [c.bump.sro, 'SRO diameter'], [c.bump.dmax, 'maximum bump diameter']]) {
      if (!(v > 0)) err(d.name + ': ' + n + ' must be positive.', i);
    }
    if (c.bump.keepout < 0) err(d.name + ': bump keep-out cannot be negative.', i);
    if (!d.field) err(d.name + ': the bump field is empty (keep-out larger than half the die).', i);
    if (c.bump.dmax < Math.max(c.bump.ubm, c.bump.sro)) err(d.name + ': maximum bump diameter is smaller than the UBM or SRO diameter.', i);
    if (c.bump.dmax >= Math.min(d.px, d.py)) err(d.name + ': maximum bump diameter reaches the bump pitch (bumps would touch).', i);
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
    if (c.t < CONST.BOUNDS.dieT[0] || c.t > CONST.BOUNDS.dieT[1]) err(d.name + ': die thickness outside 0.05 to 1.5 mm.', i);
  });
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
