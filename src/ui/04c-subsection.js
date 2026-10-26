// ===== UI: bump submodel cross-section stress view ================================
// Stress on a vertical cut through one bump submodel (one pitch cell around a solder
// joint) at the end of each ramp and dwell of the last simulated cycle. The core
// (C.submodelSection) cuts the corner stresses stored with the submodel result; the
// plot reuses the package cross-section drawing (drawSectionPlot) in micrometres
// from the bump axis and from the substrate top.

const SUBSEC_FOCUS = [['uf', 'underfill (others grey)'], ['solder', 'solder (others grey)'], ['all', 'all materials']];
const SUBSEC_GROUP = { uf: 2, solder: 1 };  // submodel material groups: 0 substrate slice, 1 solder, 2 underfill, 3 silicon
const SUBSEC_GREY = { light: [205, 178, 192, 226], dark: [72, 98, 85, 112] };  // grey level per group when shown as context
const SUBSEC_PLOT_H = 420;  // px, default height of the plot
const SUBSEC_PLAN_H = 260;  // px, height of the plan view of the pitch cell

function subSecKey(sm) { return sm.dieIdx + ':' + sm.site.ix + ':' + sm.site.iy; }

/** Plain-language name of a stored moment of the last cycle. */
function subSecMoment(snap) {
  const T = fmt(snap.T, 0) + ' °C';
  const what = { 'ramp up': 'end of ramp to ' + T + ' (start of hot dwell)', 'dwell hot': 'end of hot dwell at ' + T, 'ramp down': 'end of ramp to ' + T + ' (start of cold dwell)', 'dwell cold': 'end of cold dwell at ' + T }[snap.phase] || T;
  return 'cycle ' + snap.cycle + ', ' + what;
}

/** Plan view of the pitch cell: voxel grid, joint outline, the cut line and the direction to the die centre; a click moves the cut. */
function subSecPlan(sm, st, nAcross) {
  const S = sm.section;
  const cv = h('canvas', tip('subSecPlan', { class: 'map', style: 'width:100%;height:' + SUBSEC_PLAN_H + 'px;cursor:crosshair' }));
  const px = S.xs[S.xs.length - 1] - S.xs[0], py = S.ys[S.ys.length - 1] - S.ys[0];
  let tx = null;
  const draw = () => {
    const { ctx, w, h: H } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, H);
    const pad = 26, sc = Math.min((w - 2 * pad) / px, (H - 2 * pad) / py);
    if (!(sc > 0)) return;  // not laid out yet (a results file opens straight into this view); drawn again on resize
    const X = x => w / 2 + (x - S.cx) * sc, Y = y => H / 2 - (y - S.cy) * sc;
    tx = { X, Y, sc, w, H };
    const grid = cssVar('--grid'), text = cssVar('--text'), muted = cssVar('--muted');
    ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
    ctx.fillRect(X(S.xs[0]), Y(S.ys[S.ys.length - 1]), px * sc, py * sc);
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    for (const x of S.xs) { ctx.beginPath(); ctx.moveTo(X(x), Y(S.ys[0])); ctx.lineTo(X(x), Y(S.ys[S.ys.length - 1])); ctx.stroke(); }
    for (const y of S.ys) { ctx.beginPath(); ctx.moveTo(X(S.xs[0]), Y(y)); ctx.lineTo(X(S.xs[S.xs.length - 1]), Y(y)); ctx.stroke(); }
    // joint outline: widest section solid, die-side (UBM) and substrate-side (SRO) diameters dashed
    ctx.strokeStyle = text; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(X(S.cx), Y(S.cy), S.radii.max * sc, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([4, 3]); ctx.strokeStyle = muted;
    for (const r of [S.radii.top, S.radii.bottom]) { ctx.beginPath(); ctx.arc(X(S.cx), Y(S.cy), r * sc, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.setLineDash([]);
    // direction to the die centre
    const dx = S.dieCx - S.cx, dy = S.dieCy - S.cy, dl = Math.hypot(dx, dy);
    if (dl > 1e-9) {
      const L = 0.42 * Math.min(px, py), ex = S.cx + dx / dl * L, ey = S.cy + dy / dl * L;
      ctx.strokeStyle = muted; ctx.fillStyle = muted; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(X(S.cx), Y(S.cy)); ctx.lineTo(X(ex), Y(ey)); ctx.stroke();
      const a = Math.atan2(-(dy / dl), dx / dl);
      ctx.beginPath(); ctx.moveTo(X(ex), Y(ey)); ctx.lineTo(X(ex) - 8 * Math.cos(a - 0.4), Y(ey) - 8 * Math.sin(a - 0.4)); ctx.lineTo(X(ex) - 8 * Math.cos(a + 0.4), Y(ey) - 8 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
      ctx.font = '11px ' + cssVar('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('die centre', X(ex) + 10 * Math.cos(a) * 3, Y(ey) + 10 * Math.sin(a) * 1.6);
    }
    // the cut
    const alongY = st.axis === 'y', c = (alongY ? S.xs : S.ys)[st.pos];
    const seg = alongY ? [c, S.ys[0], c, S.ys[S.ys.length - 1]] : [S.xs[0], c, S.xs[S.xs.length - 1], c];
    drawSectionLine(ctx, X, Y, alongY ? { axis: 'y', c, a0: seg[1], a1: seg[3] } : { axis: 'x', c, a0: seg[0], a1: seg[2] }, cssVar('--accent2'));
  };
  cv.addEventListener('click', e => {
    if (!tx) return;
    const r = cv.getBoundingClientRect();
    const x = S.cx + (e.clientX - r.left - tx.w / 2) / tx.sc, y = S.cy - (e.clientY - r.top - tx.H / 2) / tx.sc;
    const lines = st.axis === 'y' ? S.xs : S.ys, v = st.axis === 'y' ? x : y;
    let best = 0;
    for (let q = 1; q < lines.length; q++) if (Math.abs(lines[q] - v) < Math.abs(lines[best] - v)) best = q;
    st.pos = Math.max(0, Math.min(nAcross, best));
    renderCenter();
  });
  requestAnimationFrame(() => { autoRedraw(cv, draw); draw(); });
  return cv;
}

function renderSubmodelSectionView(root) {
  root.append(h('div', { class: 'row' }, h('b', null, 'Submodel cross-section stress'), h('span', { class: 'conf' }, CONFIDENCE.subSection)));
  const list = app.submodels.filter(sm => sm.section && sm.section.snaps.length);
  if (!list.length) {
    root.append(h('div', { class: 'msg info' }, app.submodels.length ? 'These submodel results carry no stress fields; run the bump submodels again.' : 'Run bump submodels first (Solder fatigue tab, "Run bump submodels for selected sites"); each submodel stores the stress field of its last cycle for this view.'),
      h('button', tip('viewFatigue', { class: 'small', onclick: () => { app.resultsView = 'fatigue'; renderCenter(); } }), 'Go to Solder fatigue'));
    return;
  }
  const st = app.subSection;
  let sm = list.find(x => subSecKey(x) === st.key);
  if (!sm) { sm = list[0]; st.key = subSecKey(sm); st.snap = null; st.pos = null; }
  const S = sm.section;
  if (st.snap === null || st.snap >= S.snaps.length) st.snap = S.snaps.length - 1;  // default: end of the cold dwell
  const nAcross = (st.axis === 'y' ? S.xs : S.ys).length - 1;
  if (st.pos === null || st.pos > nAcross) st.pos = Math.round(nAcross / 2);  // default: through the bump axis
  const total = st.total && !!S.residual;
  const sec = C.submodelSection(sm, st.snap, st.axis, st.pos, total);
  const snap = S.snaps[st.snap];
  const what = total ? 'total stress (as-assembled 25 °C stress plus the change)' : 'change from the as-assembled 25 °C state';
  const sName = st.axis === 'x' ? 'x − x_bump' : 'y − y_bump', cName = st.axis === 'x' ? 'y − y_bump' : 'x − x_bump';
  sec.labels = {
    title: sectionQtyLabel(st.qty) + ', MPa, ' + what + '; ' + subSecMoment(snap),
    s: sName + ', µm (cut at ' + cName + ' = ' + fmt(sec.c, 1) + ' µm, seen from the ' + (st.axis === 'x' ? '−y' : '+x') + ' side)',
    z: 'z above the substrate top, µm', unit: 'µm', sName, zName: 'z',
  };
  const ax = st.axis === 'x' ? 'x' : 'y', cx = st.axis === 'x' ? 'y' : 'x';
  sec.csv = {
    header: '# bump submodel ' + sm.die + ' at (' + sm.site.x + ', ' + sm.site.y + ') mm, ' + subSecMoment(snap) + (total ? '; total stress (as-assembled 25 degC stress of the global model per voxel plus the change)' : '; stress change from the as-assembled 25 degC state') + '; cut along ' + ax + ' at ' + cx + ' - ' + cx + '_bump = ' + sec.c + ' um; corner values averaged within each material; MPa',
    columns: 'x_mm,y_mm,z_mm,material,sxx,syy,szz,txy,tyz,txz',
    point: (s, z) => { const a = s / 1000, c = sec.c / 1000, zz = z / 1000 + S.zt; return st.axis === 'x' ? [+(S.cx + a).toFixed(6), +(S.cy + c).toFixed(6), +zz.toFixed(6)] : [+(S.cx + c).toFixed(6), +(S.cy + a).toFixed(6), +zz.toFixed(6)]; },
    file: '_submodel_' + sm.die.replace(/[^\w.-]+/g, '_') + '_' + sm.site.ix + '_' + sm.site.iy + '_' + snap.phase.replace(/ /g, '_') + '_' + fmt(snap.T, 0) + 'C',
  };
  const smSel = h('select', tip('subSecModel', { onchange: e => { st.key = e.target.value; st.snap = null; st.pos = null; renderCenter(); } }),
    ...list.map(x => h('option', { value: subSecKey(x), selected: x === sm ? '' : null }, x.die + ' bump at (' + fmt(x.site.x, 2) + ', ' + fmt(x.site.y, 2) + ') mm')));
  const snapSel = h('select', tip('subSecMoment', { onchange: e => { st.snap = +e.target.value; renderCenter(); } }),
    ...S.snaps.map((s, i) => h('option', { value: i, selected: i === st.snap ? '' : null }, subSecMoment(s))));
  const axisSel = h('select', tip('subSecAxis', { onchange: e => { st.axis = e.target.value; st.pos = null; renderCenter(); } }),
    h('option', { value: 'x', selected: st.axis === 'x' ? '' : null }, 'along x'), h('option', { value: 'y', selected: st.axis === 'y' ? '' : null }, 'along y'));
  const posIn = h('input', tip('subSecPos', { type: 'range', class: 'grow', min: 0, max: nAcross, step: 1, value: st.pos, onchange: e => { st.pos = +e.target.value; renderCenter(); } }));
  const qtySel = h('select', tip('sectionQty', { onchange: e => { st.qty = e.target.value; renderCenter(); } }),
    ...SECTION_QTY.map(([g, items]) => h('optgroup', { label: g }, ...items.map(([k, l]) => h('option', { value: k, selected: k === st.qty ? '' : null }, l)))));
  const focusSel = h('select', tip('subSecFocus', { onchange: e => { st.focus = e.target.value; renderCenter(); } }), ...SUBSEC_FOCUS.map(([k, l]) => h('option', { value: k, selected: k === st.focus ? '' : null }, l)));
  const meshBox = h('label', tip('subSecMesh', { class: 'small' }), h('input', { type: 'checkbox', checked: st.mesh ? '' : null, onchange: e => { st.mesh = e.target.checked; renderCenter(); } }), ' voxel mesh');
  const totalSel = h('select', tip('subSecTotal', { disabled: S.residual ? null : '', onchange: e => { st.total = e.target.value === 'total'; renderCenter(); } }),
    h('option', { value: 'change', selected: total ? null : '' }, 'change from 25 °C'), h('option', { value: 'total', selected: total ? '' : null }, 'total stress'));
  root.append(h('div', { class: 'row' }, h('span', null, 'submodel ', smSel), h('span', null, 'moment ', snapSel), h('span', null, 'stress ', totalSel)),
    h('div', { class: 'row' }, h('span', null, 'cut ', axisSel), h('span', { class: 'grow row' }, 'position ', posIn, h('span', { class: 'small muted' }, fmt(sec.c, 1) + ' µm from the bump axis')), h('span', null, 'quantity ', qtySel), h('span', null, 'show ', focusSel), meshBox,
      h('button', tip('subSecCsv', { class: 'small', onclick: () => exportSectionCSV(sec) }), 'Export section CSV')));
  // values: all corners, or the focused material only
  const F = sectionFields(sec, st.qty, 'all');
  const focusGrp = SUBSEC_GROUP[st.focus];
  const shown = q => focusGrp === undefined || sec.grp[q] === focusGrp;
  const stats = new Map();
  let mn = Infinity, mx = -Infinity;
  for (let q = 0; q < sec.n; q++) {
    const name = sectionPartName(sec, q), s = stats.get(name) || { lo: Infinity, hi: -Infinity, grp: sec.grp[q] };
    for (let v = 0; v < 4; v++) {
      const x = F.vals[4 * q + v];
      s.lo = Math.min(s.lo, x); s.hi = Math.max(s.hi, x);
      if (shown(q) && isFinite(x)) { mn = Math.min(mn, x); mx = Math.max(mx, x); }
    }
    stats.set(name, s);
  }
  const left = h('div', null, subSecPlan(sm, st, nAcross), h('div', { class: 'small muted' }, 'Pitch cell around the bump, seen from the top: voxel grid, widest joint outline (solid) and the die-side and substrate-side pad diameters (dashed). Click to move the cut to the nearest grid line.'));
  const right = h('div', null, h('div', { class: 'card' }, h('h3', null, sm.die + ' bump at (' + fmt(sm.site.x, 2) + ', ' + fmt(sm.site.y, 2) + ') mm, ' + sm.nxy + ' × ' + sm.nxy + ' × ' + sm.nz + ' voxels'),
    h('table', tip('subSecStats', { class: 'small' }), h('tr', null, h('th', null, 'Material on the cut'), h('th', null, 'min, MPa'), h('th', null, 'max, MPa')),
      ...Array.from(stats, ([name, s]) => h('tr', null, h('td', null, name), h('td', null, fmt(s.lo, 1)), h('td', null, fmt(s.hi, 1))))),
    h('div', { class: 'small muted' }, sectionQtyLabel(st.qty) + ' at the voxel corners on the cut (values averaged within each material, never across interfaces), ' + subSecMoment(snap) + '.'),
    h('details', null, h('summary', null, 'What this means'),
      h('p', { class: 'small' }, 'The bump submodel resolves one solder joint as a truncated sphere surrounded by underfill, between a slice of the die and a slice of the substrate, in a voxel grid of one bump pitch. It is driven by the global displacements on its cut faces and steps through the temperature cycles with the Anand solder model. This view shows the stress on a vertical plane through that cell at the end of each ramp and dwell of the last cycle, so the underfill stress next to the joint, at the joint neck and at the pad edges becomes visible, which the homogenized bump layer of the global model cannot show.'),
      h('p', { class: 'small' }, 'The submodel works relative to the as-assembled state at 25 °C: by default the stresses shown are the change caused by the temperature cycle. "Total stress" adds the residual assembly stress at 25 °C from the global model (the underfill from its cure temperature down to 25 °C, the silicon and the substrate layer at each voxel), constant within each voxel, so the underfill shows its full tension or compression; the global model gives that residual for the homogenized layer, not around the joint itself. The solder starts stress-free at 25 °C, assuming room-temperature relaxation.'),
      h('p', { class: 'small' }, 'The joint is stair-stepped on the voxel grid, so the corners where the solder meets the pads and the underfill are singular and mesh dependent: compare peak values between designs and bump locations, do not read them as strengths. A cut that runs along a voxel face between two materials shows the voxel nearer the bump axis.'))));
  root.append(h('div', { class: 'grid2' }, left, right));
  // contour across the full width
  const dark = isDark(), greys = dark ? SUBSEC_GREY.dark : SUBSEC_GREY.light;
  const grey = new Uint8Array(sec.n);
  if (focusGrp !== undefined) for (let q = 0; q < sec.n; q++) if (sec.grp[q] !== focusGrp) grey[q] = greys[sec.grp[q]];
  if (!isFinite(mn)) { mn = 0; mx = 0; }
  const scale = makeScale(mn, mx, st.qty !== 'vm' && mn < 0 && mx > 0);
  const cv = h('canvas', tip('subSecPlot', { class: 'map', style: 'width:100%;height:' + SUBSEC_PLOT_H + 'px' }));
  const hint = 'Point at the plot to read the value.';
  const readout = h('div', { class: 'small muted', style: 'min-height:1.4em' }, hint);
  cv.addEventListener('pointermove', e => { readout.textContent = sectionReadout(cv, sec, F, st.qty, e) || hint; });
  const sign = st.qty === 'vm' ? 'always positive' : ['s1', 's3', 'hyd', 'sxx', 'syy', 'szz', 'sss', 'snn'].includes(st.qty) ? 'tension positive' : 'sign follows the axes named';
  const focusName = focusGrp === undefined ? '' : '; colours for the ' + S.groups[focusGrp].name.toLowerCase() + ' only, other materials grey';
  root.append(cv, legendRow(scale, sectionQtyLabel(st.qty) + ', MPa, ' + what + ' (' + sign + ')' + focusName), readout,
    lineKey([{ label: 'material boundary', color: cssVar('--text') }].concat(st.mesh ? [{ label: 'voxel edge', color: 'rgba(0,0,0,0.45)' }] : [])));
  requestAnimationFrame(() => { const draw = () => drawSectionPlot(cv, sec, F, scale, { qty: st.qty, phase: 'all', mesh: st.mesh, grey }); autoRedraw(cv, draw); draw(); });
}
