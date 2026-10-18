// ===== UI: cross-section stress view =========================================
// The user clicks two points on a top-down map; the line snaps horizontal or vertical
// and the worker returns the stress on the vertical cut plane under it (C.sectionStress)
// from the top solder resist to the package top. The plot shades each cut element
// bilinearly between its nodal-averaged corner values.

const SECTION_QTY = [
  ['Invariants', [['vm', 'von Mises stress'], ['s1', 'maximum principal stress'], ['s3', 'minimum principal stress'], ['hyd', 'hydrostatic (mean) stress']]],
  ['Package axes', [['sxx', 'σxx'], ['syy', 'σyy'], ['szz', 'σzz'], ['txy', 'τxy'], ['tyz', 'τyz'], ['txz', 'τxz']]],
  ['Line frame', [['sss', 'σ along the line'], ['snn', 'σ across the line'], ['tsz', 'τ along the line and z'], ['tnz', 'τ across the line and z'], ['tsn', 'τ along and across the line']]],
];
const SECTION_EXAG = [['fit', 'fit to plot'], ['1', 'true scale (1×)'], ['5', '5×'], ['20', '20×']];
const SECTION_SNAP = 0.01;       // mm, endpoint rounding
const SECTION_PLOT_H = 340;      // px, default height of the section plot
const SECTION_CACHE_MAX = 30;    // cached sections (temperature x line)
const SECTION_CLICK_SLOP = 4;    // px of pointer travel that still counts as a click

function sectionQtyLabel(k) { for (const [, items] of SECTION_QTY) for (const [id, l] of items) if (id === k) return l; return k; }

/** Scalar of quantity qty from the six components at offset o of s (xx, yy, zz, xy, yz, xz); line along x or y. */
function sectionValue(qty, alongY, s, o, eig, tmp) {
  const xx = s[o], yy = s[o + 1], zz = s[o + 2], xy = s[o + 3], yz = s[o + 4], xz = s[o + 5];
  switch (qty) {
    case 'vm': return Math.sqrt(0.5 * ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) + 3 * (xy * xy + yz * yz + xz * xz));
    case 's1': case 's3': { for (let c = 0; c < 6; c++) tmp[c] = s[o + c]; const ev = eig(tmp); return qty === 's1' ? ev[0] : ev[2]; }
    case 'hyd': return (xx + yy + zz) / 3;
    case 'sxx': return xx; case 'syy': return yy; case 'szz': return zz;
    case 'txy': return xy; case 'tyz': return yz; case 'txz': return xz;
    case 'sss': return alongY ? yy : xx;
    case 'snn': return alongY ? xx : yy;
    case 'tsz': return alongY ? yz : xz;
    case 'tnz': return alongY ? xz : yz;
    default: return xy;  // 'tsn'
  }
}

/** Display name of the material of section quad q. */
function sectionPartName(sec, q) {
  const g = sec.groups[sec.grp[q]];
  if (sec.submodel) return g.name + (g.material ? ' (' + g.material + ')' : '');
  const part = sec.part[q] === C.PART.SUB ? 'Top solder resist' : C.PART_NAMES[sec.part[q]];
  return part + (g.material ? ' (' + g.material + ')' : '');
}

/** Quads shown for the bump-layer phase choice: the underfill phase hides solder; the solder phase hides underfill where both share a cell. */
function sectionVisible(sec, q, phase) {
  if (phase === 'all') return true;  // submodel sections: every voxel holds one material
  const p = sec.part[q];
  return phase === 'solder' ? !(p === C.PART.UF_BUMP && sec.pair[q]) : p !== C.PART.SOLDER;
}

function bisect(arr, v) {
  let lo = 0, hi = arr.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; }
  return lo;
}

/** Round a coordinate to the endpoint snap (printed without binary noise). */
function snapMm(v) { return +(Math.round(v / SECTION_SNAP) * SECTION_SNAP).toFixed(6); }

function sectionKey(T, s) { return [T, s.axis, s.c, s.a0, s.a1].join('|'); }

/** Ask the worker for the section at the selected temperature unless it is cached or on its way. */
function requestSection() {
  const s = app.section, T = app.selectedT, key = sectionKey(T, s);
  if (app.sectionCache.has(key) || app.sectionPending === key || app.analysisLost) return;
  app.sectionPending = key;
  setStatus('Evaluating the cross-section at ' + T + ' °C', 0.5);
  worker.send({ type: 'section', T, cut: s }).then(d => d, e => ({ error: e.message })).then(d => {
    if (d.error !== 'cancelled') app.sectionCache.set(key, d);  // a cancelled request is asked again once the analysis is back
    if (app.sectionCache.size > SECTION_CACHE_MAX) app.sectionCache.delete(app.sectionCache.keys().next().value);
    if (app.sectionPending === key) app.sectionPending = null;
    if (!app.job) setStatus('Ready', null);
    if (app.centerTab === 'results' && app.resultsView === 'section') renderCenter();
  });
}

function setSection(s) {
  const sub = app.results.geometry.substrate;
  const r = snapMm;
  const [lo, hi] = s.axis === 'x' ? [sub.x0, sub.x1] : [sub.y0, sub.y1];
  const [clo, chi] = s.axis === 'x' ? [sub.y0, sub.y1] : [sub.x0, sub.x1];
  const a0 = clampTo(r(Math.min(s.a0, s.a1)), lo, hi), a1 = clampTo(r(Math.max(s.a0, s.a1)), lo, hi);
  if (a1 - a0 < C.CONST.SECTION_MIN_LENGTH) { toast('The section line needs some length; click two separate points.', 'warn'); return; }
  app.section = { axis: s.axis, c: clampTo(r(s.c), clo, chi), a0, a1 };
  app.sectionDraft = null;
  if (app.sectionExag !== 'fit') app.sectionResize = true;
  renderCenter();
}

/** Package point (mm) under a pointer event on a mapCanvas. */
function mapPoint(cv, e) {
  const r = cv.getBoundingClientRect(), t = cv.__tx, v = cv.__view || { z: 1, cx: 0, cy: 0 };
  const sc = t.sc0 * v.z;
  return { x: v.cx + (e.clientX - r.left - t.w / 2) / sc, y: v.cy - (e.clientY - r.top - t.H / 2) / sc };
}

/** Line from a first point p to a second point q, snapped to the nearer of horizontal or vertical. */
function snappedLine(p, q) {
  return Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? { axis: 'x', c: p.y, a0: p.x, a1: q.x } : { axis: 'y', c: p.x, a0: p.y, a1: q.y };
}

function drawSectionLine(ctx, X, Y, s, color, dash) {
  const [xa, ya, xb, yb] = s.axis === 'x' ? [s.a0, s.c, s.a1, s.c] : [s.c, s.a0, s.c, s.a1];
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(X(xa), Y(ya)); ctx.lineTo(X(xb), Y(yb)); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
  ctx.fillStyle = color; ctx.font = '600 12px ' + cssVar('--font'); ctx.textBaseline = 'middle';
  for (const [x, y, l, dx, dy] of s.axis === 'x' ? [[xa, ya, 'B', -12, 0], [xb, yb, 'B′', 12, 0]] : [[xa, ya, 'B', 0, 12], [xb, yb, 'B′', 0, -12]]) {
    ctx.beginPath(); ctx.arc(X(x), Y(y), 3.5, 0, 6.3); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillText(l, X(x) + dx, Y(y) + dy);
  }
}

/** Top-down map with the section line; clicks set the endpoints. */
function sectionMap(res) {
  const g = res.geometry;
  const cv = mapCanvas(res, (ctx, X, Y, sc) => {
    const muted = cssVar('--muted');
    ctx.strokeStyle = muted; ctx.setLineDash([6, 4]);
    for (const part of [g.lid, g.stiff]) if (part) for (const r of [part.outer, part.inner]) ctx.strokeRect(X(r.x0), Y(r.y1), (r.x1 - r.x0) * sc, (r.y1 - r.y0) * sc);
    ctx.setLineDash([]);
    for (const d of g.dies) drawCornerNumbers(ctx, d.rect, X, Y);
    if (app.section) drawSectionLine(ctx, X, Y, app.section, cssVar('--accent2'));
    const p = app.sectionDraft;
    if (p) {
      ctx.fillStyle = cssVar('--accent'); ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 4, 0, 6.3); ctx.fill();
      if (cv.__hover) drawSectionLine(ctx, X, Y, snappedLine(p, cv.__hover), cssVar('--accent'), [5, 4]);
    }
  }, 320);
  cv.setAttribute('data-tip', TIPS.sectionMap);
  cv.style.cursor = 'crosshair';
  let down = null;
  const snapPt = e => { const p = mapPoint(cv, e), sub = g.substrate, r = snapMm; return { x: clampTo(r(p.x), sub.x0, sub.x1), y: clampTo(r(p.y), sub.y0, sub.y1) }; };
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  let started = false;  // this canvas set the first point with the latest click
  cv.addEventListener('click', e => {
    // the second click of a double-click (zoom reset) and the end of a pan are not endpoints
    if (e.detail > 1 || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > SECTION_CLICK_SLOP || !cv.__tx) return;
    const p = snapPt(e);
    if (!app.sectionDraft) { app.sectionDraft = p; started = true; cv.__hover = p; cv.__redraw(); return; }
    setSection(snappedLine(app.sectionDraft, p));
  });
  cv.addEventListener('dblclick', () => { if (started && app.sectionDraft) { app.sectionDraft = null; started = false; cv.__redraw(); } });
  cv.addEventListener('pointermove', e => {
    if (!app.sectionDraft || !cv.__tx || !cv.__redraw) return;
    cv.__hover = snapPt(e);
    if (!cv.__raf2) cv.__raf2 = requestAnimationFrame(() => { cv.__raf2 = 0; cv.__redraw(); });
  });
  return cv;
}

/** Corner values of the chosen quantity for every quad, and the lookup of visible quads by (segment, row). */
function sectionFields(sec, qty, phase) {
  const eig = C.eigSym3, tmp = new Float64Array(6), out = new Float64Array(3);
  const vals = new Float64Array(4 * sec.n);
  const alongY = sec.axis === 'y';
  for (let q = 0; q < sec.n; q++) for (let v = 0; v < 4; v++) vals[4 * q + v] = sectionValue(qty, alongY, sec.sig, 24 * q + 6 * v, s => eig(s, out), tmp);
  const nzs = sec.zl.length - 1, idx = new Int32Array((sec.sl.length - 1) * nzs).fill(-1);
  for (let q = 0; q < sec.n; q++) if (sectionVisible(sec, q, phase)) idx[sec.qa[q] * nzs + sec.qb[q]] = q;
  return { vals, idx, nzs };
}

/** Contour of the cut plane: bilinear shading per quad, material boundaries, optional element edges. */
function drawSectionPlot(cv, sec, F, scale, opts) {
  if (!sec.submodel && app.sectionResize && cv.isConnected) {
    // one-shot: size the plot so the chosen vertical exaggeration fits, and remember the height like a manual resize
    app.sectionResize = false;
    const key = canvasKey(cv), w0 = cv.getBoundingClientRect().width;
    if (app.sectionExag === 'fit') { if (key) delete app.layout.canvasH[key]; cv.style.height = SECTION_PLOT_H + 'px'; }
    else {
      const E = +app.sectionExag, want = 58 + (sec.zTop - sec.zMin) * E * Math.max(10, w0 - 72) / (sec.a1 - sec.a0);
      const H = Math.round(clampTo(want, LAYOUT_LIMITS.canvasH[0], LAYOUT_LIMITS.canvasH[1]));
      cv.style.height = H + 'px';
      if (key) app.layout.canvasH[key] = H;
    }
    saveLayout();
  }
  const { ctx, w, h: H } = setupCanvas(cv);
  ctx.clearRect(0, 0, w, H);
  const L = 58, R = 14, T = 22, B = 36;
  const pw = Math.max(10, w - L - R), ph = Math.max(10, H - T - B);
  cv.__tx = { L, T, pw, ph, bx0: sec.a0, bx1: sec.a1, by0: sec.zMin, by1: sec.zTop };
  let x0 = sec.a0, x1 = sec.a1, y0 = sec.zMin, y1 = sec.zTop;
  if (cv.__view) ({ x0, x1, y0, y1 } = cv.__view);
  cv.__map = { L, T, pw, ph, x0, x1, y0, y1 };
  plotZoom(cv, axisZoomHandlers(cv, 'xy'));
  const X = s => L + (s - x0) / (x1 - x0) * pw, Y = z => T + (y1 - z) / (y1 - y0) * ph;
  // raster at device resolution through a 256-entry colour table
  const dpr = cv.width / w, iw = Math.max(1, Math.round(pw * dpr)), ih = Math.max(1, Math.round(ph * dpr));
  const lut = new Uint8ClampedArray(256 * 3);
  for (let t = 0; t < 256; t++) lut.set(scale.rgb(scale.min + t / 255 * (scale.max - scale.min)), 3 * t);
  const img = ctx.createImageData(iw, ih), D = img.data;
  const colA = new Int32Array(iw), colT = new Float64Array(iw), rowB = new Int32Array(ih), rowT = new Float64Array(ih);
  for (let p = 0; p < iw; p++) { const s = x0 + (p + 0.5) / iw * (x1 - x0); if (s < sec.a0 || s > sec.a1) { colA[p] = -1; continue; } const a = bisect(sec.sl, s); colA[p] = a; colT[p] = (s - sec.sl[a]) / (sec.sl[a + 1] - sec.sl[a]); }
  const zRow = new Float64Array(ih);
  for (let r = 0; r < ih; r++) { const z = zRow[r] = y1 - (r + 0.5) / ih * (y1 - y0); if (z < sec.zMin || z > sec.zTop) { rowB[r] = -1; continue; } const b = bisect(sec.zl, z); rowB[r] = b; rowT[r] = (z - sec.zl[b]) / (sec.zl[b + 1] - sec.zl[b]); }
  const { vals, idx, nzs } = F, span = scale.max - scale.min || 1, grey = opts.grey || null;  // grey[q]: grey level of a context material, 0 = coloured
  for (let r = 0; r < ih; r++) {
    const b = rowB[r]; if (b < 0) continue;
    const tz = rowT[r];
    for (let p = 0; p < iw; p++) {
      const a = colA[p]; if (a < 0) continue;
      const q = idx[a * nzs + b]; if (q < 0) continue;
      const tx = colT[p], o = 4 * q;
      if (sec.topA[q] === sec.topA[q] && zRow[r] > sec.topA[q] + tx * (sec.topB[q] - sec.topA[q])) continue;  // above the fillet surface
      const di = 4 * (r * iw + p);
      if (grey && grey[q]) { D[di] = D[di + 1] = D[di + 2] = grey[q]; D[di + 3] = 255; continue; }
      const v = (1 - tx) * (1 - tz) * vals[o] + tx * (1 - tz) * vals[o + 1] + tx * tz * vals[o + 2] + (1 - tx) * tz * vals[o + 3];
      const li = 3 * Math.round(clampTo((v - scale.min) / span, 0, 1) * 255);
      D[di] = lut[li]; D[di + 1] = lut[li + 1]; D[di + 2] = lut[li + 2]; D[di + 3] = 255;
    }
  }
  ctx.putImageData(img, Math.round(L * dpr), Math.round(T * dpr));
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  const nsg = sec.sl.length - 1;
  const at = (a, b) => (a < 0 || b < 0 || a >= nsg || b >= nzs) ? -1 : idx[a * nzs + b];
  const seg = (xa, ya, xb, yb, dash) => { ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(X(xa), Y(ya)); ctx.lineTo(X(xb), Y(yb)); ctx.stroke(); };
  if (opts.mesh) {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.7;
    for (let q = 0; q < sec.n; q++) {
      if (!sectionVisible(sec, q, opts.phase)) continue;
      const s0 = sec.sl[sec.qa[q]], s1 = sec.sl[sec.qa[q] + 1], z0 = sec.zl[sec.qb[q]], z1 = sec.zl[sec.qb[q] + 1];
      seg(s0, z1, s1, z1); seg(s0, z0, s0, z1); seg(s1, z0, s1, z1);
      seg(s0, z0, s1, z0, sec.cutBelow[q] ? [3, 3] : null);  // dashed: the element continues below the solder resist
    }
  }
  // material boundaries: sides where the neighbour is void or another material
  ctx.strokeStyle = cssVar('--text'); ctx.lineWidth = 1.2;
  for (let q = 0; q < sec.n; q++) {
    if (!sectionVisible(sec, q, opts.phase)) continue;
    const a = sec.qa[q], b = sec.qb[q], g = sec.grp[q];
    const s0 = sec.sl[a], s1 = sec.sl[a + 1], z0 = sec.zl[b], z1 = sec.zl[b + 1];
    const differs = n => n < 0 || sec.grp[n] !== g;
    const tA = sec.topA[q], tB = sec.topB[q];
    if (tA === tA) {
      // partly filled fillet cell: its free surface is the wedge, drawn where it crosses the cell; edges facing void are not boundaries
      const solid = n => n >= 0 && sec.grp[n] !== g;
      if (solid(at(a - 1, b)) && tA > z0) seg(s0, z0, s0, Math.min(z1, tA));
      if (solid(at(a + 1, b)) && tB > z0) seg(s1, z0, s1, Math.min(z1, tB));
      if (differs(at(a, b - 1))) seg(s0, z0, s1, z0);
      const sAt = z => tB === tA ? NaN : s0 + (z - tA) / (tB - tA) * (s1 - s0);
      const ends = [[s0, tA], [s1, tB]].filter(([, t]) => t >= z0 && t <= z1);
      for (const z of [z0, z1]) { const s = sAt(z); if (s > s0 && s < s1) ends.push([s, z]); }
      if (ends.length >= 2) { ends.sort((p, r) => p[0] - r[0]); seg(ends[0][0], ends[0][1], ends[ends.length - 1][0], ends[ends.length - 1][1]); }
      continue;
    }
    if (differs(at(a - 1, b))) seg(s0, z0, s0, z1);
    if (differs(at(a + 1, b))) seg(s1, z0, s1, z1);
    if (differs(at(a, b - 1))) seg(s0, z0, s1, z0);
    if (differs(at(a, b + 1))) seg(s0, z1, s1, z1);
  }
  ctx.setLineDash([]);
  ctx.restore();
  // axes
  const text = cssVar('--text'), muted = cssVar('--muted');
  ctx.strokeStyle = cssVar('--grid'); ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
  ctx.font = '11px ' + cssVar('--font'); ctx.fillStyle = muted;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const t of ticks(x0, x1, 8)) { ctx.fillText(String(t), X(t), T + ph + 4); }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const t of ticks(y0, y1, 5)) ctx.fillText(String(t), L - 5, Y(t));
  ctx.fillStyle = text; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '600 12px ' + cssVar('--font');
  if (x0 <= sec.a0 + 1e-9) ctx.fillText('B', L + 3, T + 3);
  ctx.textAlign = 'right';
  if (x1 >= sec.a1 - 1e-9) ctx.fillText('B′', L + pw - 3, T + 3);
  const ex = (ph / (y1 - y0)) / (pw / (x1 - x0));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const lb = sec.labels || {};
  ctx.fillText(lb.title || (sectionQtyLabel(opts.qty) + ', MPa, at ' + sec.T + ' °C; vertical scale ×' + fmt(ex, ex < 10 ? 1 : 0)), L + pw / 2, 4);
  ctx.font = '11px ' + cssVar('--font'); ctx.textBaseline = 'bottom';
  ctx.fillText(lb.s || (sec.axis === 'x' ? 'x, mm (line at y = ' + sec.c + ' mm, seen from the −y side)' : 'y, mm (line at x = ' + sec.c + ' mm, seen from the +x side)'), L + pw / 2, H - 2);
  ctx.save(); ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText(lb.z || 'z, mm above the substrate bottom', 0, -6); ctx.restore();
}

/** Value under the pointer on the section plot. */
function sectionReadout(cv, sec, F, qty, e) {
  const m = cv.__map; if (!m) return '';
  const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (px < m.L || px > m.L + m.pw || py < m.T || py > m.T + m.ph) return '';
  const s = m.x0 + (px - m.L) / m.pw * (m.x1 - m.x0), z = m.y1 - (py - m.T) / m.ph * (m.y1 - m.y0);
  const lb = sec.labels || {}, unit = lb.unit || 'mm', dg = unit === 'µm' ? 1 : 3;
  const pos = (lb.sName || (sec.axis === 'x' ? 'x' : 'y')) + ' ' + fmt(s, dg) + ' ' + unit + ', ' + (lb.zName || 'z') + ' ' + fmt(z, dg + 1) + ' ' + unit;
  if (s < sec.a0 || s > sec.a1 || z < sec.zMin || z > sec.zTop) return pos;
  const a = bisect(sec.sl, s), b = bisect(sec.zl, z), q = F.idx[a * F.nzs + b];
  const tx = q < 0 ? 0 : (s - sec.sl[a]) / (sec.sl[a + 1] - sec.sl[a]);
  if (q < 0 || (sec.topA[q] === sec.topA[q] && z > sec.topA[q] + tx * (sec.topB[q] - sec.topA[q]))) return pos + ': void (no material)';
  const tz = (z - sec.zl[b]) / (sec.zl[b + 1] - sec.zl[b]), o = 4 * q, V = F.vals;
  const v = (1 - tx) * (1 - tz) * V[o] + tx * (1 - tz) * V[o + 1] + tx * tz * V[o + 2] + (1 - tx) * tz * V[o + 3];
  return pos + ': ' + sectionPartName(sec, q) + ', ' + sectionQtyLabel(qty) + ' ' + fmt(v, 2) + ' MPa';
}

function exportSectionCSV(sec) {
  const cs = sec.csv;  // submodel sections bring their own header, columns, point mapping and file name
  const lines = cs ? [cs.header, cs.columns] : ['# cross-section B-B\' at ' + sec.T + ' degC: line along ' + sec.axis + ' at ' + (sec.axis === 'x' ? 'y' : 'x') + ' = ' + sec.c + ' mm; nodal values averaged within each material; MPa',
    'x_mm,y_mm,z_mm,material,sxx,syy,szz,txy,tyz,txz'];
  const seen = new Set();
  for (let q = 0; q < sec.n; q++) [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([da, db], v) => {
    const a = sec.qa[q] + da, b = sec.qb[q] + db, key = sec.grp[q] + ':' + a + ':' + b;
    if (seen.has(key)) return;
    seen.add(key);
    const s = sec.sl[a], o = 24 * q + 6 * v;
    lines.push((cs ? cs.point(s, sec.zl[b]) : [sec.axis === 'x' ? s : sec.c, sec.axis === 'x' ? sec.c : s, sec.zl[b]]).concat('"' + sectionPartName(sec, q) + '"').concat(Array.from(sec.sig.subarray(o, o + 6), x => x.toPrecision(6))).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: (app.cfg.name || 'fcbga').replace(/[^\w.-]+/g, '_') + (cs ? cs.file : '_section_' + sec.T + 'C') + '.csv' });
  document.body.appendChild(a); a.click(); a.remove();
}

function renderSectionView(root, res, f, Tsel) {
  root.append(h('div', { class: 'row' }, h('b', null, 'Cross-section stress'), ' at ', Tsel, h('span', { class: 'conf' }, CONFIDENCE.section)));
  const qty = app.sectionQty, phase = app.sectionPhase, s = app.section;
  const sec = s ? app.sectionCache.get(sectionKey(app.selectedT, s)) : null;
  const qtySel = h('select', tip('sectionQty', { onchange: e => { app.sectionQty = e.target.value; renderCenter(); } }),
    ...SECTION_QTY.map(([g, items]) => h('optgroup', { label: g }, ...items.map(([k, l]) => h('option', { value: k, selected: k === qty ? '' : null }, l)))));
  const exagSel = h('select', tip('sectionExag', { onchange: e => { app.sectionExag = e.target.value; app.sectionResize = true; renderCenter(); } }), ...SECTION_EXAG.map(([k, l]) => h('option', { value: k, selected: k === app.sectionExag ? '' : null }, l)));
  const meshBox = h('label', tip('sectionMesh', { class: 'small' }), h('input', { type: 'checkbox', checked: app.sectionMesh ? '' : null, onchange: e => { app.sectionMesh = e.target.checked; renderCenter(); } }), ' element mesh');
  const phaseBtns = [['uf', 'Underfill phase', 'sectionPhaseUf'], ['solder', 'Solder phase', 'sectionPhaseSolder']].map(([k, l, t]) => h('button', tip(t, { class: phase === k ? 'primary small' : 'small', onclick: () => { app.sectionPhase = k; renderCenter(); } }), l));
  const ready = sec && !sec.error;
  // colour range: all materials on the cut, or one of them (others saturate)
  const parts = [];
  if (ready) for (let q = 0; q < sec.n; q++) if (sectionVisible(sec, q, phase) && !parts.includes(sec.part[q])) parts.push(sec.part[q]);
  if (ready && !parts.includes(+app.sectionRange)) app.sectionRange = 'all';
  const rangeSel = h('select', tip('sectionRange', { onchange: e => { app.sectionRange = e.target.value; renderCenter(); } }), h('option', { value: 'all' }, 'all materials'),
    ...parts.map(p => h('option', { value: String(p), selected: String(p) === app.sectionRange ? '' : null }, p === C.PART.SUB ? 'Top solder resist' : C.PART_NAMES[p])));
  root.append(h('div', { class: 'row' }, h('span', null, 'quantity ', qtySel), h('span', null, 'bump layer ', ...phaseBtns), meshBox, h('span', null, 'vertical scale ', exagSel), h('span', null, 'colour range ', rangeSel),
    ready ? h('button', tip('sectionCsv', { class: 'small', onclick: () => exportSectionCSV(sec) }), 'Export section CSV') : null));
  // map and line inputs | line summary
  const left = h('div');
  left.append(sectionMap(res));
  left.append(h('div', { class: 'small muted' }, app.sectionDraft ? 'First point set; click the second point (the line snaps horizontal or vertical). Esc cancels.' : 'Click two points on the map to draw a section line B–B′; it snaps horizontal or vertical.'));
  if (s) {
    const sub = res.geometry.substrate, alongY = s.axis === 'y';
    const [lo, hi] = alongY ? [sub.y0, sub.y1] : [sub.x0, sub.x1], [clo, chi] = alongY ? [sub.x0, sub.x1] : [sub.y0, sub.y1];
    const field = (label, k, min, max, help) => numField(label, () => app.section[k], v => { app.section[k] = v; }, { unit: 'mm', min, max, help, onSet: () => setSection(app.section) });
    const axisSel = h('select', tip('sectionAxis', { onchange: e => { const m = 0.5 * (s.a0 + s.a1), half = 0.5 * (s.a1 - s.a0); setSection({ axis: e.target.value, c: m, a0: s.c - half, a1: s.c + half }); } }),
      h('option', { value: 'x', selected: !alongY ? '' : null }, 'horizontal (along x)'), h('option', { value: 'y', selected: alongY ? '' : null }, 'vertical (along y)'));
    left.append(h('div', { class: 'row' }, h('span', null, 'line ', axisSel)),
      h('div', { class: 'grid2' }, field(alongY ? 'at x' : 'at y', 'c', clo, chi, 'sectionC'), field((alongY ? 'y' : 'x') + ' from (B)', 'a0', lo, hi, 'sectionEnds'), field((alongY ? 'y' : 'x') + ' to (B′)', 'a1', lo, hi, 'sectionEnds')));
  }
  const right = h('div');
  const vis = ready ? sectionFields(sec, qty, phase) : null;
  if (!s) right.append(h('div', { class: 'msg info' }, 'No section line yet. Click two points on the map; the stress on the vertical cut under the line, from the top solder resist to the package top, appears below.'));
  else if (ready) {
    const stats = new Map();
    for (let q = 0; q < sec.n; q++) {
      if (!sectionVisible(sec, q, phase)) continue;
      const name = sectionPartName(sec, q);
      const st = stats.get(name) || { lo: Infinity, hi: -Infinity };
      for (let v = 0; v < 4; v++) { st.lo = Math.min(st.lo, vis.vals[4 * q + v]); st.hi = Math.max(st.hi, vis.vals[4 * q + v]); }
      stats.set(name, st);
    }
    right.append(h('div', { class: 'card' }, h('h3', null, 'B–B′: ' + (s.axis === 'x' ? 'y = ' + s.c + ' mm, x from ' + s.a0 + ' to ' + s.a1 : 'x = ' + s.c + ' mm, y from ' + s.a0 + ' to ' + s.a1) + ' mm'),
      h('table', tip('sectionStats', { class: 'small' }), h('tr', null, h('th', null, 'Material on the cut'), h('th', null, 'min, MPa'), h('th', null, 'max, MPa')),
        ...Array.from(stats, ([name, st]) => h('tr', null, h('td', null, name), h('td', null, fmt(st.lo, 1)), h('td', null, fmt(st.hi, 1))))),
      h('div', { class: 'small muted' }, sectionQtyLabel(qty) + ' at the element corners (nodal values averaged within each material; never across interfaces).'),
      h('details', null, h('summary', null, 'What this means'), h('p', { class: 'small' }, 'The plot shows the stress on the vertical plane under the line, from the bottom of the top solder resist to the package top, at the selected temperature in the as-assembled state. In each element the plane cuts, stresses are evaluated at the 2 × 2 Gauss positions of the cut face, extrapolated to its corners and averaged with neighbouring elements of the same material only, so jumps at material interfaces are real and kept. The bump layer is homogenized: the underfill phase shows the underfill stress between the bumps, the solder phase shows the stress in the bumps themselves (iso-strain mixture), not the stress field around an individual joint. The solder resist lies inside one element together with the top build-up layers: as in laminate theory, its in-plane stresses come from that element\'s in-plane strain with the solder resist\'s own stiffness, and its through-thickness stresses (σzz, τxz, τyz) are the element\'s averages over the band. Polymers that pass their glass transition on cooling (solder resist, underfill, adhesives) carry the full mismatch from their stress-free temperature at their glassy modulus, because the model has no viscoelastic relaxation, so their stresses are upper bounds. Values at die corners, fillet edges and material interfaces are singular and mesh dependent: compare them between designs, do not read them as strengths.'))));
  } else if (sec && sec.error) right.append(h('div', { class: 'msg err' }, sec.error));
  else if (app.analysisLost) right.append(h('div', { class: 'msg warn' }, 'This section needs the analysis, which a cancelled job discarded; use Restore analysis above the results first.'));
  else { right.append(h('div', { class: 'msg info' }, 'Evaluating the section…')); requestSection(); }
  root.append(h('div', { class: 'grid2' }, left, right));
  if (!ready) return;
  // the contour across the full width
  let mn = Infinity, mx = -Infinity;
  const only = app.sectionRange === 'all' ? null : +app.sectionRange;
  for (let q = 0; q < sec.n; q++) {
    if (!sectionVisible(sec, q, phase) || (only !== null && sec.part[q] !== only)) continue;
    for (let v = 0; v < 4; v++) { const x = vis.vals[4 * q + v]; if (isFinite(x)) { mn = Math.min(mn, x); mx = Math.max(mx, x); } }
  }
  const scale = makeScale(mn, mx, qty !== 'vm' && mn < 0 && mx > 0);
  const cv = h('canvas', tip('sectionPlot', { class: 'map', style: 'width:100%;height:' + SECTION_PLOT_H + 'px' }));
  const readout = h('div', { class: 'small muted', style: 'min-height:1.4em' }, 'Point at the plot to read the value.');
  cv.addEventListener('pointermove', e => { readout.textContent = sectionReadout(cv, sec, vis, qty, e) || 'Point at the plot to read the value.'; });
  const sign = qty === 'vm' ? 'always positive' : ['s1', 's3', 'hyd', 'sxx', 'syy', 'szz', 'sss', 'snn'].includes(qty) ? 'tension positive' : 'sign follows the axes named';
  root.append(cv, legendRow(scale, sectionQtyLabel(qty) + ', MPa (' + sign + ')' + (only !== null ? '; range from ' + (only === C.PART.SUB ? 'the top solder resist' : C.PART_NAMES[only].toLowerCase()) + ' only, other materials saturate' : '') + '; bump layer: ' + (phase === 'uf' ? 'underfill phase' : 'solder phase')), readout,
    lineKey([{ label: 'material boundary', color: cssVar('--text') }].concat(app.sectionMesh ? [{ label: 'element edge', color: 'rgba(0,0,0,0.45)' }, { label: 'element continues below (cut at the solder resist bottom)', color: 'rgba(0,0,0,0.45)', dash: [3, 3] }] : [])));
  requestAnimationFrame(() => { const draw = () => drawSectionPlot(cv, sec, vis, scale, { qty, phase, mesh: app.sectionMesh }); autoRedraw(cv, draw); draw(); });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && app.sectionDraft) { app.sectionDraft = null; if (app.centerTab === 'results' && app.resultsView === 'section') renderCenter(); } });
