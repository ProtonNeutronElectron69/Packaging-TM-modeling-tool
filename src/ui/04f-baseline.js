// ===== Baseline comparison ======================================================================
// Pinning keeps a copy of the current results (with their bump submodels and a label) as the baseline;
// a saved results file can be pinned as well. The Results > Baseline comparison view lists every headline
// quantity of the current results next to the baseline (matched by die, chiplet and silicon-part name),
// with the difference and the ratio, says which configuration sections changed, and warns when the two
// were solved at different mesh presets. The step 6 summary cards, the report and the CSV export carry
// the same comparison.

/** Keep the current results as the baseline (a copy holding the submodels too, so the life ratio has a reference). */
function pinBaseline() {
  if (!app.results) return;
  app.baseline = Object.assign({}, app.results, {
    submodels: app.submodels.slice(),
    pinned: { name: app.cfg.name || 'current configuration', at: new Date().toISOString(), source: 'run' },
  });
  toast('Baseline pinned: ' + app.baseline.pinned.name + ' at ' + app.results.preset + '. Change the design and run again; Results > Baseline comparison then lists every result against it.', 'ok', 8000);
  renderAll();
}

/** Pin the results saved in a results file as the baseline, leaving the current results and analysis alone. */
function pinBaselineFile() {
  const inp = h('input', { type: 'file', accept: C.CONST.RESULTS_FILE_EXT });
  inp.addEventListener('change', async () => {
    const file = inp.files[0];
    if (!file) return;
    try {
      setStatus('Reading ' + file.name, 0);
      const t = C.decodeResultsFile(await file.arrayBuffer());
      if (!t || t.kind !== 'fcbga-results' || !t.results) throw new Error('it holds no results');
      app.baseline = Object.assign({}, t.results, {
        submodels: t.submodels || [],
        pinned: { name: (t.config && t.config.name) || file.name, at: new Date().toISOString(), source: 'file', file: file.name, savedAt: t.savedAt || null, hashes: t.results.hashes || null },
      });
      setStatus('Ready', null);
      toast('Baseline pinned from ' + file.name + '.', 'ok', 6000);
      app.resultsView = 'compare'; setCenterTab('results'); renderAll();
    } catch (e) {
      setStatus('Ready', null);
      toast('Could not pin ' + file.name + ' as the baseline: ' + e.message, 'error', 9000);
    }
  });
  inp.click();
}

function clearBaseline() { app.baseline = null; renderAll(); }

/** The current results are the pinned ones (just pinned, or a file saved right after pinning). */
const baselineIsCurrent = () => !!(app.baseline && app.results && app.baseline.at25 === app.results.at25);

/** One line naming the baseline: configuration, preset, mesh and when it was pinned. */
function baselineLabel(b) {
  const p = b.pinned || {};
  return (p.name || 'pinned results') + ', ' + (b.preset || '?') + (b.preview ? ' preview' : '') + (b.meshInfo ? ', ' + b.meshInfo.nDof.toLocaleString() + ' DOF' : '') + (p.file ? ', from ' + p.file : '') + (p.at ? ', pinned ' + new Date(p.at).toLocaleString() : '');
}

const peakSweep = r => (r.sweep && r.sweep.length ? r.sweep.reduce((m, s) => Math.abs(s.signed) > Math.abs(m.signed) ? s : m, r.sweep[0]) : null);
const worstOf = list => (list && list.length ? list.reduce((m, s) => (s.dW > m.dW ? s : m), list[0]) : null);

/**
 * Comparison rows {group, label, unit, cur, ref, digits, conf}: every headline quantity present in both results,
 * dies, silicon parts and chiplets matched by name (a part only one of them has is left out).
 */
function baselineRows(res, subs, base) {
  const rows = [], a = res.at25, b = base.at25;
  const add = (group, label, unit, cur, ref, digits, conf) => { if (isFinite(cur) && isFinite(ref)) rows.push({ group, label, unit, cur, ref, digits, conf }); };
  const named = (list, n) => (list || []).find(x => (x.name || x.die) === n);
  const toGf = v => v * C.CONST.GF_PER_N;
  add('Warpage', 'Signed warpage at 25 °C (JEITA)', 'µm', a.warpage.signed * 1000, b.warpage.signed * 1000, 1, CONFIDENCE.warpage);
  add('Warpage', 'Warpage magnitude at 25 °C', 'µm', a.warpage.mag * 1000, b.warpage.mag * 1000, 1, CONFIDENCE.warpage);
  const pa = peakSweep(res), pb = peakSweep(base);
  if (pa && pb && res.sweep.length > 1 && base.sweep.length > 1) add('Warpage', 'Reflow sweep peak, signed (current at ' + pa.T + ' °C, baseline at ' + pb.T + ' °C)', 'µm', pa.signed * 1000, pb.signed * 1000, 1, CONFIDENCE.warpage);
  for (const d of siList(a)) {
    const e = named(siList(b), d.name);
    if (!e) continue;
    add('Die stress', d.name + ': backside interior peak', 'MPa', d.top.peakInterior, e.top.peakInterior, 1, CONFIDENCE.dieInterior);
    add('Die stress', d.name + ': active-face interior peak', 'MPa', d.bottom.peakInterior, e.bottom.peakInterior, 1, CONFIDENCE.dieInterior);
    add('Die stress', d.name + ': worst backside corner patch', 'MPa', Math.max(...d.top.corners.map(c => c.value)), Math.max(...e.top.corners.map(c => c.value)), 1, CONFIDENCE.corner);
  }
  (res.cpi || []).forEach(c => {
    const e = named(base.cpi, c.die);
    if (!e) return;
    add('Bumps', c.die + ': worst bump shear, chip join', 'gf', toGf(c.worstV), toGf(e.worstV), 1, CONFIDENCE.bumps);
    add('Bumps', c.die + ': worst bump axial, chip join', 'gf', toGf(c.worstN), toGf(e.worstN), 1, CONFIDENCE.bumps);
  });
  a.dies.forEach(d => {
    const e = named(b.dies, d.name);
    if (!e) return;
    if (d.bumps && e.bumps) add('Bumps', d.name + ': worst bump shear, as assembled', 'gf', toGf(d.bumps.worstV), toGf(e.bumps.worstV), 1, CONFIDENCE.bumps);
    if (d.uf && e.uf) {
      add('Underfill', d.name + ': max sidewall peel', 'MPa', d.uf.maxPeelSide, e.uf.maxPeelSide, 1, CONFIDENCE.corner);
      add('Underfill', d.name + ': max sidewall shear', 'MPa', d.uf.maxShearSide, e.uf.maxShearSide, 1, CONFIDENCE.corner);
    }
  });
  (res.ddiJoin || []).forEach(c => { const e = named(base.ddiJoin, c.die); if (e) add('DDI microbumps', c.die + ': worst microbump shear, chiplet join', 'gf', toGf(c.worstV), toGf(e.worstV), 2, CONFIDENCE.bumps); });
  (a.ddi || []).forEach(c => { const e = named(b.ddi, c.name); if (e && c.bumps && e.bumps) add('DDI microbumps', c.name + ': worst microbump shear, as assembled', 'gf', toGf(c.bumps.worstV), toGf(e.bumps.worstV), 2, CONFIDENCE.bumps); });
  (res.screening || []).forEach(s => { const e = named(base.screening, s.die); if (e && s.top[0] && e.top[0]) add('Fatigue screening', s.die + ': worst-site ΔW_proxy', 'MPa/cycle', s.top[0].dW, e.top[0].dW, 4, CONFIDENCE.fatigue); });
  (res.ddiScreening || []).forEach(s => { const e = named(base.ddiScreening, s.die); if (e && s.top[0] && e.top[0]) add('Fatigue screening', s.die + ': worst-site DDI microbump ΔW_proxy', 'MPa/cycle', s.top[0].dW, e.top[0].dW, 4, CONFIDENCE.fatigue); });
  const sa = worstOf(subs), sb = worstOf(base.submodels);
  if (sa && sb) {
    add('Bump submodels', 'Worst submodel ΔW per cycle', 'MPa/cycle', sa.dW, sb.dW, 4, CONFIDENCE.fatigue);
    add('Bump submodels', 'Life of the worst submodel, Syed energy model', 'cycles', sa.life.syedEnergy, sb.life.syedEnergy, 0, CONFIDENCE.fatigue);
  }
  return rows;
}

/** Configuration sections that differ between the current results and the baseline (from the hashes the results carry). */
function baselineChanges(res, base) {
  const ha = res.hashes, hb = base.hashes || (base.pinned && base.pinned.hashes);
  if (!ha || !hb) return null;
  const names = { geometry: 'geometry', materials: 'materials', process: 'process temperatures', loads: 'reflow and cycling loads', post: 'limits, fatigue constants and submodel settings' };
  return Object.keys(names).filter(k => ha[k] !== hb[k]).map(k => names[k]);
}

/** Plain-language notes on how far the two results can be compared. */
function baselineNotes(res, base) {
  const notes = [];
  if (res.preset !== base.preset) notes.push({ cls: 'warning', text: 'Different mesh presets (current ' + res.preset + ', baseline ' + base.preset + '): part of every difference comes from the mesh, not the design. Run both at the same preset for a fair comparison.' });
  if (!!res.preview !== !!base.preview) notes.push({ cls: 'warning', text: 'One of the two is a quick preview (25 °C only): the reflow sweep and fatigue screening rows are missing.' });
  const ch = baselineChanges(res, base);
  if (ch) notes.push({ cls: 'info', text: ch.length ? 'Changed since the baseline: ' + ch.join(', ') + '.' : 'No configuration change since the baseline (same geometry, materials, process and loads).' });
  return notes;
}

const fmtSigned = (v, d) => (v >= 0 ? '+' : '') + fmt(v, d);
/** Ratio cell: current / baseline, left out when the baseline is zero or the signs differ. */
const ratioText = r => (r.ref !== 0 && r.cur / r.ref > 0 ? '×' + fmt(r.cur / r.ref, 3) : '–');
const valueText = (v, d) => (d >= 4 ? fmtE(v, 3) : fmt(v, d));

/** The comparison table, grouped, with the confidence of each group. */
function baselineTable(rows) {
  const tbl = h('table', { class: 'small compare' }, h('tr', null, h('th', null, 'Quantity'), h('th', null, 'Baseline'), h('th', null, 'Current'), h('th', null, 'Δ (current − baseline)'), h('th', null, 'Ratio')));
  let group = null;
  for (const r of rows) {
    if (r.group !== group) { group = r.group; tbl.append(h('tr', null, h('td', { colspan: 5 }, h('b', null, group), h('span', { class: 'muted' }, '  ' + r.conf)))); }
    tbl.append(h('tr', null, h('td', null, r.label), h('td', null, valueText(r.ref, r.digits) + ' ' + r.unit), h('td', null, valueText(r.cur, r.digits) + ' ' + r.unit), h('td', null, (r.digits >= 4 ? (r.cur - r.ref >= 0 ? '+' : '') + fmtE(r.cur - r.ref, 2) : fmtSigned(r.cur - r.ref, r.digits)) + ' ' + r.unit), h('td', null, ratioText(r))));
  }
  return tbl;
}

/** Results > Baseline comparison. */
function renderCompareView(root, res) {
  const base = app.baseline;
  root.append(h('div', { class: 'row' }, h('b', null, 'Baseline comparison'), h('span', { class: 'conf' }, 'Differences and ratios between designs are the most trustworthy outputs of a screening model.')));
  const pinRow = h('div', { class: 'row' }, h('button', tip('pinBaseline', { class: base ? 'small' : 'primary small', disabled: res ? null : '', onclick: pinBaseline }), base ? 'Pin current results instead' : 'Pin current results as baseline'), h('button', tip('pinBaselineFile', { class: 'small', onclick: pinBaselineFile }), 'Pin a results file as baseline'), base ? h('button', tip('clearBaseline', { class: 'small', onclick: clearBaseline }), 'Clear baseline') : null);
  root.append(pinRow);
  if (!base) {
    root.append(h('div', { class: 'msg info' }, 'No baseline pinned. Pin the current results (or a saved results file) as the baseline, change the design (a material, a thickness, the lid, the floorplan) and run again: this view then lists every result next to the baseline with the difference and the ratio. The step 6 summary, the warpage-versus-temperature plot, the report and the CSV export show the comparison as well.'));
    return;
  }
  root.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Baseline'), h('span', null, baselineLabel(base)), h('span', { class: 'k' }, 'Current'), h('span', null, (app.cfg.name || 'current configuration') + ', ' + res.preset + (res.preview ? ' preview' : '') + ', ' + res.meshInfo.nDof.toLocaleString() + ' DOF')));
  if (baselineIsCurrent()) {
    root.append(h('div', { class: 'msg info' }, 'The current results are the baseline. Change the design and run the analysis again (or open another results file); the comparison appears here.'));
    return;
  }
  for (const n of baselineNotes(res, base)) root.append(h('div', { class: 'msg ' + n.cls }, n.text));
  const rows = baselineRows(res, app.submodels, base);
  if (!rows.length) { root.append(h('div', { class: 'msg warning' }, 'The two results share no comparable quantity (no die, chiplet or silicon part of the same name).')); return; }
  root.append(baselineTable(rows));
  root.append(h('div', { class: 'row' }, h('button', tip('exportCompareCsv', { class: 'small', onclick: () => exportBaselineCSV(res, base) }), 'Export comparison CSV')));
  if (res.sweep.length > 1 && base.sweep && base.sweep.length > 1) {
    const cv = h('canvas', tip('compareSweep', { class: 'plot' }));
    root.append(cv);
    requestAnimationFrame(() => linePlot(cv, [{ x: res.sweep.map(r => r.T), y: res.sweep.map(r => r.signed * 1000), label: 'current', points: true }, { x: base.sweep.map(r => r.T), y: base.sweep.map(r => r.signed * 1000), label: 'baseline', dash: [4, 3], points: true }], { title: 'Signed warpage versus temperature, current and baseline', xlabel: '°C', ylabel: 'µm' }));
  }
}

/** Step 6 line under the pin buttons: what is pinned, and the way to the comparison. */
function baselineStatus() {
  const base = app.baseline;
  if (!base) return h('div', { class: 'small muted' }, 'No baseline pinned. Pin one, then compare variants: ratios and differences against the baseline are the most trustworthy outputs of a screening model.');
  return h('div', { class: 'msg info' }, h('div', null, h('b', null, 'Baseline: '), baselineLabel(base)), h('div', { class: 'row' }, h('span', { class: 'small' }, baselineIsCurrent() ? 'The current results are the baseline; change the design and run again to compare.' : 'The cards below show differences against it.'), h('button', tip('viewCompare', { class: 'small', onclick: () => { app.resultsView = 'compare'; setCenterTab('results'); renderCenter(); } }), 'Show comparison')));
}

/** Report section: the comparison table, when a baseline other than the current results is pinned. */
function baselineReportSection(res) {
  const base = app.baseline;
  if (!base || baselineIsCurrent()) return null;
  const rows = baselineRows(res, app.submodels, base);
  if (!rows.length) return null;
  return h('div', null, h('h3', null, 'Comparison with the baseline'), h('p', { class: 'small' }, 'Baseline: ' + baselineLabel(base) + '.'), ...baselineNotes(res, base).map(n => h('p', { class: 'small' }, n.text)), baselineTable(rows));
}

/** CSV lines of the comparison (empty without a baseline other than the current results). */
function baselineCsvLines(res, base) {
  if (!base || baselineIsCurrent()) return [];
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  return ['', 'baseline,' + q(baselineLabel(base)), 'group,quantity,unit,baseline,current,delta,ratio'].concat(baselineRows(res, app.submodels, base).map(r => [q(r.group), q(r.label), q(r.unit), r.ref, r.cur, r.cur - r.ref, r.ref !== 0 ? r.cur / r.ref : ''].join(',')));
}
function exportBaselineCSV(res, base) {
  const blob = new Blob([baselineCsvLines(res, base).slice(1).join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: (app.cfg.name || 'fcbga').replace(/[^\w.-]+/g, '_') + '_vs_baseline.csv' });
  document.body.appendChild(a); a.click(); a.remove();
}
