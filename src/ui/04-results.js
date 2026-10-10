// ===== UI: step 6, run controls, results views, 3D, sensitivity, verification, report ====

const CONFIDENCE = {
  warpage: 'Moderate confidence; most sensitive to stress-free temperature assumptions and polymer properties above Tg.',
  dieInterior: 'Moderate confidence.',
  corner: 'Comparative only; singular locations, mesh dependent.',
  bumps: 'Comparative only; use for ranking designs and locations.',
  fatigue: 'Comparative only; use for ranking designs and locations.',
};

function renderRunPanel(root) {
  const cfg = app.cfg;
  root.append(h('h2', null, '6. Run and results'));
  root.append(selectField('Mesh fidelity', () => cfg.mesh.preset, v => { cfg.mesh.preset = v; renderContext(); }, Object.entries(C.CONST.MESH_PRESETS).map(([k, p]) => ({ value: k, label: p.label + ' (h ' + p.hmin + ' to ' + p.hmax + ' mm, cap ' + p.cap.toLocaleString() + ' DOF)' })), { help: 'preset', section: 'mesh' }));
  const hc = navigator.hardwareConcurrency || 2;
  root.append(h('div', { class: 'field' }, h('label', null, 'Parallel workers', helpTip('workers')), h('select', { 'data-tip': TIPS.workers, onchange: e => { app.workers = +e.target.value; renderContext(); } }, ...Array.from({ length: Math.max(1, Math.min(8, hc)) }, (_, i) => i + 1).map(n => h('option', { value: n, selected: app.workers === n ? '' : null }, n + (n === 1 ? ' (single worker)' : ' workers')))), h('span', { class: 'unit' }, hc + ' cores' + (app.nestedWorkers === false ? '; nested workers unavailable in this browser' : ''))));
  const est = estimateRun(cfg, cfg.mesh.preset);
  if (est.error) root.append(h('div', { class: 'msg error' }, est.error));
  else {
    app.meshWarnings = est.warnings;
    root.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Estimated mesh'), h('span', null, est.info.nx + ' × ' + est.info.ny + ' × ' + est.info.nz + ' grid, ' + est.info.nElem.toLocaleString() + ' elements, ' + est.info.nDof.toLocaleString() + ' DOF' + (est.info.scaled ? ' (sizes enlarged to meet the cap)' : '')), h('span', { class: 'k' }, 'Element sizes'), h('span', null, 'h_min ' + fmt(est.info.hmin, 3) + ', h_max ' + fmt(est.info.hmax, 3) + ' mm; max aspect ' + fmt(est.info.aspectMax, 0)), h('span', { class: 'k' }, 'Estimated memory'), h('span', { class: est.memMB > 600 ? 'warnc' : '' }, fmt(est.memMB, 0) + ' MB total (' + fmt(est.perWorkerMB, 0) + ' MB per worker' + (est.memMB > 600 ? '; above the 600 MB target, reduce the worker count if memory is tight' : '') + ')'), h('span', { class: 'k' }, 'Estimated runtime'), h('span', null, 'preview ' + fmt(est.previewS, 0) + ' s, full analysis ' + fmt(est.fullS, 0) + ' s with ' + app.workers + ' worker' + (app.workers > 1 ? 's' : '') + ' (scales with your CPU)')));
  }
  const canRun = !app.validation.errors.length;
  root.append(h('div', { class: 'row' }, h('button', tip('runFull', { class: 'primary', disabled: canRun ? null : '', onclick: () => runFull() }), '▶ Run full global analysis'), h('button', tip('quickPreview', { disabled: canRun ? null : '', onclick: () => runPreview() }), 'Quick preview (Draft, 25 °C)')));
  root.append(h('div', { class: 'row' }, h('button', tip('pinBaseline', { disabled: app.results ? null : '', onclick: pinBaseline }), 'Pin as baseline'), h('button', tip('clearBaseline', { disabled: app.baseline ? null : '', onclick: () => { app.baseline = null; renderContext(); } }), 'Clear baseline'), h('button', tip('meshCheck', { disabled: canRun ? null : '', onclick: checkMeshSensitivity }), 'Check mesh sensitivity'), h('button', tip('exportCsv', { disabled: app.results ? null : '', onclick: exportCSV }), 'Export CSV'), h('button', tip('report', { disabled: app.results ? null : '', onclick: openReport }), 'Report (print / PDF)')));
  if (cfg.name && cfg.name.startsWith('Core thickness study')) root.append(h('div', { class: 'row' }, h('button', tip('coreStudy', { onclick: runCoreStudy }), 'Run both core variants and compare')));
  root.append(h('div', { class: 'small muted' }, 'Tip: pin a baseline, then compare variants. Ratios and deltas against the baseline are the most trustworthy outputs of a screening model.'));
  root.append(estimatedInputsCard(cfg));
  renderValidation(root);
  if (!app.results) { root.append(h('div', { class: 'msg info' }, 'No results yet. Run the analysis to populate the results views in the center area.')); return; }
  const res = app.results;
  root.append(h('h3', null, 'Summary at 25 °C'));
  const f = res.at25, w = f.warpage;
  const base = app.baseline;
  const delta = (v, bv, unit, dgt) => bv === undefined || bv === null || !isFinite(bv) ? '' : ' (Δ ' + (v - bv >= 0 ? '+' : '') + fmt(v - bv, dgt) + unit + ', ×' + fmt(v / bv, 2) + ' vs baseline)';
  root.append(h('div', { class: 'card' }, h('h3', null, 'Signed warpage, JEITA, 25 °C', helpTip('warpSigned')), h('div', { class: 'big' }, um(w.signed) + ' µm', w.marginal ? h('span', { class: 'badge Handbook', 'data-tip': 'The diagonal sum that sets the JEITA sign is only ' + fmt(100 * w.signConf, 0) + ' % of the magnitude (saddle or ring shape); the sign can flip between neighbouring states while the magnitude barely changes. Compare magnitudes.' }, 'marginal sign') : null), h('div', { class: 'sub' }, shapeText(w) + '; magnitude ' + um(w.mag) + ' µm; RT reference ' + (w.limitRT * 1000) + ' µm' + (base ? delta(w.signed * 1000, base.at25.warpage.signed * 1000, ' µm', 1) : '')), whatThisMeans('warpage', res)));
  const peak = res.sweep.reduce((m, r) => Math.abs(r.signed) > Math.abs(m.signed) ? r : m, res.sweep[0]);
  root.append(h('div', { class: 'card' }, h('h3', null, 'Reflow sweep peak'), h('div', { class: 'big' }, um(peak.signed) + ' µm at ' + peak.T + ' °C'), h('div', { class: 'sub' }, 'JEITA limit for ' + cfg.bga.pitch + ' mm pitch: ' + (w.limitHot * 1000) + ' µm → ' + (Math.abs(peak.signed) <= w.limitHot ? 'within limit' : 'exceeds limit') + (base ? delta(peak.signed * 1000, base.sweep.reduce((m, r) => Math.abs(r.signed) > Math.abs(m.signed) ? r : m, base.sweep[0]).signed * 1000, ' µm', 1) : ''))));
  f.dies.forEach((d, i) => {
    const bd = base && base.at25.dies[i];
    root.append(h('div', { class: 'card' }, h('h3', null, d.name + ' backside stress', helpTip('peakNodal')), h('div', { class: 'big' }, fmt(d.top.peakInterior, 1) + ' MPa'), h('div', { class: 'sub' }, 'interior peak (0.5 mm edge band excluded), max principal, nodal averaged; Gauss-point peak ' + fmt(d.top.gpPeakInterior, 1) + ' MPa' + (bd ? delta(d.top.peakInterior, bd.top.peakInterior, ' MPa', 1) : '') + (cfg.limits.dieStrength ? '; margin to strength ' + fmt(cfg.limits.dieStrength - d.top.peakInterior, 0) + ' MPa' : '')), h('div', { class: 'sub' }, 'corner patches (comparative): ' + d.top.corners.map(c => fmt(c.value, 0)).join(' / ') + ' MPa'), h('div', { class: 'conf' }, CONFIDENCE.dieInterior + ' Corner values: ' + CONFIDENCE.corner)));
  });
  res.cpi.forEach((b, i) => {
    const bb = base && base.cpi[i];
    root.append(h('div', { class: 'card' }, h('h3', null, b.die + ' bump loading (CPI proxy)', helpTip('stateCpi')), h('div', { class: 'big' }, gf(b.worstV) + ' gf shear'), h('div', { class: 'sub' }, 'worst bump at chip join cooldown, before underfill; axial ' + gf(b.worstN) + ' gf (' + fmt(b.worstN, 3) + ' N)' + (bb ? delta(b.worstV, bb.worstV, ' N', 3) : '')), h('div', { class: 'conf' }, 'Elastic upper bound; real joints relax by creep during cooldown. ' + CONFIDENCE.bumps)));
  });
  if (res.screening) res.screening.forEach((s, i) => {
    const bs = base && base.screening && base.screening[i];
    root.append(h('div', { class: 'card' }, h('h3', null, s.die + ' solder fatigue screening', helpTip('dWproxy')), h('div', { class: 'big' }, fmtE(s.top[0] ? s.top[0].dW : NaN, 3) + ' MPa/cycle'), h('div', { class: 'sub' }, 'worst-site ΔW_proxy at (' + fmt(s.top[0] && s.top[0].x, 2) + ', ' + fmt(s.top[0] && s.top[0].y, 2) + ') mm; equivalent inelastic strain range ' + fmtE(s.top[0] && s.top[0].dE, 3) + (bs && bs.top[0] ? delta(s.top[0].dW, bs.top[0].dW, ' MPa', 4) : '')), h('div', { class: 'conf' }, 'Screening index; ranks locations; not a life. ' + (s.subsampled ? 'Sites subsampled above 20,000 (outer rows and corner blocks kept).' : ''))));
  });
  root.append(h('details', null, h('summary', tip('solverLog'), 'Solver log (' + res.solverLog.length + ' solves, ' + fmt(res.totalMs / 1000, 1) + ' s total)'), h('div', { class: 'mono small' }, 'Mesh ' + res.meshInfo.nDof + ' DOF, ' + res.meshInfo.nElem + ' elements, build ' + fmt(res.meshInfo.buildMs, 0) + ' ms; assembly ' + fmt(res.timings.assemble, 0) + ' ms; solves ' + fmt(res.timings.solve, 0) + ' ms'), h('table', { class: 'small' }, h('tr', null, h('th', null, 'Solve'), h('th', null, 'Iterations'), h('th', null, 'Residual'), h('th', null, 'Preconditioner'), h('th', null, 'ms')), ...res.solverLog.map(r => h('tr', null, h('td', null, r.label), h('td', null, String(r.iters) + (r.rebuilt ? ' (rebuilt)' : '') + (r.fallback ? ' (fallback from ' + r.fallback.first + ')' : '')), h('td', null, fmtE(r.relres, 1)), h('td', null, r.precond || ''), h('td', null, fmt(r.ms, 0)))))));
}

/** Every Estimated (placeholder) parameter the current configuration depends on. */
function estimatedInputsInUse(cfg) {
  const out = [];
  for (const r of C.materialRoles(cfg)) {
    const m = C.findMaterial(cfg.materials, r.id);
    C.forEachParam({ elastic: m.elastic, cte: m.cte, cteXY: m.cteXY, cteZ: m.cteZ, cure: m.cure }, (p, path) => { if ((p.c || 'Estimated') === 'Estimated') out.push({ role: r.role, material: m.name, id: m.id, path, label: paramLabel(path), value: p.v, unit: p.u || '', note: p.n || '' }); });
    if (m.elastic && m.elastic.E && m.elastic.E.type === 'table' && m.elastic.E.c === 'Estimated') out.push({ role: r.role, material: m.name, id: m.id, path: 'elastic.E', label: 'E(T) table', value: '', unit: '', note: m.elastic.E.n || '' });
  }
  return out;
}
function estimatedInputsCard(cfg) {
  const list = estimatedInputsInUse(cfg);
  const S = app.sensitivity;
  const driven = new Set();
  if (S) for (const k of ['warpRT', 'warpPeak', 'dieStress', 'dW']) if (S[k]) S[k].rows.slice(0, 5).forEach(r => driven.add(r.id));
  const card = h('div', { class: 'card' }, h('h3', null, 'Estimated inputs in use ', h('span', { class: 'badge Estimated' }, String(list.length)), helpTip('estCard')),
    h('div', { class: 'small' }, 'These placeholder values have no published source; replace them with measured or DMA data before trusting absolute numbers. Their influence is quantified by the sensitivity run (step 6 → Sensitivity), which includes them by default.'),
    h('table', { class: 'small' }, h('tr', null, h('th', null, 'Role'), h('th', null, 'Material'), h('th', null, 'Parameter'), h('th', null, 'Value'), h('th')), ...list.map(e => h('tr', null, h('td', null, e.role), h('td', null, e.material), h('td', { title: e.note }, e.label), h('td', null, (typeof e.value === 'number' ? fmtInput(e.value) : e.value) + ' ' + e.unit), h('td', null, h('button', tip('estEdit', { class: 'small', onclick: () => { app.selectedMaterial = e.id; app.step = 4; renderAll(); } }), 'edit'))))),
    S ? h('div', { class: 'small muted' }, 'In the last sensitivity run, ' + sensitivityEstimatedShare(S) + ' of the total top-5 swing came from Estimated inputs.') : null);
  return card;
}
function sensitivityEstimatedShare(S) {
  const estIds = new Set(C.sensitivityInputs(app.cfg).filter(i => i.estimated).map(i => i.id));
  let tot = 0, est = 0;
  for (const k of ['warpRT', 'warpPeak', 'dieStress', 'dW']) if (S[k]) for (const r of S[k].rows.slice(0, 5)) { const sw = r.swing / Math.max(Math.abs(S[k].base), 1e-30); tot += sw; if (estIds.has(r.id)) est += sw; }
  return tot > 0 ? fmt(100 * est / tot, 0) + ' %' : 'none';
}
function shapeText(w) {
  const base = w.sign > 0 ? 'convex (center farther from the PWB than the corners)' : (w.sign < 0 ? 'concave' : 'flat');
  const sh = { dome: 'dome', bowl: 'bowl', saddle: 'saddle', ring: 'ring / W profile (the center sits on one side of the corner line, an intermediate ring on the other; the JEITA sign follows the deeper of the two, not the center)', flat: 'flat' }[w.shape] || w.shape;
  return base + ', ' + sh + ' shape; sign confidence ' + fmt(100 * (w.signConf || 0), 0) + ' %';
}
function whatThisMeans(kind, res) {
  const f = res.at25, w = f.warpage, cfg = app.cfg;
  const lines = [];
  if (kind === 'warpage') {
    if (w.shape === 'ring') lines.push('The surface has a ring (W or M) profile: the centre and an intermediate ring lie on opposite sides of the corner-to-corner line, so the JEITA sign describes the deeper feature rather than the centre. Lidded packages often show this at room temperature (the lid pulls the perimeter while the die holds the centre).');
    if (w.marginal) lines.push('The sign is marginal here: the JEITA diagonal sum is only ' + fmt(100 * w.signConf, 0) + ' % of the magnitude, which happens for saddle and ring-shaped surfaces. Rank designs by the magnitude |C| and inspect the shape; a sign change between two nearby states does not mean the package flipped.');
    const flips = res.sweep.filter((r, i) => i > 0 && r.sign !== res.sweep[i - 1].sign && r.sign !== 0 && res.sweep[i - 1].sign !== 0).map(r => r.T);
    if (flips.length) lines.push('Over the reflow sweep the JEITA sign changes at about ' + flips.join(', ') + ' °C; the magnitude curve (dashed) shows whether the surface actually passes through flat there or only changes shape.');
    lines.push('Sign follows JEITA ED-7306 / JESD22-B112: positive means the package top surface arches and the center is farther from the board than the corners (convex); negative means concave. The magnitude is the peak-to-valley of the BGA-side surface after removing the best-fit plane over the ball field.');
    lines.push('The sign is determined by the two diagonals (AB: ' + um(w.diagAB.max) + ' / ' + um(w.diagAB.min) + ' µm, CD: ' + um(w.diagCD.max) + ' / ' + um(w.diagCD.min) + ' µm); saddle or ring-shaped surfaces can flip sign while the magnitude stays similar.');
    const peak = res.sweep.reduce((m, r) => Math.abs(r.signed) > Math.abs(m.signed) ? r : m, res.sweep[0]);
    lines.push('Over the reflow sweep the largest magnitude is ' + um(peak.signed) + ' µm at ' + peak.T + ' °C against the JEITA maximum permissible ' + (w.limitHot * 1000) + ' µm for ' + cfg.bga.pitch + ' mm pitch.');
    if (app.sensitivity && app.sensitivity.warpRT) lines.push('Dominant drivers from the last sensitivity run: ' + app.sensitivity.warpRT.rows.slice(0, 3).map(r => r.label).join(', ') + '.');
    lines.push(CONFIDENCE.warpage);
  }
  return h('details', null, h('summary', null, 'What this means'), ...lines.map(l => h('p', { class: 'small' }, l)));
}

// ---- running ----
function runFull() {
  if (app.validation.errors.length) { toast('Fix the errors first.', 'error'); return; }
  startRun({ type: 'run', cfg: app.cfg, preset: app.cfg.mesh.preset, evaluations: 'full', workers: app.workers }, 'Full global analysis').then(res => {
    app.results = res; app.currentFields = res.at25; app.selectedT = 25; app.dirty = false;
    app.screening = res.screening || null; app.submodels = [];
    setCenterTab('results'); renderAll();
    toast('Analysis complete in ' + fmt(res.totalMs / 1000, 1) + ' s (' + res.meshInfo.nDof + ' DOF, ' + res.workers + ' worker' + (res.workers > 1 ? 's' : '') + ').', 'ok');
  }).catch(err => { if (err.message !== 'cancelled') toast('Analysis failed: ' + err.message, 'error', 9000); });
}
function runPreview() {
  if (app.validation.errors.length) return;
  startRun({ type: 'run', cfg: app.cfg, preset: 'draft', evaluations: 'preview' }, 'Draft preview').then(res => {
    res.preview = true;
    app.results = res; app.currentFields = res.at25; app.selectedT = 25;
    floorplan.draw();
    renderContext();
  }).catch(err => { if (err.message !== 'cancelled') toast('Preview failed: ' + err.message, 'error'); });
}
function startRun(msg, label) {
  if (app.running) worker.cancel();
  app.running = label;
  const t0 = performance.now();
  setStatus(label + ' starting…', 0);
  const p = worker.send(msg, (frac, m) => setStatus(label + ': ' + m, frac));
  p.then(() => { app.running = null; setStatus(label + ' done in ' + fmt((performance.now() - t0) / 1000, 1) + ' s', null); }, () => { app.running = null; setStatus('Ready', null); });
  return p;
}
function pinBaseline() { app.baseline = app.results; toast('Baseline pinned: ' + (app.cfg.name || 'current configuration') + ' at ' + app.results.preset + '.', 'ok'); renderContext(); }

function checkMeshSensitivity() {
  const order = ['draft', 'standard', 'fine'];
  const cur = app.cfg.mesh.preset, next = order[Math.min(order.indexOf(cur) + 1, 2)];
  if (next === cur) { toast('Already at the finest preset.', 'warn'); return; }
  const run = preset => startRun({ type: 'run', cfg: app.cfg, preset, evaluations: 'preview', workers: app.workers }, 'Mesh check at ' + preset);
  run(cur).then(a => run(next).then(b => {
    const wa = a.at25.warpage.signed, wb = b.at25.warpage.signed;
    const sa = a.at25.dies[0].top.peakInterior, sb = b.at25.dies[0].top.peakInterior;
    const fa = a.cpi[0].worstV, fb = b.cpi[0].worstV;
    const pc = (x, y) => fmt(100 * Math.abs(x / y - 1), 1) + ' %';
    const conv = [wa / wb, sa / sb, fa / fb].every(r => Math.abs(r - 1) < 0.05);
    showModal('Mesh sensitivity: ' + cur + ' → ' + next, h('div', null, h('table', null, h('tr', null, h('th'), h('th', null, cur + ' (' + a.meshInfo.nDof + ' DOF)'), h('th', null, next + ' (' + b.meshInfo.nDof + ' DOF)'), h('th', null, 'change')), h('tr', null, h('td', null, 'RT signed warpage'), h('td', null, um(wa) + ' µm'), h('td', null, um(wb) + ' µm'), h('td', null, pc(wa, wb))), h('tr', null, h('td', null, 'Die interior peak stress'), h('td', null, fmt(sa, 1) + ' MPa'), h('td', null, fmt(sb, 1) + ' MPa'), h('td', null, pc(sa, sb))), h('tr', null, h('td', null, 'Worst bump shear force'), h('td', null, fmt(fa, 3) + ' N'), h('td', null, fmt(fb, 3) + ' N'), h('td', null, pc(fa, fb)))), h('p', { class: conv ? 'ok' : 'warnc' }, conv ? 'Verdict: converged within 5 %.' : 'Verdict: results still mesh-sensitive; use the finer preset for decisions.')));
  })).catch(e => { if (e.message !== 'cancelled') toast(e.message, 'error'); });
}
function runCoreStudy() {
  const A = C.presetConfig(MATERIALS_DB, 'coreStudy', 'A'), B = C.presetConfig(MATERIALS_DB, 'coreStudy', 'B');
  const preset = app.cfg.mesh.preset;
  startRun({ type: 'run', cfg: A, preset, evaluations: 'preview' }, 'Core study A (0.4 mm)').then(ra => startRun({ type: 'run', cfg: B, preset, evaluations: 'preview' }, 'Core study B (0.8 mm)').then(rb => {
    showModal('Core thickness study (bare die, 3-2-3)', h('div', null, h('table', null, h('tr', null, h('th'), h('th', null, 'A: 0.4 mm core'), h('th', null, 'B: 0.8 mm core')), h('tr', null, h('td', null, 'RT signed warpage'), h('td', null, um(ra.at25.warpage.signed) + ' µm'), h('td', null, um(rb.at25.warpage.signed) + ' µm')), h('tr', null, h('td', null, 'Die backside interior peak'), h('td', null, fmt(ra.at25.dies[0].top.peakInterior, 1) + ' MPa'), h('td', null, fmt(rb.at25.dies[0].top.peakInterior, 1) + ' MPa')), h('tr', null, h('td', null, 'Worst CPI bump shear'), h('td', null, gf(ra.cpi[0].worstV) + ' gf'), h('td', null, gf(rb.cpi[0].worstV) + ' gf'))), h('p', { class: 'small muted' }, 'Resonac TEG-like construction [R2]; Cu thickness per layer (15 µm) is not stated by the source and was assumed.')));
  })).catch(e => { if (e.message !== 'cancelled') toast(e.message, 'error'); });
}

// ---- results views in the center area ----
const RESULT_VIEWS = [['warpage', 'Warpage', 'viewWarpage'], ['dieStress', 'Die stress', 'viewDieStress'], ['bumps', 'Bump loading', 'viewBumps'], ['uf', 'Underfill interface', 'viewUf'], ['fatigue', 'Solder fatigue', 'viewFatigue'], ['view3d', '3D view', 'view3d'], ['sensitivity', 'Sensitivity', 'viewSens'], ['verification', 'Verification', 'viewVerify'], ['report', 'Report', 'viewReport']];

function renderResults(root) {
  const res = app.results;
  const colorSel = h('label', tip('colorMap', { class: 'small' }), 'colors ', h('select', { onchange: e => { app.colorMap = e.target.value; prefs.set('colorMap', app.colorMap); renderCenter(); } }, h('option', { value: 'rainbow', selected: app.colorMap === 'rainbow' ? '' : null }, 'rainbow'), h('option', { value: 'colorblind', selected: app.colorMap === 'colorblind' ? '' : null }, 'colorblind-safe')));
  const bar = h('div', { class: 'row' }, ...RESULT_VIEWS.map(([k, l, t]) => h('button', tip(t, { class: app.resultsView === k ? 'primary small' : 'small', onclick: () => { app.resultsView = k; renderCenter(); } }), l)), colorSel);
  root.append(bar);
  if (!res && !['sensitivity', 'verification'].includes(app.resultsView)) { root.append(h('div', { class: 'msg info' }, 'Run the analysis (step 6) to see results.')); return; }
  const Tsel = res ? h('select', tip('tempSelect', { onchange: e => selectTemperature(+e.target.value) }), ...Array.from(new Set([25].concat(app.cfg.reflow.reportTemps, res.temps.all))).sort((a, b) => a - b).filter(T => res.temps.all.includes(T)).map(T => h('option', { value: T, selected: T === app.selectedT ? '' : null }, T + ' °C'))) : null;
  const f = app.currentFields;
  switch (app.resultsView) {
    case 'warpage': renderWarpageView(root, res, f, Tsel); break;
    case 'dieStress': renderDieStressView(root, res, f, Tsel); break;
    case 'bumps': renderBumpView(root, res, f, Tsel); break;
    case 'uf': renderUFView(root, res, f, Tsel); break;
    case 'fatigue': renderFatigueView(root, res); break;
    case 'view3d': renderView3D(root, res, f, Tsel); break;
    case 'sensitivity': renderSensitivityView(root); break;
    case 'verification': renderVerificationView(root); break;
    case 'report': renderReportView(root, res); break;
  }
}
function selectTemperature(T) {
  app.selectedT = T;
  if (app.fieldsCache.has(T)) { app.currentFields = app.fieldsCache.get(T); renderCenter(); floorplan.draw(); return; }
  setStatus('Evaluating fields at ' + T + ' °C', 0.5);
  worker.send({ type: 'fieldsAt', T }).then(f => { app.fieldsCache.set(T, f); app.currentFields = f; setStatus('Ready', null); renderCenter(); floorplan.draw(); }).catch(e => { setStatus('Ready', null); toast(e.message, 'error'); });
}
function mapCanvas(res, drawFn, height) {
  const cv = h('canvas', { class: 'map', style: 'width:100%;height:' + (height || 420) + 'px' });
  const draw = () => {
    const { ctx, w, h: H } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, H);
    const sx = app.cfg.substrate.sx, sy = app.cfg.substrate.sy;
    const sc0 = Math.min((w - 40) / sx, (H - 40) / sy);
    cv.__tx = { w, H, sc0 };
    const v = cv.__view || { z: 1, cx: 0, cy: 0 };  // zoom factor and the package point at the canvas centre (mm)
    const sc = sc0 * v.z;
    const X = x => w / 2 + (x - v.cx) * sc, Y = y => H / 2 - (y - v.cy) * sc;
    ctx.strokeStyle = cssVar('--text'); ctx.strokeRect(X(-sx / 2), Y(sy / 2), sx * sc, sy * sc);
    drawFn(ctx, X, Y, sc);
    for (const d of res.geometry.dies) { ctx.strokeStyle = cssVar('--text'); ctx.setLineDash([4, 3]); ctx.strokeRect(X(d.rect.x0), Y(d.rect.y1), d.w * sc, d.h * sc); ctx.setLineDash([]); }
  };
  requestAnimationFrame(() => { autoRedraw(cv, draw); draw(); plotZoom(cv, mapZoomHandlers(cv)); });
  return cv;
}
/** Wheel zoom about the cursor and drag pan for a package map (view: zoom z, centre cx, cy in mm). */
function mapZoomHandlers(cv) {
  return {
    zoom(px, py, f) {
      const t = cv.__tx, v = cv.__view || { z: 1, cx: 0, cy: 0 };
      const z = Math.min(ZOOM_MAX, v.z * f);
      if (z <= 1) { cv.__view = null; return; }
      const wx = v.cx + (px - t.w / 2) / (t.sc0 * v.z), wy = v.cy - (py - t.H / 2) / (t.sc0 * v.z);
      cv.__view = { z, cx: wx - (px - t.w / 2) / (t.sc0 * z), cy: wy + (py - t.H / 2) / (t.sc0 * z) };
    },
    pan(dx, dy) {
      const t = cv.__tx, v = cv.__view; if (!v) return;
      cv.__view = { z: v.z, cx: v.cx - dx / (t.sc0 * v.z), cy: v.cy + dy / (t.sc0 * v.z) };
    },
  };
}
function legendRow(scale, label) { const cv = h('canvas'); const el = h('div', { class: 'legend' }, h('span', null, fmt(scale.min, 1)), cv, h('span', null, fmt(scale.max, 1)), h('span', null, label)); requestAnimationFrame(() => drawLegend(cv, scale)); return el; }

function renderWarpageView(root, res, f, Tsel) {
  const w = f.warpage, cfg = app.cfg;
  root.append(h('div', { class: 'row' }, h('b', null, 'Warpage'), ' at ', Tsel, f.molten ? h('span', { class: 'badge Estimated' }, 'solder molten; constrained by underfill') : null, h('span', { class: 'conf' }, CONFIDENCE.warpage)));
  const grid = Float32Array.from(w.grid, v => v * 1000);
  const scale = makeScale(w.rmin * 1000, w.rmax * 1000, true);
  const left = h('div');
  left.append(mapCanvas(res, (ctx, X, Y, sc) => { drawGridField(ctx, res.xs, res.ys, grid, scale, X, Y, 0.95); drawContours(ctx, res.xs, res.ys, grid, ticks(scale.min, scale.max, 10), X, Y, 'rgba(0,0,0,0.3)'); drawPoints(ctx, w.ballX, w.ballY, Float32Array.from(w.ballRes, v => v * 1000), scale, X, Y, Math.max(1.5, 0.2 * cfg.bga.pitch * sc)); const z = res.geometry.bga.zone; ctx.setLineDash([6, 4]); ctx.strokeStyle = cssVar('--muted'); ctx.strokeRect(X(z.x0), Y(z.y1), (z.x1 - z.x0) * sc, (z.y1 - z.y0) * sc); ctx.setLineDash([]); ctx.strokeStyle = cssVar('--accent2'); ctx.beginPath(); ctx.moveTo(X(z.x0), Y(z.y0)); ctx.lineTo(X(z.x1), Y(z.y1)); ctx.moveTo(X(z.x0), Y(z.y1)); ctx.lineTo(X(z.x1), Y(z.y0)); ctx.stroke(); ctx.fillStyle = cssVar('--accent2'); ctx.font = '11px ' + cssVar('--font'); ctx.fillText('A', X(z.x0) - 10, Y(z.y0) + 4); ctx.fillText('B', X(z.x1) + 3, Y(z.y1)); ctx.fillText('C', X(z.x0) - 10, Y(z.y1)); ctx.fillText('D', X(z.x1) + 3, Y(z.y0) + 4); }));
  left.append(legendRow(scale, 'substrate bottom surface, µm relative to the best-fit plane over the BGA zone; + toward the package top (away from the PWB); dots: ball sites'));
  const right = h('div');
  right.append(h('div', { class: 'card' }, h('div', { class: 'kv' }, kl('Signed warpage', 'warpSigned'), h('b', null, um(w.signed) + ' µm (' + (w.sign > 0 ? 'convex' : w.sign < 0 ? 'concave' : 'flat') + ')', w.marginal ? h('span', { class: 'badge Handbook', 'data-tip': TIPS.warpShape }, 'marginal sign') : null), kl('Shape, sign confidence', 'warpShape'), h('span', null, w.shape + ', ' + fmt(100 * (w.signConf || 0), 0) + ' % (|AB_max + AB_min + CD_max + CD_min| / |C|; orange ticks on the sweep mark marginal states)'), kl('Magnitude |C|', 'warpMag'), h('span', null, um(w.mag) + ' µm'), kl('JEITA max at elevated T', 'warpLimitHot'), h('span', null, (w.limitHot * 1000) + ' µm for ' + cfg.bga.pitch + ' mm pitch'), kl('RT coplanarity reference', 'warpLimitRT'), h('span', null, (w.limitRT * 1000) + ' µm'), kl('Diagonal AB max / min', 'warpDiag'), h('span', null, um(w.diagAB.max) + ' / ' + um(w.diagAB.min) + ' µm'), kl('Diagonal CD max / min', 'warpDiag'), h('span', null, um(w.diagCD.max) + ' / ' + um(w.diagCD.min) + ' µm'), kl('Substrate top warpage', 'warpTop'), h('span', null, um(f.substrateTop.mag) + ' µm'), ...f.substrateTop.dies.flatMap(d => [kl(d.die + ' die-to-substrate relative curvature', 'relCurv'), h('span', null, fmtE(d.relKxx, 2) + ' (xx), ' + fmtE(d.relKyy, 2) + ' (yy) 1/mm')])), whatThisMeans('warpage', res)));
  const c1 = h('canvas', tip('diagPlot', { class: 'plot' })), c2 = h('canvas', tip('sweepPlot', { class: 'plot' })), c3 = h('canvas', tip('tempPlot', { class: 'plot' }));
  right.append(c1, c2, c3);
  root.append(h('div', { class: 'grid2' }, left, right));
  requestAnimationFrame(() => {
    linePlot(c1, [{ x: w.diagAB.s, y: Float32Array.from(w.diagAB.rel, v => v * 1000), label: 'A→B' }, { x: w.diagCD.s, y: Float32Array.from(w.diagCD.rel, v => v * 1000), label: 'C→D' }], { title: 'Diagonal profiles relative to the corner-to-corner line', xlabel: 'position along diagonal, mm', ylabel: 'µm' });
    const up = res.sweep.map(r => r.T), ws = res.sweep.map(r => r.signed * 1000);
    const upWarp = res.sweep.filter(r => r.T >= 25);
    const peakT = cfg.reflow.peak;
    const down = upWarp.map(r => ({ x: 2 * peakT - r.T, y: r.signed * 1000 })).reverse();
    linePlot(c2, [{ x: upWarp.map(r => r.T), y: upWarp.map(r => r.signed * 1000), label: 'heating', points: true }, { x: down.map(p => p.x), y: down.map(p => p.y), label: 'cooling (mirrored, same states)', dash: [4, 3] }, { x: upWarp.map(r => r.T), y: upWarp.map(r => r.mag * 1000), label: 'magnitude |C|', dash: [2, 3], color: cssVar('--muted') }], { title: 'Signed warpage over the reflow sweep (x axis: heating to peak, then mirrored cooling)', xlabel: '°C (then mirrored)', ylabel: 'µm', band: [-w.limitHot * 1000, w.limitHot * 1000], hlines: [{ y: 0 }], vlines: [{ x: 217, label: 'solidus' }, { x: 2 * peakT - 217 }].concat(upWarp.filter(r => r.marginal).map(r => ({ x: r.T, color: cssVar('--warn') }))) });
    const bl = app.baseline ? [{ x: app.baseline.sweep.map(r => r.T), y: app.baseline.sweep.map(r => r.signed * 1000), label: 'baseline', dash: [2, 2] }] : [];
    linePlot(c3, [{ x: up, y: ws, label: 'current', points: true }].concat(bl, res.cycling ? [{ x: res.cycling.map(r => r.T), y: res.cycling.map(r => r.signed * 1000), label: 'cycling range', dash: [6, 3] }] : []), { title: 'Signed warpage versus temperature (all evaluated states)', xlabel: '°C', ylabel: 'µm', hlines: [{ y: w.limitHot * 1000, label: 'JEITA limit', color: cssVar('--warn') }, { y: -w.limitHot * 1000, color: cssVar('--warn') }] });
  });
}

function renderDieStressView(root, res, f, Tsel) {
  const cfg = app.cfg;
  root.append(h('div', { class: 'row' }, h('b', null, 'Die stress'), ' at ', Tsel, h('span', { class: 'conf' }, 'Interior: ' + CONFIDENCE.dieInterior + ' Edges and corners: ' + CONFIDENCE.corner)));
  const which = app.dieStressFace || 'top';
  root.append(h('div', { class: 'row' }, ...[['top', 'Backside (top surface)', 'faceTop'], ['bottom', 'Active face', 'faceBottom']].map(([k, l, t]) => h('button', tip(t, { class: which === k ? 'primary small' : 'small', onclick: () => { app.dieStressFace = k; renderCenter(); } }), l))));
  let mn = Infinity, mx = -Infinity;
  for (const d of f.dies) for (const v of d[which].smax) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const scale = makeScale(mn, mx, mn < 0);
  const left = h('div');
  left.append(mapCanvas(res, (ctx, X, Y, sc) => { for (const d of f.dies) { drawGridField(ctx, d[which].xs, d[which].ys, d[which].smax, scale, X, Y, 1); const r = d.rect, b = C.CONST.DIE_EDGE_BAND; ctx.setLineDash([2, 2]); ctx.strokeStyle = cssVar('--muted'); ctx.strokeRect(X(r.x0 + b), Y(r.y1 - b), (r.x1 - r.x0 - 2 * b) * sc, (r.y1 - r.y0 - 2 * b) * sc); ctx.setLineDash([]); ctx.fillStyle = cssVar('--text'); ctx.beginPath(); ctx.arc(X(d[which].peakX), Y(d[which].peakY), 4, 0, 6.3); ctx.stroke(); } }));
  left.append(legendRow(scale, 'maximum principal stress, MPa, nodal averaged within the die; circle: interior peak; dashed: 0.5 mm edge band'));
  const right = h('div');
  for (const d of f.dies) {
    const s = d[which];
    right.append(h('div', { class: 'card' }, h('h3', null, d.name + ', ' + (which === 'top' ? 'backside' : 'active face')),
      h('div', { class: 'kv' }, kl('Interior peak (nodal averaged)', 'peakNodal'), h('b', { 'data-tip': 'Gauss-point peak in the interior: ' + fmt(s.gpPeakInterior, 1) + ' MPa; nodal extrapolation can differ meaningfully from Gauss-point values' }, fmt(s.peakInterior, 1) + ' MPa at (' + fmt(s.peakX, 1) + ', ' + fmt(s.peakY, 1) + ')'), kl('Interior peak (Gauss points)', 'peakGauss'), h('span', null, fmt(s.gpPeakInterior, 1) + ' MPa'), kl('Whole-face Gauss-point peak', 'peakAll'), h('span', null, fmt(s.gpPeakAll, 1) + ' MPa (includes singular edge region)'), ...s.corners.flatMap(c => [kl(c.name + ' (100 µm patch)', 'cornerPatch'), h('span', null, fmt(c.value, 1) + ' MPa')]), ...s.midEdges.flatMap(c => [kl(c.name + ' (100 µm patch)', 'cornerPatch'), h('span', null, fmt(c.value, 1) + ' MPa')]), cfg.limits.dieStrength ? kl('Margin to die strength', 'margin') : null, cfg.limits.dieStrength ? h('span', { class: cfg.limits.dieStrength > s.peakInterior ? 'ok' : 'bad' }, fmt(cfg.limits.dieStrength - s.peakInterior, 0) + ' MPa') : null),
      h('details', null, h('summary', null, 'What this means'), h('p', { class: 'small' }, 'Positive values are tensile. On the backside the dominant term is the bending of the die on the mismatched substrate; tensile backside stress is the usual state at room temperature for a bare die. Interior peaks are mesh-converging quantities; corner and mid-edge values sit at stress singularities and are averaged over a fixed 100 µm × 100 µm patch so that they can be compared between designs but never read as absolute strengths.'))));
  }
  root.append(h('div', { class: 'grid2' }, left, right));
}

function renderBumpView(root, res, f, Tsel) {
  const cfg = app.cfg;
  const state = app.bumpState || 'cpi';
  root.append(h('div', { class: 'row' }, h('b', null, 'Bump loading (chip-package interaction proxy)'), ...[['cpi', 'End of chip join, 25 °C (before underfill)', 'stateCpi'], ['asm', 'As-assembled', 'stateAsm']].map(([k, l, t]) => h('button', tip(t, { class: state === k ? 'primary small' : 'small', onclick: () => { app.bumpState = k; renderCenter(); } }), l)), state === 'asm' ? Tsel : null, h('span', { class: 'conf' }, CONFIDENCE.bumps)));
  const comp = app.bumpComp || 'V';
  root.append(h('div', { class: 'row' }, ...[['V', 'Shear force', 'compV'], ['N', 'Axial force', 'compN']].map(([k, l, t]) => h('button', tip(t, { class: comp === k ? 'primary small' : 'small', onclick: () => { app.bumpComp = k; renderCenter(); } }), l))));
  const list = state === 'cpi' ? res.cpi : f.dies.map(d => d.bumps);
  let mn = Infinity, mx = -Infinity;
  for (const b of list) for (const v of b[comp]) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const scale = makeScale(mn, mx, comp === 'N');
  const left = h('div');
  left.append(mapCanvas(res, (ctx, X, Y, sc) => { for (const b of list) drawPoints(ctx, b.x, b.y, b[comp], scale, X, Y, Math.max(1, 0.4 * res.geometry.dies[0].px * sc)); }));
  left.append(legendRow(scale, (comp === 'N' ? 'axial force per bump, N (tension positive)' : 'shear force per bump, N') + '; A_bump = π d_eff² / 4'));
  const right = h('div');
  list.forEach((b, i) => {
    right.append(h('div', { class: 'card' }, h('h3', null, b.die + (state === 'cpi' ? ', chip join cooldown (elastic upper bound; real joints relax by creep)' : ', as-assembled at ' + f.T + ' °C')),
      h('div', { class: 'kv' }, kl('Worst shear', 'worstV'), h('b', null, fmt(b.worstV, 3) + ' N = ' + gf(b.worstV) + ' gf' + (cfg.limits.bumpShearN ? (b.worstV > cfg.limits.bumpShearN ? ' (above threshold)' : ' (below threshold)') : '')), kl('Worst axial', 'worstN'), h('b', null, fmt(b.worstN, 3) + ' N = ' + gf(b.worstN) + ' gf' + (cfg.limits.bumpAxialN ? (Math.abs(b.worstN) > cfg.limits.bumpAxialN ? ' (above threshold)' : ' (below threshold)') : '')), kl('Bump area', 'abump'), h('span', null, fmtE(b.abump, 3) + ' mm² (d_eff ' + fmt(res.geometry.dies[i].deff * 1000, 1) + ' µm)')),
      h('table', tip('worstTable', { class: 'small' }), h('tr', null, h('th', null, 'x'), h('th', null, 'y'), h('th', null, 'N (N)', helpTip('compN')), h('th', null, 'V (N)', helpTip('compV'))), ...b.worst.map(q => h('tr', null, h('td', null, fmt(q.x, 2)), h('td', null, fmt(q.y, 2)), h('td', null, fmt(q.N, 4)), h('td', null, fmt(q.V, 4))))),
      h('details', null, h('summary', null, 'What this means'), h('p', { class: 'small' }, 'Forces are the solder-phase stress of the homogenized bump layer times the bump area (iso-strain mixture). The chip-join state carries the full die-substrate mismatch through the bumps alone and is typically the critical case for BEOL / low-k cracking at die corners; it is an elastic upper bound. Use the maps to rank bump locations and designs.'))));
  });
  root.append(h('div', { class: 'grid2' }, left, right));
}

function renderUFView(root, res, f, Tsel) {
  root.append(h('div', { class: 'row' }, h('b', null, 'Underfill interface tractions'), ' at ', Tsel, h('span', { class: 'conf' }, CONFIDENCE.corner)));
  for (const d of f.dies) {
    const u = d.uf;
    const c1 = h('canvas', tip('ufSide', { class: 'plot' })), c2 = h('canvas', tip('ufFace', { class: 'plot' }));
    root.append(h('div', { class: 'card' }, h('h3', null, d.name + ' perimeter (counterclockwise from the (−x, −y) corner)'), h('div', { class: 'grid2' }, c1, c2), h('div', { class: 'kv' }, kl('Max sidewall peel / shear', 'ufSide'), h('span', null, fmt(u.maxPeelSide, 1) + ' / ' + fmt(u.maxShearSide, 1) + ' MPa', helpTip('peel'), helpTip('shearT')), kl('Max active-face peel / shear', 'ufFace'), h('span', null, fmt(u.maxPeelFace, 1) + ' / ' + fmt(u.maxShearFace, 1) + ' MPa')), h('details', null, h('summary', null, 'What this means'), h('p', { class: 'small' }, 'Tractions are taken from the underfill-side stresses next to the die edge, averaged over 50 µm × 50 µm patches stepped along the perimeter. Peel is the traction normal to the interface (tension positive); shear is the in-plane traction magnitude. Peaks sit at the die corners (marked), where the elastic solution is singular; compare designs by these values, do not read them as strengths.'))));
    requestAnimationFrame(() => {
      const vl = u.corners.map((s, i) => ({ x: s, label: ['', 'corner', 'corner', 'corner', ''][i] }));
      linePlot(c1, [{ x: u.s, y: u.peelSide, label: 'peel (normal)' }, { x: u.s, y: u.shearSide, label: 'shear' }], { title: 'Die sidewall to fillet interface', xlabel: 'perimeter position, mm', ylabel: 'MPa', vlines: vl, hlines: [{ y: 0 }] });
      linePlot(c2, [{ x: u.s, y: u.peelFace, label: 'peel (normal)' }, { x: u.s, y: u.shearFace, label: 'shear' }], { title: 'Die active face to underfill interface near the edge', xlabel: 'perimeter position, mm', ylabel: 'MPa', vlines: vl, hlines: [{ y: 0 }] });
    });
  }
}

function renderFatigueView(root, res) {
  const cfg = app.cfg;
  root.append(h('div', { class: 'row' }, h('b', null, 'Solder fatigue'), h('span', { class: 'conf' }, CONFIDENCE.fatigue + ' Lives are order-of-magnitude; ratios against the baseline are the most trustworthy output.')));
  if (!res.screening) { root.append(h('div', { class: 'msg info' }, 'Screening needs the full analysis (cycling states).')); return; }
  let mn = Infinity, mx = -Infinity;
  for (const s of res.screening) for (const v of s.dW) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const scale = makeScale(mn, mx, false);
  const left = h('div');
  left.append(mapCanvas(res, (ctx, X, Y, sc) => { for (const s of res.screening) drawPoints(ctx, s.x, s.y, s.dW, scale, X, Y, Math.max(1, 0.4 * res.geometry.dies[0].px * sc)); for (const sm of app.submodels) { ctx.strokeStyle = cssVar('--err'); ctx.lineWidth = 2; ctx.strokeRect(X(sm.site.x) - 5, Y(sm.site.y) - 5, 10, 10); } }));
  left.append(legendRow(scale, 'ΔW_proxy, inelastic work density per stabilized cycle, MPa (screening index: ranks locations, not a life)'));
  const right = h('div');
  const sel = app.submodelSelection || defaultSubmodelSelection(res);
  app.submodelSelection = sel;
  const nxySel = h('select', tip('subRes'), ...[12, 16, 20].map(n => h('option', { value: n, selected: cfg.submodel.nxy === n ? '' : null }, n + ' × ' + n + ' × ' + (n === 12 ? 10 : n === 16 ? 14 : 18))));
  nxySel.addEventListener('change', () => { cfg.submodel.nxy = +nxySel.value; cfg.submodel.nz = +nxySel.value === 12 ? 10 : (+nxySel.value === 16 ? 14 : 18); });
  right.append(h('div', { class: 'card' }, h('h3', null, 'Screening ranking'), ...res.screening.map(s => h('div', null, h('b', null, s.die), h('table', { class: 'small' }, h('tr', null, h('th', null, 'select', helpTip('selectSite')), h('th', null, 'x'), h('th', null, 'y'), h('th', null, 'ΔW_proxy MPa', helpTip('dWproxy')), h('th', null, 'Δε̄p', helpTip('dEproxy'))), ...s.top.slice(0, 8).map(t => { const key = s.dieIdx + ':' + t.q; return h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: sel.has(key) ? '' : null, onchange: e => { if (e.target.checked) sel.add(key); else sel.delete(key); } })), h('td', null, fmt(t.x, 2)), h('td', null, fmt(t.y, 2)), h('td', null, fmtE(t.dW, 3)), h('td', null, fmtE(t.dE, 3))); })), h('div', tip('stab', { class: 'small muted' }), 'stabilization (last two cycles): ' + fmtE(s.stab[s.top[0] ? s.top[0].q : 0], 2) + (s.subsampled ? '; subsampled' : '') + '; ' + fmt(s.ms / 1000, 1) + ' s'))),
    h('div', { class: 'row' }, h('label', null, 'Submodel resolution ', nxySel), h('button', tip('runSub', { class: 'primary', onclick: () => runSubmodels(res) }), '▶ Run bump submodels for selected sites'))));
  for (const sm of app.submodels) right.append(renderSubmodelCard(sm));
  root.append(h('div', { class: 'grid2' }, left, right));
}
function defaultSubmodelSelection(res) {
  const sel = new Set();
  const all = [];
  res.screening.forEach(s => s.top.slice(0, 4).forEach(t => all.push({ key: s.dieIdx + ':' + t.q, dW: t.dW, die: s.dieIdx })));
  all.sort((a, b) => b.dW - a.dW);
  for (const a of all.slice(0, 4)) sel.add(a.key);
  res.screening.forEach(s => { if (s.top[0] && !Array.from(sel).some(k => k.startsWith(s.dieIdx + ':'))) sel.add(s.dieIdx + ':' + s.top[0].q); });
  return sel;
}
function runSubmodels(res) {
  const keys = Array.from(app.submodelSelection);
  if (!keys.length) { toast('Select at least one site.', 'warn'); return; }
  const cfg = app.cfg;
  const jobs = keys.map(k => { const [die, q] = k.split(':').map(Number); const s = res.screening[die]; return { die, site: { x: s.x[q], y: s.y[q], ix: s.ix[q], iy: s.iy[q] } }; });
  const onPartial = r => { app.submodels = app.submodels.filter(x => !(x.dieIdx === r.dieIdx && x.site.ix === r.site.ix && x.site.iy === r.site.iy)); app.submodels.push(r); renderCenter(); };
  const p = startRun({ type: 'submodels', jobs, nxy: cfg.submodel.nxy, nz: cfg.submodel.nz, workers: app.workers }, 'Bump submodels (' + jobs.length + ' sites)');
  const pend = worker.pending.get(worker.nextId - 1);
  if (pend) pend.onPartial = onPartial;
  p.then(() => renderCenter()).catch(e => { if (e.message !== 'cancelled') toast('Submodel failed: ' + e.message, 'error', 9000); });
}
function renderSubmodelCard(sm) {
  const c1 = h('canvas', tip('hysteresis', { class: 'plot' }));
  const base = app.baseline && app.baseline.submodelRef;
  const life = sm.life;
  const card = h('div', { class: 'card' }, h('h3', null, 'Submodel: ' + sm.die + ' bump at (' + fmt(sm.site.x, 2) + ', ' + fmt(sm.site.y, 2) + ') mm, ' + sm.nxy + '×' + sm.nxy + '×' + sm.nz + ' voxels'),
    h('div', { class: 'kv' }, kl('ΔW stabilized cycle (critical layer: ' + sm.critical + ')', 'subDW'), h('b', null, fmtE(sm.dW, 3) + ' MPa/cycle'), kl('die side / substrate side', 'subDW'), h('span', null, fmtE(sm.dWdie, 3) + ' / ' + fmtE(sm.dWsub, 3)), kl('Equivalent inelastic strain range', 'subDE'), h('span', null, fmtE(sm.dE, 3)), kl('Cycle-to-cycle change of ΔW', 'subStab'), h('span', { class: sm.stabWarn ? 'warnc' : 'ok' }, fmt(100 * sm.stabChange, 1) + ' %' + (sm.stabWarn ? ' (not stabilized; run more cycles)' : '')), kl('Life, Syed energy model', 'lifeSyedE'), h('b', null, fmt(life.syedEnergy, 0) + ' cycles'), kl('Life, Syed strain model', 'lifeSyedS'), h('span', null, fmt(life.syedStrain, 0) + ' cycles'), kl('Life, Darveaux', 'lifeDarv'), h('span', null, life.darveaux === null ? 'enter K1 to K4 in step 5' : fmt(life.darveaux, 0) + ' cycles (N0 ' + fmt(life.darveauxN0, 0) + ', a = ' + fmt(sm.dJoint * 1000, 0) + ' µm)'), app.baseline && app.baseline.submodels && app.baseline.submodels[0] ? kl('Life ratio vs baseline', 'lifeRatio') : null, app.baseline && app.baseline.submodels && app.baseline.submodels[0] ? h('b', null, fmt(life.syedEnergy / app.baseline.submodels[0].life.syedEnergy, 2)) : null, kl('Steps / cutbacks / Newton per step', 'subSteps'), h('span', null, sm.steps + ' / ' + sm.cutbacks + ' / ' + fmt(sm.newtonPerStep, 1) + ', ' + fmt(sm.ms / 1000, 1) + ' s')),
    c1, h('div', { class: 'small muted' }, 'Per cycle: ' + sm.perCycle.map(c => 'cycle ' + c.cycle + ': ' + fmtE(Math.max(c.dWdie, c.dWsub), 2)).join('; ')),
    h('details', null, h('summary', null, 'What this means'), h('p', { class: 'small' }, 'The submodel resolves one solder joint with the Anand viscoplastic model, driven by cut-boundary displacements from the global model. ΔW is the inelastic work density of the last simulated cycle averaged over a 25 µm layer at each interface; the larger side is used. Energy-based lives use Syed\'s constant (fitted to a different model and joint geometry) and are order-of-magnitude. The Darveaux model needs constants calibrated to this averaging scheme. The solder is assumed stress-free at 25 °C in the as-assembled state (room-temperature relaxation).')));
  requestAnimationFrame(() => linePlot(c1, [{ x: sm.loop.gamma, y: sm.loop.tau, label: 'die-side layer' }, { x: sm.loop.gammaSub, y: sm.loop.tauSub, label: 'substrate-side layer', dash: [3, 3] }], { title: 'Shear hysteresis (volume averaged in the interface layers, radial direction)', xlabel: 'shear strain γ', ylabel: 'τ, MPa', zero: false }));
  return card;
}

// ---- 3D view ----
function renderView3D(root, res, f, Tsel) {
  if (typeof THREE === 'undefined') {
    if (window.__threeFailed) { root.append(h('div', { class: 'msg warning' }, 'three.js could not be loaded from cdnjs, jsdelivr or unpkg (offline or blocked). The 3D view is unavailable; every other feature works.')); return; }
    root.append(h('div', { class: 'msg info' }, 'Loading three.js…'));
    if (window.__threeReady) window.__threeReady.then(() => { if (app.resultsView === 'view3d' || app.centerTab === 'view3d') renderCenter(); });
    return;
  }
  if (!res.view3d) { root.append(h('div', { class: 'msg info' }, 'The 3D view needs the full analysis.')); return; }
  const v = app.view3dOpts || (app.view3dOpts = { scale: 20, color: 'warpage', hidden: new Set() });
  const ctl = h('div', { class: 'row' }, h('b', null, '3D deformed shape'), ' at ', Tsel, h('label', tip('exag3d'), ' exaggeration ', h('input', { type: 'range', min: 1, max: 200, value: v.scale, oninput: e => { v.scale = +e.target.value; update3D(); } })), h('label', tip('color3d'), ' color by ', h('select', { onchange: e => { v.color = e.target.value; update3D(); } }, h('option', { value: 'warpage', selected: v.color === 'warpage' ? '' : null }, 'out-of-plane displacement'), h('option', { value: 'stress', selected: v.color === 'stress' ? '' : null }, 'max principal stress (per part)'), h('option', { value: 'part', selected: v.color === 'part' ? '' : null }, 'part'))), ...C.PART_NAMES.map((n, i) => (res.view3d.part.includes(i) ? h('label', tip('partToggle', { class: 'small' }), h('input', { type: 'checkbox', checked: v.hidden.has(i) ? null : '', onchange: e => { if (e.target.checked) v.hidden.delete(i); else v.hidden.add(i); update3D(); } }), ' ' + n) : null)));
  root.append(ctl);
  const el = h('div', { id: 'view3d' });
  root.append(el, view3dSplitter(), h('div', { class: 'legend', id: 'legend3d' }), h('div', { class: 'small muted' }, 'Drag to rotate, wheel to zoom, right-drag to pan.'));
  requestAnimationFrame(() => setup3D(el, res, f));
}
let three = null;
function setup3D(el, res, f) {
  if (three) { three.renderer.dispose(); three = null; }
  const w = el.clientWidth, hh = el.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, hh); renderer.setPixelRatio(window.devicePixelRatio || 1);
  el.innerHTML = ''; el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(isDark() ? 0x1c2027 : 0xffffff);
  const camera = new THREE.PerspectiveCamera(35, w / hh, 0.1, 10000);
  const sx = app.cfg.substrate.sx;
  camera.position.set(sx * 1.2, -sx * 1.4, sx * 1.0); camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(1, -1, 2); scene.add(dl);
  const geom = new THREE.BufferGeometry();
  const nf = res.view3d.part.length;
  const pos = new Float32Array(nf * 6 * 3), col = new Float32Array(nf * 6 * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  scene.add(mesh);
  three = { renderer, scene, camera, geom, pos, col, el, res, f, target: new THREE.Vector3(0, 0, 0) };
  // follow the pane size (3D grip, side-panel splitters, window resize)
  new ResizeObserver(() => {
    if (!three || three.el !== el) return;
    const w2 = el.clientWidth, h2 = el.clientHeight; if (!w2 || !h2) return;
    three.renderer.setSize(w2, h2); three.camera.aspect = w2 / h2;
    if (three.camera.updateProjectionMatrix) three.camera.updateProjectionMatrix();
    three.renderer.render(three.scene, three.camera);
  }).observe(el);
  // orbit controls
  let drag = null;
  el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, btn: e.button }; });
  window.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointermove', e => {
    if (!drag || !three) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    const cam = three.camera, t = three.target;
    const off = cam.position.clone().sub(t);
    if (drag.btn === 2) { const right = new THREE.Vector3().crossVectors(cam.getWorldDirection(new THREE.Vector3()), cam.up).normalize(); const up = cam.up.clone(); const k = off.length() * 0.0015; t.add(right.multiplyScalar(-dx * k)).add(up.multiplyScalar(dy * k)); cam.position.copy(t).add(off); }
    else { const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3(off.x, off.y, off.z)); const r = sph.radius; let theta = Math.atan2(off.y, off.x) - dx * 0.008; let phi = Math.acos(Math.max(-1, Math.min(1, off.z / r))) + dy * 0.008; phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi)); cam.position.set(t.x + r * Math.sin(phi) * Math.cos(theta), t.y + r * Math.sin(phi) * Math.sin(theta), t.z + r * Math.cos(phi)); }
    cam.lookAt(t); three.renderer.render(three.scene, cam);
  });
  el.addEventListener('wheel', e => { e.preventDefault(); if (!three) return; const cam = three.camera, t = three.target; const off = cam.position.clone().sub(t).multiplyScalar(e.deltaY > 0 ? 1.1 : 0.9); cam.position.copy(t).add(off); cam.lookAt(t); three.renderer.render(three.scene, cam); }, { passive: false });
  update3D();
}
function update3D() {
  if (!three) return;
  const { res, pos, col, geom } = three;
  const f = app.currentFields || res.at25;
  const v = app.view3dOpts;
  const q = res.view3d.quads, part = res.view3d.part, coords = res.view3d.coords, u = f.u;
  const stress = f.stress || res.view3d.stress25;
  let scale;
  if (v.color === 'warpage') { let mn = Infinity, mx = -Infinity; for (let n = 0; n < coords.length / 3; n++) { const z = u[3 * n + 2]; mn = Math.min(mn, z); mx = Math.max(mx, z); } scale = makeScale(mn * 1000, mx * 1000, true); }
  else if (v.color === 'stress') { let mx = 0, mn = Infinity; for (const s of stress) { mx = Math.max(mx, s); mn = Math.min(mn, s); } scale = makeScale(mn, mx, mn < 0); }
  const partCol = [[0.85, 0.78, 0.65], [0.72, 0.72, 0.72], [0.91, 0.72, 0.42], [0.91, 0.72, 0.42], [0.48, 0.65, 0.84], [0.84, 0.63, 0.84], [0.75, 0.54, 0.35], [0.62, 0.79, 0.65], [0.75, 0.54, 0.35], [0.62, 0.79, 0.65]];
  const ex = v.scale;
  let k = 0;
  const tri = [[0, 1, 2], [0, 2, 3]];
  const zmid = 0.5 * (res.geometry.zt);
  for (let fi = 0; fi < part.length; fi++) {
    if (v.hidden.has(part[fi])) { for (let t = 0; t < 18; t++) { pos[k * 3 + t] = 0; } k += 6; continue; }
    for (const tr of tri) for (const vi of tr) {
      const n = q[4 * fi + vi];
      pos[3 * k] = coords[3 * n] + ex * u[3 * n]; pos[3 * k + 1] = coords[3 * n + 1] + ex * u[3 * n + 1]; pos[3 * k + 2] = (coords[3 * n + 2] - zmid) + ex * u[3 * n + 2];
      let c;
      if (v.color === 'warpage') c = scale.rgb(u[3 * n + 2] * 1000).map(x => x / 255);
      else if (v.color === 'stress') c = scale.rgb(stress[4 * fi + vi]).map(x => x / 255);
      else c = partCol[part[fi]];
      col[3 * k] = c[0]; col[3 * k + 1] = c[1]; col[3 * k + 2] = c[2];
      k++;
    }
  }
  geom.attributes.position.needsUpdate = true; geom.attributes.color.needsUpdate = true;
  geom.computeVertexNormals(); geom.computeBoundingSphere();
  three.renderer.render(three.scene, three.camera);
  const lg = $('#legend3d');
  if (lg) { lg.innerHTML = ''; if (scale) { const cv = h('canvas'); lg.append(h('span', null, fmt(scale.min, 1)), cv, h('span', null, fmt(scale.max, 1)), h('span', null, v.color === 'warpage' ? 'u_z, µm (deformation exaggerated ' + ex + '×)' : 'max principal stress, MPa, nodal averaged per part')); drawLegend(cv, scale); } }
}

// ---- sensitivity (tornado) ----
function renderSensitivityView(root) {
  const cfg = app.cfg;
  const inputs = C.sensitivityInputs(cfg);
  if (!app.sensInputs) app.sensInputs = new Set(inputs.map(i => i.id));
  root.append(h('div', { class: 'row' }, h('b', null, 'Sensitivity (tornado), Draft preset'), h('span', { class: 'muted small' }, 'Each input is set to the low and high end of its range (datasheet range where given, else ±10 %, ±10 °C for temperatures). Results are cached by configuration hash.')));
  root.append(h('div', { class: 'row small' }, ...inputs.map(i => h('label', { class: 'pill', 'data-tip': TIPS.sensInput + (i.estimated ? ' This one is Estimated.' : '') }, h('input', { type: 'checkbox', checked: app.sensInputs.has(i.id) ? '' : null, onchange: e => { if (e.target.checked) app.sensInputs.add(i.id); else app.sensInputs.delete(i.id); } }), ' ' + i.label, i.estimated ? h('span', { class: 'badge Estimated' }, 'est.') : null))));
  const nw = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  root.append(h('div', { class: 'row' }, h('button', tip('sensRun', { class: 'primary', disabled: app.validation.errors.length ? '' : null, onclick: () => runSensitivity(inputs.filter(i => app.sensInputs.has(i.id)), nw) }), '▶ Run sensitivity (' + (2 * app.sensInputs.size + 1) + ' Draft analyses on ' + nw + ' workers)')));
  const S = app.sensitivity;
  if (!S) return;
  if (S.hash !== C.configHashes(cfg).model) root.append(h('div', { class: 'msg warning' }, 'The configuration changed since this sensitivity run.'));
  for (const [k, title, unit, mult, dg] of [['warpRT', 'RT signed warpage', 'µm', 1000, 1], ['warpPeak', 'Warpage at the reflow peak', 'µm', 1000, 1], ['dieStress', 'Die backside interior peak stress', 'MPa', 1, 1], ['dW', 'Worst-bump ΔW_proxy', 'MPa', 1, 4]]) {
    const t = S[k]; if (!t) continue;
    const cv = h('canvas', tip('tornado', { class: 'plot', style: 'height:' + (60 + 24 * t.rows.length) + 'px' }));
    root.append(h('div', { class: 'card' }, cv, h('div', { class: 'small muted' }, t.rows.map(r => r.label + ': ' + fmt(r.loValue, 3) + ' → ' + fmt(r.lo * mult, dg) + ' ' + unit + ', ' + fmt(r.hiValue, 3) + ' → ' + (r.hi >= 0 ? '+' : '') + fmt(r.hi * mult, dg) + ' ' + unit).join('; '))));
    requestAnimationFrame(() => tornadoPlot(cv, t.rows.map(r => ({ label: r.label, lo: r.lo * mult, hi: r.hi * mult })), t.base * mult, { title: title, unit, digits: dg }));
  }
  root.append(h('div', { class: 'small muted' }, 'Completed in ' + fmt(S.ms / 1000, 0) + ' s.'));
}
function runSensitivity(inputs, nWorkers) {
  const cfg = app.cfg;
  const cases = [{ id: '__base', cfg }];
  for (const inp of inputs) {
    const b = C.sensitivityBounds(cfg, inp);
    cases.push({ id: inp.id, side: 'lo', value: b.lo, base: b.base, cfg: C.applySensitivity(cfg, inp, b.lo) });
    cases.push({ id: inp.id, side: 'hi', value: b.hi, base: b.base, cfg: C.applySensitivity(cfg, inp, b.hi) });
  }
  const pool = [];
  for (let i = 0; i < nWorkers; i++) pool.push(new WorkerClient());
  const results = {};
  let next = 0, done = 0;
  const t0 = performance.now();
  setStatus('Sensitivity: 0/' + cases.length, 0);
  app.running = 'sensitivity';
  const cancelAll = () => { for (const p of pool) p.worker.terminate(); app.running = null; };
  $('#btn-cancel').onclick = () => { cancelAll(); setStatus('Sensitivity cancelled', null); $('#btn-cancel').onclick = defaultCancel; };
  return new Promise((resolve) => {
    const launch = w => {
      if (next >= cases.length) return;
      const c = cases[next++];
      w.send({ type: 'sensitivityCase', cfg: c.cfg }).then(r => { results[c.id + (c.side ? ':' + c.side : '')] = { r, c }; done++; setStatus('Sensitivity: ' + done + '/' + cases.length, done / cases.length); if (done === cases.length) finish(); else launch(w); }).catch(e => { toast('Sensitivity case failed: ' + e.message, 'error'); done++; if (done === cases.length) finish(); else launch(w); });
    };
    const finish = () => {
      cancelAll();
      $('#btn-cancel').onclick = defaultCancel;
      const base = results.__base && results.__base.r;
      if (!base) { setStatus('Ready', null); resolve(); return; }
      const byInput = {};
      for (const inp of inputs) { const lo = results[inp.id + ':lo'], hi = results[inp.id + ':hi']; if (lo && hi) byInput[inp.id] = { lo: lo.r, hi: hi.r, loValue: lo.c.value, hiValue: hi.c.value, baseValue: lo.c.base }; }
      app.sensitivity = Object.assign(C.tornadoFromCases(inputs, base, byInput), { hash: C.configHashes(cfg).model, ms: performance.now() - t0 });
      setStatus('Sensitivity done in ' + fmt((performance.now() - t0) / 1000, 0) + ' s', null);
      renderCenter(); resolve();
    };
    for (const w of pool) launch(w);
  });
}

// ---- verification ----
function renderVerificationView(root) {
  root.append(h('div', { class: 'row' }, h('b', null, 'Verification suite (Section 14)'), h('button', tip('verifyFast', { class: 'primary', onclick: () => runVerify(false) }), '▶ Run fast tests'), h('button', tip('verifyAll', { onclick: () => runVerify(true) }), 'Run all (includes slow convergence and timing tests)')));
  const V = app.verification;
  const tbl = h('table', { class: 'small' }, h('tr', null, h('th', null, 'ID'), h('th', null, 'Test'), h('th', null, 'Result'), h('th', null, 'Measured'), h('th', null, 'Criterion'), h('th', null, 's')));
  for (const t of C.VERIFICATION_TESTS) {
    const r = V && V.find(x => x.id === t.id);
    tbl.append(h('tr', null, h('td', null, t.id), h('td', null, t.name + (t.slow ? ' (slow)' : '')), h('td', { class: r ? (r.pass ? 'ok' : 'bad') : 'muted' }, r ? (r.pass ? 'PASS' : 'FAIL') : (app.verifying && app.verifying.has(t.id) ? 'running…' : '–')), h('td', { class: 'small' }, r ? r.measured : ''), h('td', { class: 'small muted' }, r ? r.criterion : ''), h('td', null, r ? fmt(r.ms / 1000, 1) : '')));
  }
  root.append(tbl);
}
function runVerify(all) {
  const ids = C.VERIFICATION_TESTS.filter(t => all || !t.slow).map(t => t.id);
  app.verification = app.verification || [];
  app.verifying = new Set(ids);
  startRun({ type: 'verify', ids, presets: ['draft', 'standard'] }, 'Verification', ).then(results => { for (const r of results) { app.verification = app.verification.filter(x => x.id !== r.id); app.verification.push(r); } app.verifying = null; renderCenter(); }).catch(e => { app.verifying = null; if (e.message !== 'cancelled') toast(e.message, 'error'); });
  // partial results stream in
  const p = worker.pending.get(worker.nextId - 1);
  if (p) p.onPartial = r => { app.verification = app.verification.filter(x => x.id !== r.id); app.verification.push(r); app.verifying.delete(r.id); renderCenter(); };
}

// ---- report and CSV ----
function renderReportView(root, res) {
  root.append(h('div', { class: 'row' }, h('button', tip('report', { class: 'primary', onclick: openReport }), 'Open printable report'), h('button', tip('exportCsv', { onclick: exportCSV }), 'Export CSV (scalars, ball warpage, bump loads)'), h('span', { class: 'muted small' }, 'The report opens in a new window; use the browser print dialog to save as PDF.')));
  root.append(h('div', { class: 'card' }, reportBody(res)));
}
function reportBody(res) {
  const cfg = app.cfg, f = res.at25, w = f.warpage;
  const div = h('div');
  div.append(h('h2', null, 'FCBGA thermomechanical screening report: ' + (cfg.name || 'configuration')));
  div.append(h('p', { class: 'small' }, 'Screening tool. Results are approximate and intended for design comparison and trend studies, not sign-off. Generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '. Configuration hash ' + res.hashes.all + '. Mesh preset ' + res.preset + ' (' + res.meshInfo.nDof + ' DOF).'));
  div.append(h('h3', null, 'Inputs'));
  const g = res.geometry;
  div.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Substrate'), h('span', null, cfg.substrate.sx + ' × ' + cfg.substrate.sy + ' mm, ' + cfg.substrate.layers.length + ' rows, ' + fmt(g.zt * 1000, 0) + ' µm'), h('span', { class: 'k' }, 'Configuration'), h('span', null, cfg.packageType), h('span', { class: 'k' }, 'Dies'), h('span', null, cfg.dies.map(d => d.name + ' ' + d.sx + '×' + d.sy + '×' + d.t + ' mm at (' + d.x + ', ' + d.y + ')').join('; ')), h('span', { class: 'k' }, 'Bumps'), h('span', null, cfg.dies.map(d => d.name + ': ' + d.bump.px * 1000 + ' µm pitch, UBM ' + d.bump.ubm * 1000 + ', SRO ' + d.bump.sro * 1000 + ', dmax ' + d.bump.dmax * 1000 + ' µm').join('; ') + '; standoff ' + cfg.bump.standoff * 1000 + ' µm, ' + cfg.bump.solder), h('span', { class: 'k' }, 'Underfill'), h('span', null, cfg.underfill.mat + ', W_f ' + cfg.underfill.Wf + ' mm, H_f ' + cfg.underfill.Hf), h('span', { class: 'k' }, 'Process'), h('span', null, 'T_sub ' + cfg.process.Tsub + ', T_join ' + cfg.process.Tjoin + ', T_UF ' + cfg.process.Tuf + ', T_attach ' + cfg.process.Tattach + ' °C'), h('span', { class: 'k' }, 'Cycling'), h('span', null, cfg.cycling.Tmin + ' / ' + cfg.cycling.Tmax + ' °C, ' + cfg.cycling.ramp + ' °C/min, ' + cfg.cycling.dwell + ' min dwell, ' + cfg.cycling.cycles + ' cycles')));
  div.append(h('h3', null, 'Results'));
  const tbl = h('table', null, h('tr', null, h('th', null, 'Quantity'), h('th', null, 'Value'), h('th', null, 'Confidence')));
  const add = (k, v, c) => tbl.append(h('tr', null, h('td', null, k), h('td', null, v), h('td', { class: 'small muted' }, c)));
  add('Signed warpage at 25 °C (JEITA)', um(w.signed) + ' µm (' + (w.sign > 0 ? 'convex' : 'concave') + ')', CONFIDENCE.warpage);
  for (const r of res.sweep.filter(r => cfg.reflow.reportTemps.includes(r.T))) add('Signed warpage at ' + r.T + ' °C', um(r.signed) + ' µm (limit ' + w.limitHot * 1000 + ')', CONFIDENCE.warpage);
  f.dies.forEach((d, i) => { add(d.name + ' backside interior peak stress', fmt(d.top.peakInterior, 1) + ' MPa', CONFIDENCE.dieInterior); add(d.name + ' backside corner patches', d.top.corners.map(c => fmt(c.value, 0)).join(' / ') + ' MPa', CONFIDENCE.corner); add(d.name + ' active-face interior peak', fmt(d.bottom.peakInterior, 1) + ' MPa', CONFIDENCE.dieInterior); add(d.name + ' worst CPI bump shear / axial', gf(res.cpi[i].worstV) + ' / ' + gf(res.cpi[i].worstN) + ' gf', CONFIDENCE.bumps); add(d.name + ' underfill max sidewall peel / shear', fmt(d.uf.maxPeelSide, 1) + ' / ' + fmt(d.uf.maxShearSide, 1) + ' MPa', CONFIDENCE.corner); });
  if (res.screening) res.screening.forEach(s => add(s.die + ' worst ΔW_proxy', fmtE(s.top[0] ? s.top[0].dW : NaN, 3) + ' MPa/cycle', CONFIDENCE.fatigue));
  for (const sm of app.submodels) add('Submodel ' + sm.die + ' (' + fmt(sm.site.x, 1) + ', ' + fmt(sm.site.y, 1) + ') ΔW / Syed life', fmtE(sm.dW, 3) + ' MPa, ' + fmt(sm.life.syedEnergy, 0) + ' cycles', CONFIDENCE.fatigue);
  div.append(tbl);
  if (app.sensitivity && app.sensitivity.warpRT) div.append(h('p', { class: 'small' }, 'Sensitivity (RT warpage), top drivers: ' + app.sensitivity.warpRT.rows.slice(0, 5).map(r => r.label).join(', ') + '.'));
  const estList = estimatedInputsInUse(cfg);
  div.append(h('h3', null, 'Estimated inputs in use (' + estList.length + ')'), h('p', { class: 'small' }, estList.map(e => e.material + ': ' + e.label + ' = ' + (typeof e.value === 'number' ? fmtInput(e.value) : e.value) + ' ' + e.unit).join('; ') || 'none'));
  div.append(h('h3', null, 'Assumptions and limitations'), h('ul', { class: 'small' }, ...limitationsList(res).map(t => h('li', null, t))));
  div.append(h('h3', null, 'Verification'));
  if (app.verification && app.verification.length) div.append(h('table', { class: 'small' }, h('tr', null, h('th', null, 'ID'), h('th', null, 'Result'), h('th', null, 'Measured')), ...app.verification.map(r => h('tr', null, h('td', null, r.id), h('td', { class: r.pass ? 'ok' : 'bad' }, r.pass ? 'PASS' : 'FAIL'), h('td', null, r.measured)))));
  else div.append(h('p', { class: 'small muted' }, 'Verification suite not run in this session.'));
  div.append(h('h3', null, 'Materials used'));
  const mt = h('table', { class: 'small' }, h('tr', null, h('th', null, 'Role'), h('th', null, 'Material'), h('th', null, 'Key properties'), h('th', null, 'Sources')));
  for (const r of C.materialRoles(cfg)) { const m = C.findMaterial(cfg.materials, r.id); const rows = paramRows(m, { elastic: m.elastic, cte: m.cte, cteXY: m.cteXY, cteZ: m.cteZ }, '', []).filter(x => !x.table); mt.append(h('tr', null, h('td', null, r.role), h('td', null, m.name + (m.modified ? ' (modified)' : '')), h('td', null, rows.map(x => paramLabel(x.path) + ' ' + x.par.v + ' ' + (x.par.u || '') + ' [' + (x.par.c || '') + ']').join(', ')), h('td', null, Array.from(new Set(rows.flatMap(x => x.par.s || []))).map(s => s + ': ' + (MATERIALS_DB.references[s] ? MATERIALS_DB.references[s].cite : '')).join(' | ')))); }
  div.append(mt);
  return div;
}
function openReport() {
  const res = app.results; if (!res) return;
  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked; allow pop-ups to open the report.', 'warn'); return; }
  const body = reportBody(res);
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>FCBGA screening report</title><style>' + document.querySelector('style').textContent + ' body{overflow:auto;padding:24px;background:#fff;color:#111} .kv{margin:6px 0}</style></head><body><div style="max-width:900px;margin:auto">' + body.outerHTML + '<p class="small muted">Print this page to PDF with the browser print dialog.</p></div></body></html>');
  win.document.close();
}
function exportCSV() {
  const res = app.results; if (!res) return;
  const cfg = app.cfg, f = res.at25;
  const lines = ['section,quantity,value,unit'];
  lines.push('warpage,signed_25C,' + f.warpage.signed * 1000 + ',um', 'warpage,magnitude_25C,' + f.warpage.mag * 1000 + ',um');
  for (const r of res.sweep) lines.push('warpage_sweep,T=' + r.T + ',' + r.signed * 1000 + ',um');
  f.dies.forEach((d, i) => { lines.push('die_stress,' + d.name + '_top_interior_peak,' + d.top.peakInterior + ',MPa', 'die_stress,' + d.name + '_bottom_interior_peak,' + d.bottom.peakInterior + ',MPa'); d.top.corners.forEach(c => lines.push('die_stress,' + d.name + '_top_' + c.name.replace(/[ ,()]/g, '_') + ',' + c.value + ',MPa')); lines.push('bumps,' + d.name + '_cpi_worst_shear,' + res.cpi[i].worstV + ',N', 'bumps,' + d.name + '_cpi_worst_axial,' + res.cpi[i].worstN + ',N', 'uf,' + d.name + '_max_sidewall_peel,' + d.uf.maxPeelSide + ',MPa', 'uf,' + d.name + '_max_sidewall_shear,' + d.uf.maxShearSide + ',MPa'); });
  if (res.screening) res.screening.forEach(s => lines.push('fatigue,' + s.die + '_worst_dW_proxy,' + (s.top[0] ? s.top[0].dW : '') + ',MPa'));
  for (const sm of app.submodels) lines.push('submodel,' + sm.die + '_' + sm.site.x + '_' + sm.site.y + '_dW,' + sm.dW + ',MPa', 'submodel,' + sm.die + '_' + sm.site.x + '_' + sm.site.y + '_life_syed,' + sm.life.syedEnergy + ',cycles');
  lines.push('', 'ball_x_mm,ball_y_mm,warpage_residual_25C_um,w_25C_um');
  for (let q = 0; q < f.warpage.ballX.length; q++) lines.push(f.warpage.ballX[q] + ',' + f.warpage.ballY[q] + ',' + f.warpage.ballRes[q] * 1000 + ',' + f.warpage.ballW[q] * 1000);
  res.cpi.forEach((b, i) => { lines.push('', 'die,bump_x_mm,bump_y_mm,N_cpi_N,V_cpi_N,N_asm25_N,V_asm25_N'); const a = f.dies[i].bumps; for (let q = 0; q < b.x.length; q++) lines.push(b.die + ',' + b.x[q] + ',' + b.y[q] + ',' + b.N[q] + ',' + b.V[q] + ',' + a.N[q] + ',' + a.V[q]); });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: (cfg.name || 'fcbga').replace(/[^\w.-]+/g, '_') + '_results.csv' });
  document.body.appendChild(a); a.click(); a.remove();
}

function limitationsList(res) {
  const cfg = app.cfg;
  const L = [
    'Total (secant) thermoelastic formulation with element birth for all non-solder materials in the global model: path independent, no viscoelastic relaxation. Each polymer\'s effective stress-free temperature is exposed as a knob (default: cure temperature).',
    'Polymer properties above Tg are partly estimated (rubbery moduli of ABF and solder resist, all Poisson ratios of polymers, TIM gel). Values flagged Estimated should be replaced by measured or DMA data.',
    'Substrate layers are homogenized with mixture rules (Voigt / Reuss / Turner) per physical layer and integrated layer by layer within four element bands; a Cu pattern is treated as a uniform fraction, not as routed geometry.',
    'Bumps are homogenized in the global model as a superposed solder phase and underfill phase sharing nodes (iso-strain / Voigt), exact for the through-thickness and transverse shear load paths of short columns, an upper bound for in-plane membrane stiffness.',
    'The underfill fillet is a stair-stepped approximation of a linear wedge on the global z-planes.',
    'Solder above its solidus (217 °C for SAC305) is represented by a modulus floor of 1 % of E(217 °C); states above the solidus are flagged "solder molten".',
    'Uniform temperature only: no power maps or gradients. No BGA balls or PCB (second-level), no mold compound, no passives, no moisture swelling, no Cu plasticity, no fracture mechanics, no initial substrate warpage from fabrication, no gravity.',
    'Singular quantities (die corners, interface corners, fatigue indices) are mesh dependent and reported as comparative metrics over fixed physical patches.',
    'Fatigue constants come from other joint geometries and constitutive models; lives are order-of-magnitude and best used as ratios against a pinned baseline. The submodel assumes the solder is stress-free at 25 °C in the as-assembled state.',
    'Silicon elastic constants are temperature independent; Cu and metals are elastic.',
    'Poisson ratios are clamped to 0.45 in the global hexahedral elements (B-bar elements in the submodel accept up to 0.49).',
    'Layered substrate bands use the continuum-shell form of each sub-layer stiffness (plane-stress in-plane block, uncoupled thickness modulus), because one thickness strain shared by all sub-layers of a band over-constrains the Poisson expansion (0.7 % warpage bias against lamination theory).',
    'No automatic analysis after editing: dragging or releasing a die (or any other edit) starts no solve, and the floorplan overlay is hidden while the geometry differs from the last analysis. The analysis runs only from step 6 (Run full global analysis, or Quick preview on the Draft mesh).',
    'Contour colours default to a rainbow scale (purple low to red high). It is not colorblind safe or perceptually uniform: bright yellow and cyan bands can suggest features that are not there. Switch to the colorblind-safe scales with the "colors" dropdown in the Results bar.',
    'Parallel workers: the temperature sweep and the bump submodels can be split over several Web Workers; each holds its own copy of the model, so peak memory grows with the worker count (shown in the run panel).',
    'Build decisions: the multigrid coarse space uses per-column shell aggregates (rigid-body plus thickness modes of each stiff stack) because plain nodal interpolation stalls on thin layered structures; the full symmetric block matrix is stored (instead of the upper triangle) for faster smoothing; single-material elements use a closed-form 12-point rule that reproduces 2×2×2 Gauss exactly.',
  ];
  if (res && res.notes) L.push(...res.notes);
  return L;
}
