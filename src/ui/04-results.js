// ===== UI: step 6, run controls, results views, 3D, sensitivity, verification, report ====

/** Silicon parts with die stress maps (monolithic dies, chiplets, Si bases); results saved before stacked modules list dies only. */
const siList = f => f.si || f.dies;

const CONFIDENCE = {
  warpage: 'Moderate confidence; most sensitive to stress-free temperature assumptions and polymer properties above Tg.',
  dieInterior: 'Moderate confidence.',
  corner: 'Comparative only; singular locations, mesh dependent.',
  bumps: 'Comparative only; use for ranking designs and locations.',
  fatigue: 'Comparative only; use for ranking designs and locations.',
  section: 'Interior of dies and lids: moderate confidence. Corners, fillet edges and material interfaces: comparative only; singular locations, mesh dependent.',
  subSection: 'Comparative only; stress change over the temperature cycle (or total stress with the global 25 °C residual added) on a stair-stepped joint; pad edges and joint corners are singular and mesh dependent.',
};

function renderRunPanel(root) {
  const cfg = app.cfg;
  root.append(h('h2', null, '6. Run and results'));
  root.append(selectField('Mesh fidelity', () => cfg.mesh.preset, v => { cfg.mesh.preset = v; renderContext(); }, Object.entries(C.CONST.MESH_PRESETS).map(([k, p]) => ({ value: k, label: p.label + ' (h ' + p.hmin + ' to ' + p.hmax + ' mm, cap ' + p.cap.toLocaleString() + ' DOF)' })), { help: 'preset', section: 'mesh' }));
  const hc = navigator.hardwareConcurrency || 2;
  root.append(h('div', { class: 'field' }, h('label', null, 'Parallel workers', helpTip('workers')), h('select', { 'data-tip': TIPS.workers, onchange: e => { app.workers = +e.target.value; renderContext(); } }, ...Array.from({ length: maxWorkers() }, (_, i) => i + 1).map(n => h('option', { value: n, selected: app.workers === n ? '' : null }, n + (n === 1 ? ' (single worker)' : ' workers')))), h('span', { class: 'unit' }, hc + ' cores' + (app.desktop ? ', ' + fmt(app.desktop.totalMemGB, 0) + ' GB memory' : '') + (app.nestedWorkers === false ? '; nested workers unavailable in this browser' : ''))));
  const est = estimateRun(cfg, cfg.mesh.preset);
  if (est.error) root.append(h('div', { class: 'msg error' }, est.error));
  else {
    app.meshWarnings = est.warnings;
    // the browser holds every worker in one tab, whose memory it limits; the desktop app's compute processes are bounded by the computer only
    const sysMB = app.desktop ? app.desktop.totalMemGB * 1024 : null;
    const memNote = sysMB ? (est.memMB > DESKTOP_MEM_WARN * sysMB ? '; close to or above this computer\'s ' + fmt(app.desktop.totalMemGB, 0) + ' GB of memory' : '') : (est.memMB > 600 ? '; above the 600 MB target, reduce the worker count if memory is tight' : '');
    root.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Compute engine', helpTip('computeEngine')), h('span', null, DESKTOP ? 'desktop app: a separate compute process per worker, limited by this computer\'s memory' + (app.desktop ? ' (' + fmt(app.desktop.totalMemGB, 0) + ' GB) and ' + app.desktop.cpus + ' logical cores' : '') : 'browser Web Workers, all within this tab (the browser limits one tab\'s memory)'),
      h('span', { class: 'k' }, 'Estimated mesh'), h('span', null, est.info.nx + ' × ' + est.info.ny + ' × ' + est.info.nz + ' grid, ' + est.info.nElem.toLocaleString() + ' elements, ' + est.info.nDof.toLocaleString() + ' DOF' + (est.info.scaled ? ' (sizes enlarged to meet the cap)' : '')), h('span', { class: 'k' }, 'Element sizes'), h('span', null, 'h_min ' + fmt(est.info.hmin, 3) + ', h_max ' + fmt(est.info.hmax, 3) + ' mm; max aspect ' + fmt(est.info.aspectMax, 0)), h('span', { class: 'k' }, 'Estimated memory'), h('span', { class: memNote ? 'warnc' : '' }, fmt(est.memMB, 0) + ' MB total (main worker ' + fmt(est.mainMB, 0) + ' MB' + (app.workers > 1 ? ', each helper ' + fmt(est.helperMB, 0) + ' MB' : '') + memNote + ')'), h('span', { class: 'k' }, 'Estimated runtime'), h('span', null, 'preview ' + fmt(est.previewS, 0) + ' s, full analysis ' + fmt(est.fullS, 0) + ' s (' + est.nSteps + ' thermal-path solves) with ' + app.workers + ' worker' + (app.workers > 1 ? 's' : '') + ' (scales with your CPU)')));
  }
  const canRun = !app.validation.errors.length;
  root.append(h('div', { class: 'row' }, h('button', tip('runFull', { class: 'primary', disabled: canRun ? null : '', onclick: () => runFull() }), '▶ Run full global analysis'), h('button', tip('quickPreview', { disabled: canRun ? null : '', onclick: () => runPreview() }), 'Quick preview (Draft, 25 °C)')));
  root.append(h('div', { class: 'row' }, h('button', tip('pinBaseline', { disabled: app.results ? null : '', onclick: pinBaseline }), 'Pin as baseline'), h('button', tip('clearBaseline', { disabled: app.baseline ? null : '', onclick: () => { app.baseline = null; renderContext(); } }), 'Clear baseline'), h('button', tip('meshCheck', { disabled: canRun ? null : '', onclick: checkMeshSensitivity }), 'Check mesh sensitivity'), h('button', tip('exportCsv', { disabled: app.results ? null : '', onclick: exportCSV }), 'Export CSV'), h('button', tip('report', { disabled: app.results ? null : '', onclick: openReport }), 'Report (print / PDF)')));
  root.append(h('div', { class: 'row' }, h('button', tip('saveResults', { disabled: app.results ? null : '', onclick: saveResultsFile }), 'Save results (' + C.CONST.RESULTS_FILE_EXT + ')'), h('button', tip('openResults', { onclick: pickResultsFile }), 'Open results file')));
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
  siList(f).forEach((d, i) => {
    const bd = base && siList(base.at25)[i];
    root.append(h('div', { class: 'card' }, h('h3', null, d.name + ' backside stress', helpTip('peakNodal')), h('div', { class: 'big' }, fmt(d.top.peakInterior, 1) + ' MPa'), h('div', { class: 'sub' }, 'interior peak (0.5 mm edge band excluded), max principal, nodal averaged; Gauss-point peak ' + fmt(d.top.gpPeakInterior, 1) + ' MPa' + (bd ? delta(d.top.peakInterior, bd.top.peakInterior, ' MPa', 1) : '') + (cfg.limits.dieStrength ? '; margin to strength ' + fmt(cfg.limits.dieStrength - d.top.peakInterior, 0) + ' MPa' : '')), h('div', { class: 'sub' }, 'corner patches 1 / 2 / 3 / 4 (comparative): ' + d.top.corners.map(c => fmt(c.value, 0)).join(' / ') + ' MPa'), h('div', { class: 'conf' }, CONFIDENCE.dieInterior + ' Corner values: ' + CONFIDENCE.corner)));
  });
  res.cpi.forEach((b, i) => {
    const bb = base && base.cpi[i];
    root.append(h('div', { class: 'card' }, h('h3', null, b.die + ' bump loading (CPI proxy)', helpTip('stateCpi')), h('div', { class: 'big' }, gf(b.worstV) + ' gf shear'), h('div', { class: 'sub' }, 'worst bump at chip join cooldown, before underfill; axial ' + gf(b.worstN) + ' gf (' + fmt(b.worstN, 3) + ' N)' + (bb ? delta(b.worstV, bb.worstV, ' N', 3) : '')), h('div', { class: 'conf' }, 'Elastic upper bound; real joints relax by creep during cooldown. ' + CONFIDENCE.bumps)));
  });
  if (res.ddiJoin) res.ddiJoin.forEach((b, i) => {
    const bb = base && base.ddiJoin && base.ddiJoin[i];
    root.append(h('div', { class: 'card' }, h('h3', null, b.die + ' DDI microbumps', helpTip('stateDdiJoin')), h('div', { class: 'big' }, gf(b.worstV) + ' gf shear'), h('div', { class: 'sub' }, 'worst microbump at chiplet join cooldown, before the DDI fill; axial ' + gf(b.worstN) + ' gf (' + fmt(b.worstN, 4) + ' N)' + (bb ? delta(b.worstV, bb.worstV, ' N', 4) : '')), h('div', { class: 'conf' }, 'Elastic upper bound; real joints relax by creep during cooldown. ' + CONFIDENCE.bumps)));
  });
  if (res.ddiScreening) res.ddiScreening.forEach((s, i) => {
    const bs = base && base.ddiScreening && base.ddiScreening[i];
    root.append(h('div', { class: 'card' }, h('h3', null, s.die + ' DDI microbump screening', helpTip('ddiScreen')), h('div', { class: 'big' }, fmtE(s.top[0] ? s.top[0].dW : NaN, 3) + ' MPa/cycle'), h('div', { class: 'sub' }, 'worst-site ΔW_proxy of the solder caps at (' + fmt(s.top[0] && s.top[0].x, 3) + ', ' + fmt(s.top[0] && s.top[0].y, 3) + ') mm' + (bs && bs.top[0] ? delta(s.top[0].dW, bs.top[0].dW, ' MPa', 4) : '')), h('div', { class: 'conf' }, 'Screening index; ranks locations; not a life.')));
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
  const request = { type: 'run', cfg: structuredClone(app.cfg), preset: app.cfg.mesh.preset, evaluations: 'full', workers: app.workers };
  startRun(Object.assign({}, request), 'Full global analysis').then(res => {
    res.request = request; app.analysisLost = false;
    app.results = res; app.fieldsCache.clear(); app.sectionCache.clear(); app.sectionDraft = null; app.currentFields = res.at25; app.selectedT = 25; app.dirty = false;
    app.screening = res.screening || null; app.submodels = [];
    setCenterTab('results'); renderAll();
  }).catch(err => { if (err.message !== 'cancelled' && !err.reported) toast('Analysis failed: ' + err.message, 'error', 9000); });
}
function runPreview() {
  if (app.validation.errors.length) return;
  const request = { type: 'run', cfg: structuredClone(app.cfg), preset: 'draft', evaluations: 'preview', workers: app.workers };
  startRun(Object.assign({}, request), 'Draft preview').then(res => {
    res.preview = true; res.request = request; app.analysisLost = false;
    app.results = res; app.fieldsCache.clear(); app.sectionCache.clear(); app.sectionDraft = null; app.currentFields = res.at25; app.selectedT = 25;
    floorplan.draw();
    renderContext();
  }).catch(err => { if (err.message !== 'cancelled' && !err.reported) toast('Preview failed: ' + err.message, 'error'); });
}
/**
 * Run one job with its progress in the status bar (one job at a time; a new job cancels the running one).
 * The main worker holds the analysis behind app.results, which the temperature selector and the submodels read.
 * Jobs that neither produce nor read it (opts.side: verification, mesh check, core study) run on a one-shot
 * worker instead, so that running or cancelling them never discards it. opts.onPartial receives streamed results.
 * msg may also be a function (send, progress) => Promise for a job of several messages, where send(m) posts one
 * message and progress(frac, text) reports. opts.cancel replaces the restart of the main worker on cancel, for jobs that
 * only read from it. opts.notify: true shows the end-of-run dialog (src/ui/00f-runreport.js) when the job finishes or
 * fails, 'fail' only when it fails, false never; by default analyses, submodels and verification notify. A failure
 * shown in a dialog carries err.reported, so callers skip their own message.
 */
function startRun(msg, label, opts) {
  opts = opts || {};
  if (app.job) cancelRunning();
  const side = !!opts.side, client = side ? new WorkerClient() : worker;
  const job = { label, cancel: side ? () => client.stop() : (opts.cancel || null) };
  app.job = job;
  const t0 = performance.now();
  const one = typeof msg === 'function' ? {} : msg;
  progressBegin(label, { kind: one.type === 'run' ? 'analysis' : (one.type || 'other'), msg: one, preset: one.preset ? (C.CONST.MESH_PRESETS[one.preset] || { label: one.preset }).label : (one.type === 'submodels' ? (one.nxy + ' x ' + one.nxy + ' x ' + one.nz + ' voxels') : '') });
  setStatus(label + ' starting…', 0);
  const onProgress = (frac, m) => { if (app.job === job) { progressMsg(frac, m); setStatus(label + ': ' + m, frac); } };
  const p = typeof msg === 'function'
    ? msg(m => { if (app.job !== job) return Promise.reject(new Error('cancelled')); return client.send(m, onProgress, opts.onPartial); }, onProgress)
    : client.send(msg, onProgress, opts.onPartial);
  const notify = opts.notify !== undefined ? opts.notify : ['run', 'submodels', 'verify'].includes(one.type);
  // the record is copied before it closes, for the end-of-run dialog; null when the job was cancelled or replaced
  const settle = () => { if (side) client.stop(); if (app.job !== job) return null; const snap = progressSnapshot() || {}; app.job = null; progressEnd(); return snap; };
  return p.then(res => {
    const snap = settle();
    if (snap) { setStatus(label + ' done in ' + fmt((performance.now() - t0) / 1000, 1) + ' s', null); if (notify === true) runFinishedDialog(label, one, res, snap); }
    return res;
  }, err => {
    const snap = settle();
    if (snap) { setStatus(label + ' ' + RUN_FAIL_TITLE[failureKind(err)], null); if (notify && err.message !== 'cancelled') { runFailedDialog(label, one, err, snap); err.reported = true; } }
    throw err;
  });
}
/**
 * Cancel the running job. Side and sensitivity workers are simply stopped; anything else runs on the main worker,
 * which is restarted, and that discards the analysis behind the results. Returns true when it did so just now.
 */
function cancelRunning() {
  const job = app.job;
  app.job = null;
  progressEnd();
  if (job && job.cancel) { job.cancel(); return false; }
  if (!job && !worker.pending.size) return false;  // the main worker is idle: nothing to cancel, keep its analysis
  worker.cancel();
  const lost = !!app.results && !app.analysisLost;
  if (app.results) app.analysisLost = true;
  return lost;
}
/** Re-run the analysis behind the results (same configuration snapshot, preset and workers) after a cancel discarded it. */
function restoreAnalysis() {
  const old = app.results;
  if (!old || !old.request) return;
  startRun(Object.assign({}, old.request), 'Restoring the analysis').then(res => {
    res.request = old.request; res.preview = old.preview; app.analysisLost = false; app.analysisLostWhy = null;
    app.results = res;
    if (res.screening) app.screening = res.screening;
    renderAll();
    toast('Analysis restored; other temperatures and the bump submodels are available again.', 'ok');
  }).catch(err => { if (err.message !== 'cancelled' && !err.reported) toast('Restore failed: ' + err.message, 'error', 9000); });
}
/** Notice above the results while the analysis behind them is not in the worker (null otherwise). */
function analysisLostNotice() {
  if (!app.analysisLost || !app.results) return null;
  if (app.analysisLost === 'loading') return h('div', { class: 'msg info' }, 'Loading the analysis behind these results from the results file; other temperatures, cross-sections and the bump submodels are available once it is back (see the status bar).');
  const est = app.results.totalMs ? ' (about ' + fmt(app.results.totalMs / 1000, 0) + ' s, like the original run)' : '';
  const why = {
    stopped: 'The compute process stopped unexpectedly (most likely the computer ran out of memory), so the analysis behind these results is no longer in memory',
    file: app.analysisLostWhy ? 'The analysis saved in the results file could not be loaded (' + app.analysisLostWhy + ')' : 'The results file was saved without the analysis behind its results',
  }[app.analysisLost] || 'A cancelled job restarted the worker, so the analysis behind these results is no longer in memory';
  return h('div', { class: 'msg warning' }, why + '. The states already loaded stay visible; other temperatures and the bump submodels need the analysis. ',
    h('button', tip('restoreAnalysis', { class: 'small', onclick: restoreAnalysis }), 'Restore analysis' + est));
}
/** Message for a view that needs the analysis while it is not in the worker (app.analysisLost set). */
function analysisMissing(what) {
  return what + (app.analysisLost === 'loading' ? ' the analysis, which is still loading from the results file; try again when it is back.' : ' the analysis, which is not in memory; use Restore analysis above the results first.');
}
function pinBaseline() { app.baseline = app.results; toast('Baseline pinned: ' + (app.cfg.name || 'current configuration') + ' at ' + app.results.preset + '.', 'ok'); renderContext(); }

function checkMeshSensitivity() {
  const order = ['draft', 'standard', 'fine'];
  const cur = app.cfg.mesh.preset, next = order[Math.min(order.indexOf(cur) + 1, 2)];
  if (next === cur) { toast('Already at the finest preset.', 'warn'); return; }
  const run = preset => startRun({ type: 'run', cfg: app.cfg, preset, evaluations: 'preview', workers: app.workers }, 'Mesh check at ' + preset, { side: true, notify: 'fail' });
  run(cur).then(a => run(next).then(b => {
    const wa = a.at25.warpage.signed, wb = b.at25.warpage.signed;
    const sa = a.at25.dies[0].top.peakInterior, sb = b.at25.dies[0].top.peakInterior;
    const fa = a.cpi[0].worstV, fb = b.cpi[0].worstV;
    const pc = (x, y) => fmt(100 * Math.abs(x / y - 1), 1) + ' %';
    const conv = [wa / wb, sa / sb, fa / fb].every(r => Math.abs(r - 1) < 0.05);
    showModal('Mesh sensitivity: ' + cur + ' → ' + next, h('div', null, h('table', null, h('tr', null, h('th'), h('th', null, cur + ' (' + a.meshInfo.nDof + ' DOF)'), h('th', null, next + ' (' + b.meshInfo.nDof + ' DOF)'), h('th', null, 'change')), h('tr', null, h('td', null, 'RT signed warpage'), h('td', null, um(wa) + ' µm'), h('td', null, um(wb) + ' µm'), h('td', null, pc(wa, wb))), h('tr', null, h('td', null, 'Die interior peak stress'), h('td', null, fmt(sa, 1) + ' MPa'), h('td', null, fmt(sb, 1) + ' MPa'), h('td', null, pc(sa, sb))), h('tr', null, h('td', null, 'Worst bump shear force'), h('td', null, fmt(fa, 3) + ' N'), h('td', null, fmt(fb, 3) + ' N'), h('td', null, pc(fa, fb)))), h('p', { class: conv ? 'ok' : 'warnc' }, conv ? 'Verdict: converged within 5 %.' : 'Verdict: results still mesh-sensitive; use the finer preset for decisions.')));
  })).catch(e => { if (e.message !== 'cancelled' && !e.reported) toast(e.message, 'error'); });
}
function runCoreStudy() {
  const A = C.presetConfig(MATERIALS_DB, 'coreStudy', 'A'), B = C.presetConfig(MATERIALS_DB, 'coreStudy', 'B');
  const preset = app.cfg.mesh.preset;
  startRun({ type: 'run', cfg: A, preset, evaluations: 'preview' }, 'Core study A (0.4 mm)', { side: true, notify: 'fail' }).then(ra => startRun({ type: 'run', cfg: B, preset, evaluations: 'preview' }, 'Core study B (0.8 mm)', { side: true, notify: 'fail' }).then(rb => {
    showModal('Core thickness study (bare die, 3-2-3)', h('div', null, h('table', null, h('tr', null, h('th'), h('th', null, 'A: 0.4 mm core'), h('th', null, 'B: 0.8 mm core')), h('tr', null, h('td', null, 'RT signed warpage'), h('td', null, um(ra.at25.warpage.signed) + ' µm'), h('td', null, um(rb.at25.warpage.signed) + ' µm')), h('tr', null, h('td', null, 'Die backside interior peak'), h('td', null, fmt(ra.at25.dies[0].top.peakInterior, 1) + ' MPa'), h('td', null, fmt(rb.at25.dies[0].top.peakInterior, 1) + ' MPa')), h('tr', null, h('td', null, 'Worst CPI bump shear'), h('td', null, gf(ra.cpi[0].worstV) + ' gf'), h('td', null, gf(rb.cpi[0].worstV) + ' gf'))), h('p', { class: 'small muted' }, 'Resonac TEG-like construction [R2]; Cu thickness per layer (15 µm) is not stated by the source and was assumed.')));
  })).catch(e => { if (e.message !== 'cancelled' && !e.reported) toast(e.message, 'error'); });
}

// ---- results views in the center area ----
const RESULT_VIEWS = [['warpage', 'Warpage', 'viewWarpage'], ['dieStress', 'Die stress', 'viewDieStress'], ['bumps', 'Bump loading', 'viewBumps'], ['uf', 'Underfill interface', 'viewUf'], ['section', 'Cross-section stress', 'viewSection'], ['fatigue', 'Solder fatigue', 'viewFatigue'], ['subSection', 'Submodel section', 'viewSubSection'], ['view3d', '3D view', 'view3d'], ['sensitivity', 'Sensitivity', 'viewSens'], ['verification', 'Verification', 'viewVerify'], ['report', 'Report', 'viewReport']];

function renderResults(root) {
  const res = app.results;
  const colorSel = h('label', tip('colorMap', { class: 'small' }), 'colors ', h('select', { onchange: e => { app.colorMap = e.target.value; prefs.set('colorMap', app.colorMap); renderCenter(); } }, h('option', { value: 'rainbow', selected: app.colorMap === 'rainbow' ? '' : null }, 'rainbow'), h('option', { value: 'colorblind', selected: app.colorMap === 'colorblind' ? '' : null }, 'colorblind-safe')));
  const bar = h('div', { class: 'row' }, ...RESULT_VIEWS.map(([k, l, t]) => h('button', tip(t, { class: app.resultsView === k ? 'primary small' : 'small', onclick: () => { app.resultsView = k; renderCenter(); } }), l)), colorSel);
  root.append(bar);
  if (!res && !['sensitivity', 'verification'].includes(app.resultsView)) { root.append(h('div', { class: 'msg info' }, 'Run the analysis (step 6) to see results.')); return; }
  const lostNote = analysisLostNotice();
  if (lostNote) root.append(lostNote);
  const Tsel = res ? h('select', tip('tempSelect', { onchange: e => selectTemperature(+e.target.value) }), ...Array.from(new Set([25].concat(app.cfg.reflow.reportTemps, res.temps.all))).sort((a, b) => a - b).filter(T => res.temps.all.includes(T)).map(T => h('option', { value: T, selected: T === app.selectedT ? '' : null }, T + ' °C'))) : null;
  const f = app.currentFields;
  switch (app.resultsView) {
    case 'warpage': renderWarpageView(root, res, f, Tsel); break;
    case 'dieStress': renderDieStressView(root, res, f, Tsel); break;
    case 'bumps': renderBumpView(root, res, f, Tsel); break;
    case 'uf': renderUFView(root, res, f, Tsel); break;
    case 'section': renderSectionView(root, res, f, Tsel); break;
    case 'fatigue': renderFatigueView(root, res); break;
    case 'subSection': renderSubmodelSectionView(root); break;
    case 'view3d': renderView3D(root, res, f, Tsel); break;
    case 'sensitivity': renderSensitivityView(root); break;
    case 'verification': renderVerificationView(root); break;
    case 'report': renderReportView(root, res); break;
  }
}
function selectTemperature(T) {
  app.selectedT = T;
  if (app.fieldsCache.has(T)) { app.currentFields = app.fieldsCache.get(T); renderCenter(); floorplan.draw(); return; }
  if (app.analysisLost) { app.selectedT = app.currentFields ? app.currentFields.T : 25; toast(analysisMissing('The ' + T + ' °C state needs'), 'warn', 7000); renderCenter(); return; }
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
/** Corner numbers 1 to 4 just outside a die rectangle (clockwise from the bottom-right corner, C.dieCorners). */
function drawCornerNumbers(ctx, rect, X, Y) {
  ctx.fillStyle = cssVar('--text'); ctx.font = '600 11px ' + cssVar('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const c of C.dieCorners(rect)) ctx.fillText(String(c.n), X(c.x) + 8 * c.sx, Y(c.y) - 8 * c.sy);
}
function legendRow(scale, label) { return h('div', { class: 'legend' }, ...legendItems(scale, label)); }

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
  for (const d of siList(f)) for (const v of d[which].smax) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const scale = makeScale(mn, mx, mn < 0);
  const left = h('div');
  left.append(mapCanvas(res, (ctx, X, Y, sc) => { for (const d of siList(f)) { drawGridField(ctx, d[which].xs, d[which].ys, d[which].smax, scale, X, Y, 1); const r = d.rect, b = C.CONST.DIE_EDGE_BAND; ctx.setLineDash([2, 2]); ctx.strokeStyle = cssVar('--muted'); ctx.strokeRect(X(r.x0 + b), Y(r.y1 - b), (r.x1 - r.x0 - 2 * b) * sc, (r.y1 - r.y0 - 2 * b) * sc); ctx.setLineDash([]); ctx.strokeStyle = cssVar('--text'); ctx.beginPath(); ctx.arc(X(d[which].peakX), Y(d[which].peakY), 4, 0, 6.3); ctx.stroke(); drawCornerNumbers(ctx, r, X, Y); } }));
  left.append(legendRow(scale, 'maximum principal stress, MPa, nodal averaged within the die'));
  left.append(lineKey([{ label: 'die outline', color: cssVar('--text'), dash: [4, 3] }, { label: 'inner edge of the 0.5 mm edge band (excluded from the interior peak)', color: cssVar('--muted'), dash: [2, 2] }, { label: 'interior peak', color: cssVar('--text'), marker: 'circle' }]));
  left.append(h('div', { class: 'small muted' }, 'Die corners 1 to 4 run clockwise from the bottom-right (+x, −y) corner.'));
  const right = h('div');
  for (const d of siList(f)) {
    const s = d[which];
    right.append(h('div', { class: 'card' }, h('h3', null, d.name + ', ' + (which === 'top' ? 'backside' : 'active face')),
      h('div', { class: 'kv' }, kl('Interior peak (nodal averaged)', 'peakNodal'), h('b', { 'data-tip': 'Gauss-point peak in the interior: ' + fmt(s.gpPeakInterior, 1) + ' MPa; nodal extrapolation can differ meaningfully from Gauss-point values' }, fmt(s.peakInterior, 1) + ' MPa at (' + fmt(s.peakX, 1) + ', ' + fmt(s.peakY, 1) + ')'), kl('Interior peak (Gauss points)', 'peakGauss'), h('span', null, fmt(s.gpPeakInterior, 1) + ' MPa'), kl('Whole-face Gauss-point peak', 'peakAll'), h('span', null, fmt(s.gpPeakAll, 1) + ' MPa (includes singular edge region)'), ...s.corners.flatMap(c => [kl(c.name + ', 100 µm patch', 'cornerPatch'), h('span', null, fmt(c.value, 1) + ' MPa')]), ...s.midEdges.flatMap(c => [kl(c.name + ', 100 µm patch', 'cornerPatch'), h('span', null, fmt(c.value, 1) + ' MPa')]), cfg.limits.dieStrength ? kl('Margin to die strength', 'margin') : null, cfg.limits.dieStrength ? h('span', { class: cfg.limits.dieStrength > s.peakInterior ? 'ok' : 'bad' }, fmt(cfg.limits.dieStrength - s.peakInterior, 0) + ' MPa') : null),
      h('details', null, h('summary', null, 'What this means'), h('p', { class: 'small' }, 'Positive values are tensile. On the backside the dominant term is the bending of the die on the mismatched substrate; tensile backside stress is the usual state at room temperature for a bare die. Interior peaks are mesh-converging quantities; corner and mid-edge values sit at stress singularities and are averaged over a fixed 100 µm × 100 µm patch so that they can be compared between designs but never read as absolute strengths.'))));
  }
  root.append(h('div', { class: 'grid2' }, left, right));
}

function renderBumpView(root, res, f, Tsel) {
  const cfg = app.cfg;
  const state = app.bumpState || 'cpi';
  // stacked modules: flip chip bumps or DDI microbumps
  const hasDdi = !!(f.ddi && f.ddi.length), ddi = hasDdi && app.bumpLayer === 'ddi';
  if (hasDdi) root.append(h('div', { class: 'row' }, ...[['c4', 'Flip chip bumps', 'layerC4'], ['ddi', 'DDI microbumps (chiplets)', 'layerDdi']].map(([k, l, t]) => h('button', tip(t, { class: (app.bumpLayer || 'c4') === k ? 'primary small' : 'small', onclick: () => { app.bumpLayer = k; renderCenter(); } }), l))));
  root.append(h('div', { class: 'row' }, h('b', null, ddi ? 'DDI microbump loading' : 'Bump loading (chip-package interaction proxy)'), ...[['cpi', ddi ? 'End of chiplet join, 25 °C (before the DDI fill)' : 'End of chip join, 25 °C (before underfill)', ddi ? 'stateDdiJoin' : 'stateCpi'], ['asm', 'As-assembled', 'stateAsm']].map(([k, l, t]) => h('button', tip(t, { class: state === k ? 'primary small' : 'small', onclick: () => { app.bumpState = k; renderCenter(); } }), l)), state === 'asm' ? Tsel : null, h('span', { class: 'conf' }, CONFIDENCE.bumps)));
  const comp = app.bumpComp || 'V';
  root.append(h('div', { class: 'row' }, ...[['V', 'Shear force', 'compV'], ['N', 'Axial force', 'compN']].map(([k, l, t]) => h('button', tip(t, { class: comp === k ? 'primary small' : 'small', onclick: () => { app.bumpComp = k; renderCenter(); } }), l))));
  const list = ddi ? (state === 'cpi' ? res.ddiJoin || [] : f.ddi.map(c => c.bumps)) : (state === 'cpi' ? res.cpi : f.dies.map(d => d.bumps));
  if (!list || !list.length) { root.append(h('div', { class: 'msg info' }, 'This state needs the full analysis (not the quick preview).')); return; }
  let mn = Infinity, mx = -Infinity;
  for (const b of list) for (const v of b[comp]) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const scale = makeScale(mn, mx, comp === 'N');
  const left = h('div');
  const dotPitch = ddi ? Math.min(cfg.stack.ddi.px, cfg.stack.ddi.py) : res.geometry.dies[0].px;
  left.append(mapCanvas(res, (ctx, X, Y, sc) => { for (const b of list) drawPoints(ctx, b.x, b.y, b[comp], scale, X, Y, Math.max(1, 0.4 * dotPitch * sc)); }));
  left.append(legendRow(scale, (comp === 'N' ? 'axial force per ' + (ddi ? 'microbump' : 'bump') + ', N (tension positive)' : 'shear force per ' + (ddi ? 'microbump' : 'bump') + ', N') + (ddi ? '; A = π d² / 4 of the microbump (Cu pillar and solder cap in series)' : '; A_bump = π d_eff² / 4')));
  const right = h('div');
  list.forEach((b, i) => {
    right.append(h('div', { class: 'card' }, h('h3', null, b.die + (state === 'cpi' ? (ddi ? ', chiplet join cooldown (elastic upper bound; real joints relax by creep)' : ', chip join cooldown (elastic upper bound; real joints relax by creep)') : ', as-assembled at ' + f.T + ' °C')),
      h('div', { class: 'kv' }, kl('Worst shear', 'worstV'), h('b', null, fmt(b.worstV, 3) + ' N = ' + gf(b.worstV) + ' gf' + (cfg.limits.bumpShearN ? (b.worstV > cfg.limits.bumpShearN ? ' (above threshold)' : ' (below threshold)') : '')), kl('Worst axial', 'worstN'), h('b', null, fmt(b.worstN, 3) + ' N = ' + gf(b.worstN) + ' gf' + (cfg.limits.bumpAxialN ? (Math.abs(b.worstN) > cfg.limits.bumpAxialN ? ' (above threshold)' : ' (below threshold)') : '')), kl('Bump area', 'abump'), h('span', null, fmtE(b.abump, 3) + ' mm² (' + (ddi ? 'd ' : 'd_eff ') + fmt(2 * Math.sqrt(b.abump / Math.PI) * 1000, 1) + ' µm)')),
      h('table', tip('worstTable', { class: 'small' }), h('tr', null, h('th', null, 'x'), h('th', null, 'y'), h('th', null, 'N (N)', helpTip('compN')), h('th', null, 'V (N)', helpTip('compV'))), ...b.worst.map(q => h('tr', null, h('td', null, fmt(q.x, 2)), h('td', null, fmt(q.y, 2)), h('td', null, fmt(q.N, 4)), h('td', null, fmt(q.V, 4))))),
      h('details', null, h('summary', null, 'What this means'), h('p', { class: 'small' }, ddi ? 'Forces are the stress of the microbump phase of the homogenized DDI gap times the microbump area: each joint a Cu pillar and a solder cap in series (axial and transverse shear stiffness, no in-plane force), so its axial and shear stress are those of both. The chiplet-join state is the joined module cooled to 25 °C before its wafer underfill or mold is born, when the microbumps alone carry the chiplet-to-base mismatch (small on a Si base, larger on an RDL interposer); it is an elastic upper bound. The as-assembled values also carry the module bending on the substrate. Use the maps to rank microbump locations and designs.' : 'Forces are the solder-phase stress of the homogenized bump layer times the bump area (column phase: axial and transverse shear stiffness of the joints, no in-plane force). The chip-join state carries the full die-substrate mismatch through the bumps alone and is typically the critical case for BEOL / low-k cracking at die corners; it is an elastic upper bound. Use the maps to rank bump locations and designs.'))));
  });
  root.append(h('div', { class: 'grid2' }, left, right));
}

function renderUFView(root, res, f, Tsel) {
  // stacked modules: the flip chip underfill, or the wafer underfill (or mold) around each chiplet
  const hasDdi = !!(f.ddi && f.ddi.length), wc = hasDdi && app.ufLayer === 'wcuf', mold = wc && f.ddi[0].wcuf.fill === 'mold';
  if (hasDdi) root.append(h('div', { class: 'row' }, ...[['fli', 'Flip chip underfill', 'layerFli'], ['wcuf', f.ddi[0].wcuf.fill === 'mold' ? 'Wafer mold at the chiplets' : 'Wafer underfill at the chiplets', 'layerWcuf']].map(([k, l, t]) => h('button', tip(t, { class: (app.ufLayer || 'fli') === k ? 'primary small' : 'small', onclick: () => { app.ufLayer = k; renderCenter(); } }), l))));
  root.append(h('div', { class: 'row' }, h('b', null, wc ? (mold ? 'Wafer mold interface tractions at the chiplets' : 'Wafer underfill interface tractions') : 'Underfill interface tractions'), ' at ', Tsel, h('span', { class: 'conf' }, CONFIDENCE.corner)));
  const fill = mold ? 'mold' : 'wafer underfill';
  for (const d of (wc ? f.ddi.map(c => ({ name: c.name, uf: c.wcuf })) : f.dies)) {
    const u = d.uf;
    const c1 = h('canvas', tip('ufSide', { class: 'plot' })), c2 = h('canvas', tip('ufFace', { class: 'plot' }));
    root.append(h('div', { class: 'card' }, h('h3', null, d.name + ' perimeter, clockwise from corner 1 (bottom right, +x −y); corners 1 to 4 run clockwise'), h('div', { class: 'grid2' }, c1, c2), h('div', { class: 'kv' }, kl('Max sidewall peel / shear', 'ufSide'), h('span', null, fmt(u.maxPeelSide, 1) + ' / ' + fmt(u.maxShearSide, 1) + ' MPa', helpTip('peel'), helpTip('shearT')), kl('Max active-face peel / shear', 'ufFace'), h('span', null, fmt(u.maxPeelFace, 1) + ' / ' + fmt(u.maxShearFace, 1) + ' MPa')), h('details', null, h('summary', null, 'What this means'), h('p', { class: 'small' }, (wc ? 'At a chiplet the sidewall traction is taken from the ' + fill + ' just outside the chiplet edge (the wafer mold where the fillet has ended), and the face traction from the DDI fill under the chiplet edge. ' : '') + 'Tractions are taken from the underfill-side stresses next to the die edge, averaged over 50 µm × 50 µm patches stepped along the perimeter. Peel is the traction normal to the interface (tension positive); shear is the in-plane traction magnitude. Peaks sit at the die corners (marked), where the elastic solution is singular; compare designs by these values, do not read them as strengths.'))));
    requestAnimationFrame(() => {
      const vl = u.corners.map((s, i) => ({ x: s, label: 'corner ' + (i % 4 + 1), bottom: true }));  // labels at the bottom, clear of the series legend
      linePlot(c1, [{ x: u.s, y: u.peelSide, label: 'peel (normal)' }, { x: u.s, y: u.shearSide, label: 'shear' }], { title: wc ? 'Chiplet sidewall to ' + fill + ' interface' : 'Die sidewall to fillet interface', xlabel: 'perimeter position from corner 1, clockwise, mm', ylabel: 'MPa', vlines: vl, hlines: [{ y: 0 }] });
      linePlot(c2, [{ x: u.s, y: u.peelFace, label: 'peel (normal)' }, { x: u.s, y: u.shearFace, label: 'shear' }], { title: wc ? 'Chiplet active face to ' + fill + ' (DDI gap) near the edge' : 'Die active face to underfill interface near the edge', xlabel: 'perimeter position from corner 1, clockwise, mm', ylabel: 'MPa', vlines: vl, hlines: [{ y: 0 }] });
    });
  }
}

function renderFatigueView(root, res) {
  const cfg = app.cfg;
  root.append(h('div', { class: 'row' }, h('b', null, 'Solder fatigue'), h('span', { class: 'conf' }, CONFIDENCE.fatigue + ' Lives are order-of-magnitude; ratios against the baseline are the most trustworthy output.')));
  if (!res.screening) { root.append(h('div', { class: 'msg info' }, 'Screening needs the full analysis (cycling states).')); return; }
  if (res.ddiScreening && res.ddiScreening.length) {
    root.append(h('div', { class: 'row' }, ...[['c4', 'Flip chip bumps', 'layerC4'], ['ddi', 'DDI microbumps (chiplets)', 'layerDdi']].map(([k, l, t]) => h('button', tip(t, { class: (app.fatigueLayer || 'c4') === k ? 'primary small' : 'small', onclick: () => { app.fatigueLayer = k; renderCenter(); } }), l))));
    if (app.fatigueLayer === 'ddi') { renderDdiScreening(root, res); return; }
  }
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
  right.append(h('div', { class: 'card' }, h('h3', null, 'Screening ranking'), ...res.screening.map(s => h('div', null, h('b', null, s.die), h('table', { class: 'small' }, h('tr', null, h('th', null, 'select', helpTip('selectSite')), h('th', null, 'x'), h('th', null, 'y'), h('th', null, 'ΔW_proxy MPa', helpTip('dWproxy')), h('th', null, 'Δε̄p', helpTip('dEproxy'))), ...s.top.slice(0, 8).map(t => { const key = s.dieIdx + ':' + t.q; return h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: sel.has(key) ? '' : null, disabled: submodelAllowed(res, s.dieIdx) ? null : '', 'data-tip': submodelAllowed(res, s.dieIdx) ? null : TIPS.subNotAllowed, onchange: e => { if (e.target.checked) sel.add(key); else sel.delete(key); } })), h('td', null, fmt(t.x, 2)), h('td', null, fmt(t.y, 2)), h('td', null, fmtE(t.dW, 3)), h('td', null, fmtE(t.dE, 3))); })), h('div', tip('stab', { class: 'small muted' }), 'stabilization (last two cycles): ' + fmtE(s.stab[s.top[0] ? s.top[0].q : 0], 2) + (s.subsampled ? '; subsampled' : '') + '; ' + fmt(s.ms / 1000, 1) + ' s'))),
    h('div', { class: 'row' }, h('label', null, 'Submodel resolution ', nxySel), h('button', tip('runSub', { class: 'primary', onclick: () => runSubmodels(res) }), '▶ Run bump submodels for selected sites'))));
  for (const sm of app.submodels) right.append(renderSubmodelCard(sm));
  root.append(h('div', { class: 'grid2' }, left, right));
}
/** Screening of the DDI microbumps: map and ranking per chiplet (no submodels for microbumps). */
function renderDdiScreening(root, res) {
  const list = res.ddiScreening;
  let mn = Infinity, mx = -Infinity;
  for (const s of list) for (const v of s.dW) if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const scale = makeScale(mn, mx, false), pitch = Math.min(app.cfg.stack.ddi.px, app.cfg.stack.ddi.py);
  const left = h('div');
  left.append(mapCanvas(res, (ctx, X, Y, sc) => { for (const s of list) drawPoints(ctx, s.x, s.y, s.dW, scale, X, Y, Math.max(1, 0.4 * pitch * sc)); }));
  left.append(legendRow(scale, 'ΔW_proxy of the DDI microbump solder caps, MPa per stabilized cycle (screening index: ranks locations, not a life)'));
  const right = h('div', null, h('div', { class: 'card' }, h('h3', null, 'DDI microbump screening ranking', helpTip('ddiScreen')), ...list.map(s => h('div', null, h('b', null, s.die), h('table', { class: 'small' }, h('tr', null, h('th', null, 'x'), h('th', null, 'y'), h('th', null, 'ΔW_proxy MPa', helpTip('dWproxy')), h('th', null, 'Δε̄p', helpTip('dEproxy'))), ...s.top.slice(0, 8).map(t => h('tr', null, h('td', null, fmt(t.x, 3)), h('td', null, fmt(t.y, 3)), h('td', null, fmtE(t.dW, 3)), h('td', null, fmtE(t.dE, 3))))), h('div', tip('stab', { class: 'small muted' }), 'stabilization (last two cycles): ' + fmtE(s.stab[s.top[0] ? s.top[0].q : 0], 2) + (s.subsampled ? '; subsampled to ' + s.nSites + ' sites' : '') + '; ' + fmt(s.ms / 1000, 1) + ' s'))),
    h('div', { class: 'small muted' }, 'Each microbump is a free-standing column of its solder cap on an elastic Cu pillar, driven by the axial and shear strain of the DDI gap. Bump submodels are not available for microbumps.')));
  root.append(h('div', { class: 'grid2' }, left, right));
}
/** Bump submodels need a Si slice above the joint: not under an organic RDL interposer or a Si base thinner than the slice. */
function submodelAllowed(res, dieIdx) { const d = res.geometry.dies[dieIdx]; return !d || d.sub !== false; }
function defaultSubmodelSelection(res) {
  const sel = new Set();
  const all = [];
  const screens = res.screening.filter(s => submodelAllowed(res, s.dieIdx));
  screens.forEach(s => s.top.slice(0, 4).forEach(t => all.push({ key: s.dieIdx + ':' + t.q, dW: t.dW, die: s.dieIdx })));
  all.sort((a, b) => b.dW - a.dW);
  for (const a of all.slice(0, 4)) sel.add(a.key);
  screens.forEach(s => { if (s.top[0] && !Array.from(sel).some(k => k.startsWith(s.dieIdx + ':'))) sel.add(s.dieIdx + ':' + s.top[0].q); });
  return sel;
}
function runSubmodels(res) {
  const keys = Array.from(app.submodelSelection);
  if (!keys.length) { toast('Select at least one site.', 'warn'); return; }
  if (app.analysisLost) { toast(analysisMissing('The submodels need'), 'warn', 7000); return; }
  const cfg = app.cfg;
  const jobs = keys.map(k => { const [die, q] = k.split(':').map(Number); const s = res.screening[die]; return { die, site: { x: s.x[q], y: s.y[q], ix: s.ix[q], iy: s.iy[q] } }; });
  const onPartial = r => { app.submodels = app.submodels.filter(x => !(x.dieIdx === r.dieIdx && x.site.ix === r.site.ix && x.site.iy === r.site.iy)); app.submodels.push(r); renderCenter(); };
  const p = startRun({ type: 'submodels', jobs, nxy: cfg.submodel.nxy, nz: cfg.submodel.nz, workers: app.workers }, 'Bump submodels (' + jobs.length + ' sites)', { onPartial });
  p.then(() => renderCenter()).catch(e => { if (e.message !== 'cancelled' && !e.reported) toast('Submodel failed: ' + e.message, 'error', 9000); });
}
function renderSubmodelCard(sm) {
  const c1 = h('canvas', tip('hysteresis', { class: 'plot' }));
  const base = app.baseline && app.baseline.submodelRef;
  const life = sm.life;
  const card = h('div', { class: 'card' }, h('h3', null, 'Submodel: ' + sm.die + ' bump at (' + fmt(sm.site.x, 2) + ', ' + fmt(sm.site.y, 2) + ') mm, ' + sm.nxy + '×' + sm.nxy + '×' + sm.nz + ' voxels'),
    h('div', { class: 'kv' }, kl('ΔW stabilized cycle (critical layer: ' + sm.critical + ')', 'subDW'), h('b', null, fmtE(sm.dW, 3) + ' MPa/cycle'), kl('die side / substrate side', 'subDW'), h('span', null, fmtE(sm.dWdie, 3) + ' / ' + fmtE(sm.dWsub, 3)), kl('Equivalent inelastic strain range', 'subDE'), h('span', null, fmtE(sm.dE, 3)), kl('Cycle-to-cycle change of ΔW', 'subStab'), h('span', { class: sm.stabWarn ? 'warnc' : 'ok' }, fmt(100 * sm.stabChange, 1) + ' %' + (sm.stabWarn ? ' (not stabilized; run more cycles)' : '')), kl('Life, Syed energy model', 'lifeSyedE'), h('b', null, fmt(life.syedEnergy, 0) + ' cycles'), kl('Life, Syed strain model', 'lifeSyedS'), h('span', null, fmt(life.syedStrain, 0) + ' cycles'), kl('Life, Darveaux', 'lifeDarv'), h('span', null, life.darveaux === null ? 'enter K1 to K4 in step 5' : fmt(life.darveaux, 0) + ' cycles (N0 ' + fmt(life.darveauxN0, 0) + ', a = ' + fmt(sm.dJoint * 1000, 0) + ' µm)'), app.baseline && app.baseline.submodels && app.baseline.submodels[0] ? kl('Life ratio vs baseline', 'lifeRatio') : null, app.baseline && app.baseline.submodels && app.baseline.submodels[0] ? h('b', null, fmt(life.syedEnergy / app.baseline.submodels[0].life.syedEnergy, 2)) : null, kl('Steps / cutbacks / Newton per step', 'subSteps'), h('span', null, sm.steps + ' / ' + sm.cutbacks + ' / ' + fmt(sm.newtonPerStep, 1) + ', ' + fmt(sm.ms / 1000, 1) + ' s')),
    c1, h('div', { class: 'small muted' }, 'Per cycle: ' + sm.perCycle.map(c => 'cycle ' + c.cycle + ': ' + fmtE(Math.max(c.dWdie, c.dWsub), 2)).join('; ')),
    sm.section ? h('button', tip('openSubSection', { class: 'small', onclick: () => { app.subSection.key = subSecKey(sm); app.subSection.snap = null; app.subSection.pos = null; app.resultsView = 'subSection'; renderCenter(); } }), 'Cross-section of this submodel') : null,
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
  const v = app.view3dOpts || (app.view3dOpts = { scale: 20, color: 'warpage', hidden: new Set(), mesh: false });
  const mi = res.meshInfo;
  const meshNote = h('div', { class: 'small muted', style: v.mesh ? '' : 'display:none' }, 'Element mesh: ' + mi.nElem.toLocaleString() + ' hexahedral elements, ' + mi.nNodes.toLocaleString() + ' nodes (' + mi.nDof.toLocaleString() + ' DOF), ' + (mi.nx - 1) + ' × ' + (mi.ny - 1) + ' in-plane cells and ' + (mi.nz - 1) + ' element layers through the stack, ' + mi.preset + ' preset (h ' + fmt(mi.hmin, 2) + ' to ' + fmt(mi.hmax, 2) + ' mm). Only the outer faces of the shown parts are drawn; hide parts to see the mesh under them.');
  const meshBox = h('label', tip('mesh3d', { class: 'small' }), h('input', { type: 'checkbox', checked: v.mesh ? '' : null, onchange: e => { v.mesh = e.target.checked; meshNote.style.display = v.mesh ? '' : 'none'; update3D(); } }), ' element mesh');
  const ctl = h('div', { class: 'row' }, h('b', null, '3D deformed shape'), ' at ', Tsel, h('label', tip('exag3d'), ' exaggeration ', h('input', { type: 'range', min: 1, max: 200, value: v.scale, oninput: e => { v.scale = +e.target.value; update3D(); } })), h('label', tip('color3d'), ' color by ', h('select', { onchange: e => { v.color = e.target.value; update3D(); } }, h('option', { value: 'warpage', selected: v.color === 'warpage' ? '' : null }, 'out-of-plane displacement'), h('option', { value: 'stress', selected: v.color === 'stress' ? '' : null }, 'max principal stress (per part)'), h('option', { value: 'part', selected: v.color === 'part' ? '' : null }, 'part'))), meshBox, ...C.PART_NAMES.map((n, i) => (res.view3d.part.includes(i) ? h('label', tip('partToggle', { class: 'small' }), h('input', { type: 'checkbox', checked: v.hidden.has(i) ? null : '', onchange: e => { if (e.target.checked) v.hidden.delete(i); else v.hidden.add(i); update3D(); } }), ' ' + n) : null)));
  root.append(ctl);
  const el = h('div', { id: 'view3d' });
  root.append(el, view3dSplitter(), h('div', { class: 'legend', id: 'legend3d' }), meshNote, h('div', { class: 'small muted' }, 'Drag to rotate, wheel to zoom, right-drag to pan.'));
  requestAnimationFrame(() => setup3D(el, res, f));
}
let three = null;
function setup3D(el, res, f) {
  if (three) { three.renderer.dispose(); three = null; }
  const w = el.clientWidth, hh = el.clientHeight;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (e) {
    // no WebGL (graphics acceleration off, remote desktop without a GPU): explain instead of failing
    el.replaceWith(h('div', { class: 'msg warning' }, 'The 3D view needs WebGL, which is not available here (' + e.message + '). It usually comes back with graphics acceleration enabled or on a computer with a working graphics driver; every other view works without it.'));
    return;
  }
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
  // faces pushed back slightly in depth so the mesh overlay lines draw on top of them
  const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
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
/** Unique edges of the boundary quads, per part (an edge between two parts is kept once for each, so hiding one keeps the other's). */
function meshEdges3D(view) {
  if (view.edges) return view.edges;
  const q = view.quads, part = view.part, nn = view.coords.length / 3;
  const seen = new Set(), list = [], parts = [];
  for (let f = 0; f < part.length; f++) for (let v = 0; v < 4; v++) {
    const a = q[4 * f + v], b = q[4 * f + (v + 1) % 4], lo = Math.min(a, b), hi = Math.max(a, b);
    const key = (part[f] * nn + lo) * nn + hi;
    if (seen.has(key)) continue;
    seen.add(key); list.push(lo, hi); parts.push(part[f]);
  }
  view.edges = { nodes: Int32Array.from(list), part: Int8Array.from(parts) };
  return view.edges;
}
/** Element edges as line segments on the deformed shape (created on first use). */
function updateMesh3D(u, ex, zmid) {
  const v = app.view3dOpts;
  if (!v.mesh) { if (three.lines) three.lines.visible = false; return; }
  const view = three.res.view3d, E = meshEdges3D(view), coords = view.coords;
  if (!three.lines) {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(E.part.length * 6);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    three.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: isDark() ? 0xdde2ea : 0x15181d, transparent: true, opacity: isDark() ? 0.45 : 0.4 }));
    three.scene.add(three.lines);
  }
  const g = three.lines.geometry, pos = g.attributes.position.array;
  for (let s = 0; s < E.part.length; s++) {
    const o = 6 * s;
    if (v.hidden.has(E.part[s])) { pos.fill(0, o, o + 6); continue; }  // zero-length segment: not drawn
    for (let t = 0; t < 2; t++) {
      const n = E.nodes[2 * s + t], p = o + 3 * t;
      pos[p] = coords[3 * n] + ex * u[3 * n]; pos[p + 1] = coords[3 * n + 1] + ex * u[3 * n + 1]; pos[p + 2] = (coords[3 * n + 2] - zmid) + ex * u[3 * n + 2];
    }
  }
  g.attributes.position.needsUpdate = true; g.computeBoundingSphere();
  three.lines.visible = true;
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
  // by PART index: substrate, solder, underfill, fillet, die, TIM, lid, lid adhesive, stiffener, stiffener adhesive, then the stacked-module
  // parts: chiplets, Si base, TSV Cu, RDL, DDI microbumps, DDI fill, wafer underfill fillet, wafer mold
  // the floorplan colours (PART_COLORS, light set); the DDI fill takes the mold colour when the mold fills the gap
  const ddiFill = app.cfg.stack && app.cfg.stack.fill === 'mold' ? 'mold' : 'uf';
  const partCol = ['substrate', 'solder', 'uf', 'uf', 'si', 'tim', 'metal', 'adh', 'metal', 'adh', 'si', 'si', 'cu', 'rdl', 'solder', ddiFill, 'uf', 'mold']
    .map(k => { const x = partColor(k, false); return [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16) / 255); });
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
  updateMesh3D(u, ex, zmid);
  three.renderer.render(three.scene, three.camera);
  const lg = $('#legend3d');
  if (lg) { lg.innerHTML = ''; if (scale) lg.append(...legendItems(scale, v.color === 'warpage' ? 'u_z, µm (deformation exaggerated ' + ex + '×)' : 'max principal stress, MPa, nodal averaged per part')); }
}

// ---- sensitivity (tornado) ----
function renderSensitivityView(root) {
  const cfg = app.cfg;
  const inputs = C.sensitivityInputs(cfg);
  if (!app.sensInputs) app.sensInputs = new Set(inputs.map(i => i.id));
  root.append(h('div', { class: 'row' }, h('b', null, 'Sensitivity (tornado), Draft preset'), h('span', { class: 'muted small' }, 'Each input is set to the low and high end of its range (datasheet range where given, else ±10 %, ±10 °C for temperatures). Results are cached by configuration hash.')));
  root.append(h('div', { class: 'row small' }, ...inputs.map(i => h('label', { class: 'pill', 'data-tip': TIPS.sensInput + (i.estimated ? ' This one is Estimated.' : '') }, h('input', { type: 'checkbox', checked: app.sensInputs.has(i.id) ? '' : null, onchange: e => { if (e.target.checked) app.sensInputs.add(i.id); else app.sensInputs.delete(i.id); } }), ' ' + i.label, i.estimated ? h('span', { class: 'badge Estimated' }, 'est.') : null))));
  const nw = Math.max(1, app.workers || 1);
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
  if (app.job) cancelRunning();
  progressBegin('Sensitivity', { kind: 'sensitivity', preset: 'Draft, ' + nWorkers + ' parallel case' + (nWorkers > 1 ? 's' : '') });
  setStatus('Sensitivity: 0/' + cases.length, 0);
  progressMsg(0, 'Sensitivity: 0/' + cases.length);
  let stopped = false;  // cases rejected by a cancel are dropped, not reported as failures
  let nFailed = 0, firstErr = null, snap = null;
  const job = { label: 'sensitivity', cancel: () => { stopped = true; for (const p of pool) p.stop(); } };
  app.job = job;
  const cancelAll = () => { job.cancel(); if (app.job === job) { app.job = null; snap = progressSnapshot(); progressEnd(); } };
  return new Promise((resolve) => {
    const launch = w => {
      if (next >= cases.length) return;
      const c = cases[next++];
      w.send({ type: 'sensitivityCase', cfg: c.cfg }).then(r => { if (stopped) return; results[c.id + (c.side ? ':' + c.side : '')] = { r, c }; done++; progressMsg(done / cases.length, 'Sensitivity: ' + done + '/' + cases.length); setStatus('Sensitivity: ' + done + '/' + cases.length, done / cases.length); if (done === cases.length) finish(); else launch(w); }).catch(e => { if (stopped) return; nFailed++; if (!firstErr) firstErr = e; progressLog('Sensitivity case ' + c.id + (c.side ? ' (' + c.side + ')' : '') + ' failed: ' + e.message); done++; if (done === cases.length) finish(); else launch(w); });
    };
    const finish = () => {
      cancelAll();
      const base = results.__base && results.__base.r;
      if (!base) { setStatus('Sensitivity failed', null); sensitivityDialog(cases.length, nFailed, performance.now() - t0, false, snap, firstErr); resolve(); return; }
      const byInput = {};
      for (const inp of inputs) { const lo = results[inp.id + ':lo'], hi = results[inp.id + ':hi']; if (lo && hi) byInput[inp.id] = { lo: lo.r, hi: hi.r, loValue: lo.c.value, hiValue: hi.c.value, baseValue: lo.c.base }; }
      app.sensitivity = Object.assign(C.tornadoFromCases(inputs, base, byInput), { hash: C.configHashes(cfg).model, ms: performance.now() - t0 });
      setStatus('Sensitivity done in ' + fmt((performance.now() - t0) / 1000, 0) + ' s', null);
      renderCenter(); sensitivityDialog(cases.length, nFailed, performance.now() - t0, true, snap, firstErr); resolve();
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
    tbl.append(h('tr', null, h('td', { 'data-tip': t.about }, t.id), h('td', { 'data-tip': t.about }, t.name + (t.slow ? ' (slow)' : '')), h('td', { class: r ? (r.pass ? 'ok' : 'bad') : 'muted' }, r ? (r.pass ? 'PASS' : 'FAIL') : (app.verifying && app.verifying.has(t.id) ? 'running…' : '–')), h('td', { class: 'small' }, r ? r.measured : ''), h('td', { class: 'small muted' }, r && r.criterion ? r.criterion : t.criterion), h('td', null, r ? fmt(r.ms / 1000, 1) : '')));
  }
  root.append(tbl);
}
function runVerify(all) {
  const ids = C.VERIFICATION_TESTS.filter(t => all || !t.slow).map(t => t.id);
  app.verification = app.verification || [];
  app.verifying = new Set(ids);
  // partial results stream in; the suite runs on its own worker so that cancelling it keeps the analysis
  const onPartial = r => { app.verification = app.verification.filter(x => x.id !== r.id); app.verification.push(r); if (app.verifying) app.verifying.delete(r.id); renderCenter(); };
  startRun({ type: 'verify', ids, presets: ['draft', 'standard'] }, 'Verification', { side: true, onPartial }).then(results => { for (const r of results) { app.verification = app.verification.filter(x => x.id !== r.id); app.verification.push(r); } app.verifying = null; renderCenter(); }).catch(e => { app.verifying = null; renderCenter(); if (e.message !== 'cancelled' && !e.reported) toast(e.message, 'error'); });
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
  siList(f).forEach(d => { add(d.name + ' backside interior peak stress', fmt(d.top.peakInterior, 1) + ' MPa', CONFIDENCE.dieInterior); add(d.name + ' backside corner patches 1 / 2 / 3 / 4', d.top.corners.map(c => fmt(c.value, 0)).join(' / ') + ' MPa', CONFIDENCE.corner); add(d.name + ' active-face interior peak', fmt(d.bottom.peakInterior, 1) + ' MPa', CONFIDENCE.dieInterior); });
  f.dies.forEach((d, i) => { add(d.name + ' worst CPI bump shear / axial', gf(res.cpi[i].worstV) + ' / ' + gf(res.cpi[i].worstN) + ' gf', CONFIDENCE.bumps); add(d.name + ' underfill max sidewall peel / shear', fmt(d.uf.maxPeelSide, 1) + ' / ' + fmt(d.uf.maxShearSide, 1) + ' MPa', CONFIDENCE.corner); });
  if (res.screening) res.screening.forEach(s => add(s.die + ' worst ΔW_proxy', fmtE(s.top[0] ? s.top[0].dW : NaN, 3) + ' MPa/cycle', CONFIDENCE.fatigue));
  if (f.ddi) f.ddi.forEach((c, i) => { const j = res.ddiJoin && res.ddiJoin[i]; if (j) add(c.name + ' worst DDI microbump shear / axial, chiplet join', gf(j.worstV) + ' / ' + gf(j.worstN) + ' gf', CONFIDENCE.bumps); add(c.name + ' worst DDI microbump shear / axial, 25 °C', gf(c.bumps.worstV) + ' / ' + gf(c.bumps.worstN) + ' gf', CONFIDENCE.bumps); add(c.name + ' ' + (c.wcuf.fill === 'mold' ? 'wafer mold' : 'wafer underfill') + ' max sidewall peel / shear', fmt(c.wcuf.maxPeelSide, 1) + ' / ' + fmt(c.wcuf.maxShearSide, 1) + ' MPa', CONFIDENCE.corner); });
  if (res.ddiScreening) res.ddiScreening.forEach(s => add(s.die + ' worst DDI microbump ΔW_proxy', fmtE(s.top[0] ? s.top[0].dW : NaN, 3) + ' MPa/cycle', CONFIDENCE.fatigue));
  for (const sm of app.submodels) add('Submodel ' + sm.die + ' (' + fmt(sm.site.x, 1) + ', ' + fmt(sm.site.y, 1) + ') ΔW / Syed life', fmtE(sm.dW, 3) + ' MPa, ' + fmt(sm.life.syedEnergy, 0) + ' cycles', CONFIDENCE.fatigue);
  div.append(tbl);
  if (app.sensitivity && app.sensitivity.warpRT) div.append(h('p', { class: 'small' }, 'Sensitivity (RT warpage), top drivers: ' + app.sensitivity.warpRT.rows.slice(0, 5).map(r => r.label).join(', ') + '.'));
  const estList = estimatedInputsInUse(cfg);
  div.append(h('h3', null, 'Estimated inputs in use (' + estList.length + ')'), h('p', { class: 'small' }, estList.map(e => e.material + ': ' + e.label + ' = ' + (typeof e.value === 'number' ? fmtInput(e.value) : e.value) + ' ' + e.unit).join('; ') || 'none'));
  div.append(h('h3', null, 'Assumptions and limitations'), h('ul', { class: 'small' }, ...limitationsList(res).map(t => h('li', null, t))));
  div.append(glossaryReportSection());
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
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>FCBGA screening report</title><style>' + document.querySelector('style').textContent + ' body{overflow:auto;padding:24px;background:#fff;color:#111} .kv{margin:6px 0}</style></head><body><div style="max-width:900px;margin:auto">' + body.outerHTML + '<p class="small muted">' + (DESKTOP ? 'Print this report or save it as PDF with File &gt; Print or File &gt; Save as PDF.' : 'Print this page to PDF with the browser print dialog.') + '</p></div></body></html>');
  win.document.close();
}
function exportCSV() {
  const res = app.results; if (!res) return;
  const cfg = app.cfg, f = res.at25;
  const lines = ['section,quantity,value,unit'];
  lines.push('warpage,signed_25C,' + f.warpage.signed * 1000 + ',um', 'warpage,magnitude_25C,' + f.warpage.mag * 1000 + ',um');
  for (const r of res.sweep) lines.push('warpage_sweep,T=' + r.T + ',' + r.signed * 1000 + ',um');
  siList(f).forEach(d => { lines.push('die_stress,' + d.name + '_top_interior_peak,' + d.top.peakInterior + ',MPa', 'die_stress,' + d.name + '_bottom_interior_peak,' + d.bottom.peakInterior + ',MPa'); d.top.corners.forEach(c => lines.push('die_stress,' + d.name + '_top_' + c.name.replace(/[^\w+-]+/g, '_').replace(/_$/, '') + ',' + c.value + ',MPa')); });
  f.dies.forEach((d, i) => { lines.push('bumps,' + d.name + '_cpi_worst_shear,' + res.cpi[i].worstV + ',N', 'bumps,' + d.name + '_cpi_worst_axial,' + res.cpi[i].worstN + ',N', 'uf,' + d.name + '_max_sidewall_peel,' + d.uf.maxPeelSide + ',MPa', 'uf,' + d.name + '_max_sidewall_shear,' + d.uf.maxShearSide + ',MPa'); });
  if (res.screening) res.screening.forEach(s => lines.push('fatigue,' + s.die + '_worst_dW_proxy,' + (s.top[0] ? s.top[0].dW : '') + ',MPa'));
  if (f.ddi) f.ddi.forEach((c, i) => { const j = res.ddiJoin && res.ddiJoin[i]; if (j) lines.push('ddi,' + c.name + '_join_worst_shear,' + j.worstV + ',N', 'ddi,' + c.name + '_join_worst_axial,' + j.worstN + ',N'); lines.push('ddi,' + c.name + '_25C_worst_shear,' + c.bumps.worstV + ',N', 'ddi,' + c.name + '_25C_worst_axial,' + c.bumps.worstN + ',N', 'wcuf,' + c.name + '_max_sidewall_peel,' + c.wcuf.maxPeelSide + ',MPa', 'wcuf,' + c.name + '_max_sidewall_shear,' + c.wcuf.maxShearSide + ',MPa'); });
  if (res.ddiScreening) res.ddiScreening.forEach(s => lines.push('fatigue,' + s.die + '_ddi_worst_dW_proxy,' + (s.top[0] ? s.top[0].dW : '') + ',MPa'));
  for (const sm of app.submodels) lines.push('submodel,' + sm.die + '_' + sm.site.x + '_' + sm.site.y + '_dW,' + sm.dW + ',MPa', 'submodel,' + sm.die + '_' + sm.site.x + '_' + sm.site.y + '_life_syed,' + sm.life.syedEnergy + ',cycles');
  lines.push('', 'ball_x_mm,ball_y_mm,warpage_residual_25C_um,w_25C_um');
  for (let q = 0; q < f.warpage.ballX.length; q++) lines.push(f.warpage.ballX[q] + ',' + f.warpage.ballY[q] + ',' + f.warpage.ballRes[q] * 1000 + ',' + f.warpage.ballW[q] * 1000);
  if (f.ddi) f.ddi.forEach((c, i) => { const j = res.ddiJoin && res.ddiJoin[i], a = c.bumps; lines.push('', 'chiplet,microbump_x_mm,microbump_y_mm,N_join_N,V_join_N,N_asm25_N,V_asm25_N'); for (let q = 0; q < a.x.length; q++) lines.push(c.name + ',' + a.x[q] + ',' + a.y[q] + ',' + (j ? j.N[q] : '') + ',' + (j ? j.V[q] : '') + ',' + a.N[q] + ',' + a.V[q]); });
  res.cpi.forEach((b, i) => { lines.push('', 'die,bump_x_mm,bump_y_mm,N_cpi_N,V_cpi_N,N_asm25_N,V_asm25_N'); const a = f.dies[i].bumps; for (let q = 0; q < b.x.length; q++) lines.push(b.die + ',' + b.x[q] + ',' + b.y[q] + ',' + b.N[q] + ',' + b.V[q] + ',' + a.N[q] + ',' + a.V[q]); });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: (cfg.name || 'fcbga').replace(/[^\w.-]+/g, '_') + '_results.csv' });
  document.body.appendChild(a); a.click(); a.remove();
}

function limitationsList(res) {
  const cfg = app.cfg;
  const L = [
    'Incremental (rate-form) thermoelasticity with element birth for all non-solder materials in the global model: stress builds up as dσ = D(T) (dε − α dT) along the temperature path, from each material\'s birth temperature down the process chain to 25 °C and from 25 °C to each evaluation temperature, in steps of at most 30 °C (10 °C within 15 °C of a Tg), each with the mean stiffness over the step and the exact integral of D α dT as the thermal load, which differs from 2 °C steps by at most 0.25 %. A polymer cooled through its glass transition therefore carries its rubbery modulus for the contraction made while rubbery; a total (secant) form, which applies the current modulus to the whole contraction since birth, would overstate its stress several times (verification V16). Elastic only, so no viscoelastic relaxation; each polymer\'s effective stress-free temperature is exposed as a knob (default: cure temperature).',
    'Polymer properties above Tg are partly estimated (rubbery moduli of ABF and solder resist, all Poisson ratios of polymers, TIM gel; for most underfills and adhesives added from data sheets, the rubbery modulus is a fixed fraction of the glassy modulus). Values flagged Estimated should be replaced by measured or DMA data.',
    'Substrate layers are homogenized with mixture rules (Voigt / Reuss / Turner) per physical layer and integrated layer by layer within twelve element bands (the bottom build-up, the core and the top build-up are each split into four); every other region except the TIM has at least four element layers through its thickness (the compliant TIM has one, which changes no result by more than 0.3 %); a Cu pattern is treated as a uniform fraction, not as routed geometry.',
    'In-plane grid: graded from h_min at every die edge and, in lidded and stiffened packages, at the lid foot or stiffener ring edges too, where the adhesive and the top solder resist carry a stress concentration. The ring refinement is added after the DOF cap has set h_min, so it never coarsens the dies; the DOF ends about 1.5 times above the preset cap (more memory than a browser tab allows at Fine; the desktop app is bounded by the computer only).',
    'Bumps are homogenized in the global model as a superposed solder phase and underfill phase sharing nodes (Voigt). The solder phase is an array of separate columns between the two pads: axial stiffness E and transverse shear stiffness G only, no in-plane membrane stiffness or Poisson coupling (a numerical floor of 0.1 %), since separate joints carry no in-plane force and do not take the die\'s in-plane strain. The bump screening drives each joint the same way, as a free-standing column: its axial and transverse shear strains follow the bump layer, its in-plane stresses are zero.',
    'The underfill fillet is a linear wedge: box elements under its sloped surface carry their stiffness and thermal load scaled by the fraction of the box below the surface, so the fillet acts as a continuous wedge without sloped elements; peel and shear at the fillet surface are approximate.',
    'Solder above its solidus (217 °C for SAC305) is represented by a modulus floor of 1 % of E(217 °C); states above the solidus are flagged "solder molten".',
    'Uniform temperature only: no power maps or gradients. No BGA balls or PCB (second-level), no package-level mold compound (the wafer mold of stacked modules is modeled), no passives, no moisture swelling, no Cu plasticity, no fracture mechanics, no initial substrate warpage from fabrication, no gravity.',
    'Singular quantities (die corners, interface corners, fatigue indices) are mesh dependent and reported as comparative metrics over fixed physical patches.',
    'Fatigue constants come from other joint geometries and constitutive models; lives are order-of-magnitude and best used as ratios against a pinned baseline. The submodel assumes the solder is stress-free at 25 °C in the as-assembled state; its elastic parts follow the same incremental rule from that state. Its cross-section shows the change from 25 °C or, as an option, the total stress, which adds the global as-assembled stress at 25 °C of each submodel element (silicon, underfill and substrate from the global model; solder 0 by the assumption above).',
    'Stacked modules (a Si base die or interposer, or an organic RDL interposer, with one layer of chiplets): each module is built first as a free body, before the substrate stage: chiplets, base and DDI microbumps are born at the chiplet join temperature, then the wafer underfill at its cure temperature (wCUF fill), then the wafer mold at its cure temperature; the module then goes to the substrate stress-free temperature and is joined by its flip chip bumps in S1 like a die. The constraint of the wafer before singulation and of a carrier (RDL-first interposers) is ignored. During those stages each module rests on a statically determinate three-point support on its base, which carries no force under its self-equilibrated thermal load, and the rest of the package, not yet born, is held still and takes no part (verification V18). With stacked modules the mesh sizes grow under the DOF cap at most to 4 times the height of the lowest module, so its thin layers stay solvable and resolved; thin modules can then keep even Draft meshes above the cap.',
    'Stacked-module geometry: the wafer mold fills every module area not covered by chiplet silicon, out to the base edge and flush with the chiplet backsides (no overmold); the wafer underfill fillet is a linear wedge around each chiplet on the base top (cells it cuts carry wCUF and mold by their volume fractions), clipped at the base edge; the flip chip underfill fillet height is a fraction of the module height; the lid TIM covers the whole module top. All chiplets share one thickness and one DDI microbump technology.',
    'DDI microbumps are homogenized like the flip chip bumps: a microbump column phase superposed on the DDI fill (wafer underfill or mold), the column a Cu pillar and a solder cap in series (axial and shear stiffness only). TSV copper in a Si base is superposed on the Si by the parallel (Voigt) rule; the BEOL of the base and chiplets is not modeled. An RDL interposer is homogenized per layer like the substrate and integrated layer by layer.',
    'Stacked modules add element layers (at least four through the base, the DDI gap and the chiplets), so Draft cannot always reach its DOF cap: h_min then stops at the preset h_max and the mesh stays above the cap. The solver needs about two to three times the iterations per step of a monolithic package of the same size (more in the first module steps on coarse meshes), so module packages take markedly longer to run.',
    'Results of stacked modules: warpage; die stress on every chiplet and Si base; flip chip bump loads, screening and underfill tractions under each module base; DDI microbump loads (as-assembled, and at the end of chiplet join before the DDI fill, an elastic upper bound like the chip-join state) and screening, each microbump a free-standing column of its solder cap on an elastic Cu pillar in series (at most 5000 microbumps per chiplet, outer rows and corner blocks kept); wafer underfill (or mold) tractions at every chiplet. Bump submodels need a Si base at least 50 µm thick (not under an RDL interposer) and are not available for microbumps.',
    'Silicon elastic constants are temperature independent; Cu and metals are elastic.',
    'Poisson ratios are clamped to 0.45 in the global hexahedral elements (B-bar elements in the submodel accept up to 0.49).',
    'Layered substrate bands use the continuum-shell form of each sub-layer stiffness (plane-stress in-plane block, uncoupled thickness modulus), because one thickness strain shared by all sub-layers of a band over-constrains the Poisson expansion (0.7 % warpage bias against lamination theory).',
    'No automatic analysis after editing: dragging or releasing a die (or any other edit) starts no solve, and the floorplan overlay is hidden while the geometry differs from the last analysis. The analysis runs only from step 6 (Run full global analysis, or Quick preview on the Draft mesh).',
    'Contour colours default to a rainbow scale (purple low to red high). It is not colorblind safe or perceptually uniform: bright yellow and cyan bands can suggest features that are not there. Switch to the colorblind-safe scales with the "colors" dropdown in the Results bar.',
    'Parallel workers: the steps of the thermal path (also those of the quick preview) and the bump submodels can be split over several workers; each holds its own copy of the model, so peak memory grows with the worker count (shown in the run panel). In a browser they share one tab, whose memory the browser limits; the desktop app runs them as separate processes limited only by the computer\'s memory.',
    'Build decisions: the multigrid coarse space uses per-column shell aggregates (rigid-body plus thickness modes of each stiff stack) because plain nodal interpolation stalls on thin layered structures; the full symmetric block matrix is stored (instead of the upper triangle) for faster smoothing; single-material elements use a closed-form 12-point rule that reproduces 2×2×2 Gauss exactly.',
  ];
  if (res && res.notes) L.push(...res.notes);
  return L;
}
