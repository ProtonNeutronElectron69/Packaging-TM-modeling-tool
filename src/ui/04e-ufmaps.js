// ===== UI: underfill traction contour maps ========================================
// An alternative to the perimeter line plots of the Underfill interface view: the
// traction field on one side of a die (or chiplet), unfolded at the die edge into one
// map, with the sidewall interface above the edge line and the active-face band below
// it. Up to UFMAP_MAX maps stack vertically for comparison, each with its own die and
// side; the quantity, the face band depth and the colour scale are shared. The worker
// samples each map (message tractionMap, core tractionMap); maps are cached per
// temperature, layer, die, side and depth in app.tractionCache.

const UFMAP_QTY = [['peel', 'peel (normal traction, tension positive)'], ['shear', 'shear traction magnitude'], ['along', 'shear along the side'], ['cross', 'shear across the side (sidewall: up; face: outward)']];
const UFMAP_DEPTHS = [0.25, 0.5, 1, 2];  // mm, width of the active-face band shown below the edge
const UFMAP_MAX = 4;                     // maps compared at once
const UFMAP_H = 200;                     // px, default height of one map
const UFMAP_SIDES = ['side 1-2 (−y edge)', 'side 2-3 (−x edge)', 'side 3-4 (+y edge)', 'side 4-1 (+x edge)'];
const TRACTION_CACHE_MAX = 40;           // cached maps

function ufMapQtyLabel(k) { const q = UFMAP_QTY.find(([id]) => id === k); return q ? q[1] : k; }

/** Dies (flip chip underfill) or chiplets (wafer underfill or mold) that a map can show. */
function ufMapObjects(f, wc) {
  return wc ? f.ddi.map(c => ({ label: c.name, obj: [c.module, c.chiplet] })) : f.dies.map((d, i) => ({ label: d.name, obj: i }));
}

function tractionKey(T, layer, obj, side, depth) { return [T, layer, String(obj), side, depth].join('|'); }

/** Ask the worker for one map unless it is cached or on its way. */
function requestTractionMap(T, layer, obj, side, depth) {
  const key = tractionKey(T, layer, obj, side, depth);
  if (app.tractionCache.has(key) || app.tractionPending.has(key) || app.analysisLost) return;
  app.tractionPending.add(key);
  setStatus('Evaluating the underfill traction map at ' + T + ' °C', 0.5);
  worker.send({ type: 'tractionMap', T, layer, obj, side, depth }).then(d => d, e => ({ error: e.message })).then(d => {
    if (d.error !== 'cancelled') app.tractionCache.set(key, d);  // a cancelled request is asked again once the analysis is back
    if (app.tractionCache.size > TRACTION_CACHE_MAX) app.tractionCache.delete(app.tractionCache.keys().next().value);
    app.tractionPending.delete(key);
    if (!app.job && !app.tractionPending.size) setStatus('Ready', null);
    if (app.centerTab === 'results' && app.resultsView === 'uf' && app.ufMode === 'maps') renderCenter();
  });
}

/** Value of quantity qty at grid entry o of one part (wall or face) of a map. */
function ufMapValue(part, qty, o) {
  if (qty === 'shear') return Math.hypot(part.along[o], part.cross[o]);
  return part[qty][o];
}

/** Value at (s, v) on a map: v > 0 up the sidewall, v < 0 into the active face (mm); bilinear between sample centres, nearest next to a gap. */
function ufMapAt(M, qty, s, v) {
  const up = v >= 0, part = up ? M.wall : M.face, ext = up ? M.hSide : M.depth;
  if (s < 0 || s > M.L || Math.abs(v) > ext || !(ext > 0)) return NaN;
  const fc = clampTo(s / M.L * M.m - 0.5, 0, M.m - 1), fr = clampTo(Math.abs(v) / ext * M.nr - 0.5, 0, M.nr - 1);
  const c0 = Math.floor(fc), r0 = Math.floor(fr), c1 = Math.min(M.m - 1, c0 + 1), r1 = Math.min(M.nr - 1, r0 + 1), tc = fc - c0, tr = fr - r0;
  const a = ufMapValue(part, qty, r0 * M.m + c0), b = ufMapValue(part, qty, r0 * M.m + c1), c = ufMapValue(part, qty, r1 * M.m + c1), d = ufMapValue(part, qty, r1 * M.m + c0);
  if (a === a && b === b && c === c && d === d) return (1 - tc) * (1 - tr) * a + tc * (1 - tr) * b + tc * tr * c + (1 - tc) * tr * d;
  return ufMapValue(part, qty, Math.round(fr) * M.m + Math.round(fc));
}

/** Range of quantity qty over a map's samples. */
function ufMapRange(M, qty) {
  let lo = Infinity, hi = -Infinity;
  for (const part of [M.wall, M.face]) for (let o = 0; o < M.m * M.nr; o++) { const x = ufMapValue(part, qty, o); if (x === x) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
  return [lo, hi];
}

/** Contour of one map: position along the side across, sidewall height up and face depth down from the edge line (µm). */
function drawUfMap(cv, M, qty, scale, title) {
  const { ctx, w, h: H } = setupCanvas(cv);
  ctx.clearRect(0, 0, w, H);
  const L = 58, R = 14, T = 22, B = 34;
  const pw = Math.max(10, w - L - R), ph = Math.max(10, H - T - B);
  const vTop = M.hSide * 1000, vBot = -M.depth * 1000;
  cv.__tx = { L, T, pw, ph, bx0: 0, bx1: M.L, by0: vBot, by1: vTop };
  let x0 = 0, x1 = M.L, y0 = vBot, y1 = vTop;
  if (cv.__view) ({ x0, x1, y0, y1 } = cv.__view);
  cv.__map = { L, T, pw, ph, x0, x1, y0, y1 };
  plotZoom(cv, axisZoomHandlers(cv, 'xy'));
  const X = s => L + (s - x0) / (x1 - x0) * pw, Y = v => T + (y1 - v) / (y1 - y0) * ph;
  // raster at device resolution through a 256-entry colour table; gaps (no underfill at the point) left blank
  const dpr = cv.width / w, iw = Math.max(1, Math.round(pw * dpr)), ih = Math.max(1, Math.round(ph * dpr));
  const lut = new Uint8ClampedArray(256 * 3);
  for (let t = 0; t < 256; t++) lut.set(scale.rgb(scale.min + t / 255 * (scale.max - scale.min)), 3 * t);
  const img = ctx.createImageData(iw, ih), D = img.data, span = scale.max - scale.min || 1;
  for (let r = 0; r < ih; r++) {
    const v = (y1 - (r + 0.5) / ih * (y1 - y0)) / 1000;
    for (let p = 0; p < iw; p++) {
      const x = ufMapAt(M, qty, x0 + (p + 0.5) / iw * (x1 - x0), v);
      if (x !== x) continue;
      const li = 3 * Math.round(clampTo((x - scale.min) / span, 0, 1) * 255), di = 4 * (r * iw + p);
      D[di] = lut[li]; D[di + 1] = lut[li + 1]; D[di + 2] = lut[li + 2]; D[di + 3] = 255;
    }
  }
  ctx.putImageData(img, Math.round(L * dpr), Math.round(T * dpr));
  const text = cssVar('--text'), muted = cssVar('--muted');
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  // the die edge, where the sidewall meets the active face
  ctx.strokeStyle = text; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(L + pw, Y(0)); ctx.stroke();
  ctx.font = '11px ' + cssVar('--font'); ctx.fillStyle = text; ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom'; if (Y(0) - T > 14) ctx.fillText('sidewall ↑', L + 4, Y(0) - 2);
  ctx.textBaseline = 'top'; if (T + ph - Y(0) > 14) ctx.fillText('active face ↓', L + 4, Y(0) + 2);
  ctx.restore();
  // axes
  ctx.strokeStyle = cssVar('--grid'); ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
  ctx.font = '11px ' + cssVar('--font'); ctx.fillStyle = muted;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const t of ticks(x0, x1, 8)) ctx.fillText(String(t), X(t), T + ph + 4);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const t of ticks(y0, y1, 4)) ctx.fillText(String(Math.abs(t)), L - 5, Y(t));
  ctx.fillStyle = text; ctx.font = '600 12px ' + cssVar('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(title, L + pw / 2, 4);
  ctx.font = '11px ' + cssVar('--font'); ctx.textBaseline = 'bottom';
  ctx.fillText('position along the side, mm, from corner ' + M.from + ' (left) to corner ' + M.to + ' (right)', L + pw / 2, H - 2);
  ctx.save(); ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText('µm from the edge', 0, -6); ctx.restore();
}

/** Value under the pointer on a map. */
function ufMapReadout(cv, M, qty, e) {
  const m = cv.__map; if (!m) return '';
  const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (px < m.L || px > m.L + m.pw || py < m.T || py > m.T + m.ph) return '';
  const s = m.x0 + (px - m.L) / m.pw * (m.x1 - m.x0), v = m.y1 - (py - m.T) / m.ph * (m.y1 - m.y0);
  const where = fmt(s, 3) + ' mm from corner ' + M.from + ', ' + (v >= 0 ? fmt(v, 1) + ' µm up the sidewall' : fmt(-v, 1) + ' µm in from the edge on the active face');
  const x = ufMapAt(M, qty, s, v / 1000);
  return where + ': ' + (x === x ? fmt(x, 2) + ' MPa' : 'no underfill at this point');
}

function renderUFMaps(root, f, wc, fill) {
  const layer = wc ? 'wcuf' : 'fli', objs = ufMapObjects(f, wc), T = app.selectedT, depth = app.ufMapDepth, qty = app.ufMapQty;
  app.ufMaps = app.ufMaps || {};
  const slots = app.ufMaps[layer] = (app.ufMaps[layer] || [{ o: 0, side: 0 }]).filter(sl => sl.o < objs.length).slice(0, UFMAP_MAX);
  if (!slots.length) slots.push({ o: 0, side: 0 });
  const qtySel = h('select', tip('ufMapQty', { onchange: e => { app.ufMapQty = e.target.value; renderCenter(); } }), ...UFMAP_QTY.map(([k, l]) => h('option', { value: k, selected: k === qty ? '' : null }, l)));
  const depthSel = h('select', tip('ufMapDepth', { onchange: e => { app.ufMapDepth = +e.target.value; renderCenter(); } }), ...UFMAP_DEPTHS.map(d => h('option', { value: d, selected: d === depth ? '' : null }, fmt(d * 1000, 0) + ' µm')));
  const sharedBox = h('label', tip('ufMapShared', { class: 'small' }), h('input', { type: 'checkbox', checked: app.ufMapShared ? '' : null, onchange: e => { app.ufMapShared = e.target.checked; renderCenter(); } }), ' one colour scale for all maps');
  const addBtn = h('button', tip('ufMapAdd', { class: 'small', disabled: slots.length >= UFMAP_MAX ? '' : null, onclick: () => { const last = slots[slots.length - 1]; slots.push({ o: last.o, side: (last.side + 1) % 4 }); renderCenter(); } }), '+ Add map');
  root.append(h('div', { class: 'row' }, h('span', null, 'quantity ', qtySel), h('span', null, 'active-face band ', depthSel), sharedBox, addBtn, h('span', { class: 'small muted' }, slots.length + ' of ' + UFMAP_MAX + ' maps')));
  // the maps on hand; the rest are requested
  const maps = slots.map(sl => {
    const M = app.tractionCache.get(tractionKey(T, layer, objs[sl.o].obj, sl.side, depth));
    if (!M) requestTractionMap(T, layer, objs[sl.o].obj, sl.side, depth);
    return M && !M.error ? M : null;
  });
  const signedOf = (lo, hi) => qty !== 'shear' && lo < 0 && hi > 0;
  let shared = null;
  if (app.ufMapShared) {
    let lo = Infinity, hi = -Infinity;
    for (const M of maps) if (M) { const [a, b] = ufMapRange(M, qty); lo = Math.min(lo, a); hi = Math.max(hi, b); }
    if (isFinite(lo)) shared = makeScale(lo, hi, signedOf(lo, hi));
  }
  const unitNote = ', MPa at ' + T + ' °C (' + (qty === 'shear' ? 'always positive' : qty === 'peel' ? 'tension positive' : qty === 'along' ? 'positive toward the second corner of the side' : 'positive up the sidewall and outward on the face') + ')';
  if (shared) root.append(legendRow(shared, ufMapQtyLabel(qty) + unitNote + '; one scale for all maps'));
  slots.forEach((sl, i) => {
    const objSel = h('select', tip('ufMapObj', { onchange: e => { sl.o = +e.target.value; renderCenter(); } }), ...objs.map((ob, k) => h('option', { value: k, selected: k === sl.o ? '' : null }, ob.label)));
    const sideSel = h('select', tip('ufMapSide', { onchange: e => { sl.side = +e.target.value; renderCenter(); } }), ...UFMAP_SIDES.map((l, k) => h('option', { value: k, selected: k === sl.side ? '' : null }, l)));
    const rm = h('button', tip('ufMapRemove', { class: 'small', disabled: slots.length <= 1 ? '' : null, onclick: () => { slots.splice(i, 1); renderCenter(); } }), '× Remove');
    const card = h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', null, 'Map ' + (i + 1)), h('span', null, wc ? 'chiplet ' : 'die ', objSel), h('span', null, sideSel), rm));
    root.append(card);
    const M = maps[i], cached = app.tractionCache.get(tractionKey(T, layer, objs[sl.o].obj, sl.side, depth));
    if (!M) {
      if (cached && cached.error) card.append(h('div', { class: 'msg err' }, cached.error));
      else if (app.analysisLost) card.append(h('div', { class: 'msg warn' }, analysisMissing('This map needs')));
      else card.append(h('div', { class: 'msg info' }, 'Evaluating the map…'));
      return;
    }
    const [lo, hi] = ufMapRange(M, qty);
    const scale = shared || makeScale(isFinite(lo) ? lo : 0, isFinite(hi) ? hi : 0, signedOf(lo, hi));
    const title = M.name + ', side ' + M.from + '-' + M.to + ': ' + ufMapQtyLabel(qty) + ', MPa';
    const cv = h('canvas', tip('ufMapPlot', { class: 'map', style: 'width:100%;height:' + UFMAP_H + 'px' }));
    const hint = 'Point at the map to read the value.';
    const readout = h('div', { class: 'small muted', style: 'min-height:1.4em' }, hint);
    cv.addEventListener('pointermove', e => { readout.textContent = ufMapReadout(cv, M, qty, e) || hint; });
    card.append(cv);
    if (!shared) card.append(legendRow(scale, ufMapQtyLabel(qty) + unitNote));
    card.append(h('div', { class: 'small' }, 'range on this side ' + (isFinite(lo) ? fmt(lo, 1) + ' to ' + fmt(hi, 1) + ' MPa' : 'none') + '; sidewall ' + fmt(M.hSide * 1000, 0) + ' µm high (to the ' + (wc ? 'chiplet top' : 'fillet top') + '), active-face band ' + fmt(M.depth * 1000, 0) + ' µm wide' + (M.depth < depth - 1e-9 ? ' (half the ' + (wc ? 'chiplet' : 'die') + ' width across this side)' : '')), readout);
    requestAnimationFrame(() => { const draw = () => drawUfMap(cv, M, qty, scale, title); autoRedraw(cv, draw); draw(); });
  });
  root.append(h('details', null, h('summary', null, 'What this means'),
    h('p', { class: 'small' }, 'Each map unfolds one side of the ' + (wc ? 'chiplet' : 'die') + ' at its bottom edge: above the line is the sidewall interface with the ' + (wc ? fill + ' (from the DDI gap up the chiplet side)' : 'underfill fillet (from the active face up to the fillet top)') + ', below it the active face interface with the ' + (wc ? 'DDI fill' : 'bump-layer underfill') + ', from the edge inward. The horizontal axis runs along the side from its first corner to its second, so the die corners are at the left and right ends.'),
    h('p', { class: 'small' }, 'Values are point tractions of the ' + (wc ? 'fill' : 'underfill') + '-side stress next to the interface, sampled every ' + fmt(C.CONST.TRACTION_MAP_DS * 1000, 0) + ' µm along the side and on ' + C.CONST.TRACTION_MAP_ROWS + ' rows through each part, without the 50 µm patch averaging of the perimeter plots, so peaks can be higher than the line plots show. Peel is the traction normal to the interface (tension positive); the shear components lie in the interface plane. Blank areas have no underfill at that point (for example above a short fillet next to a neighbouring die). The die corners and the edge line are singular: compare designs and sides by these maps, do not read the values as strengths.')));
}
