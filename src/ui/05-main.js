// ===== UI: shell, navigation, wiring ===========================================

function renderStepper() {
  const nav = $('#stepper'); nav.innerHTML = '';
  for (const s of STEPS) {
    nav.append(h('div', { class: 'step' + (app.step === s.n ? ' active' : '') + (s.n < app.step ? ' done' : ''), onclick: () => { app.step = s.n; prefs.set('step', s.n); renderAll(); } }, h('span', { class: 'num' }, s.n), h('span', { class: 'lbl' }, s.label)));
  }
  nav.append(h('hr'), h('div', { class: 'small muted', style: 'padding:6px' }, 'Configuration: ', h('b', null, app.cfg.name || '(unnamed)'), app.results ? h('div', null, 'Results: ' + app.results.preset + (app.results.preview ? ' preview' : '') + (app.dirty ? ' (configuration changed since)' : '')) : null, app.baseline ? h('div', null, 'Baseline pinned') : null));
  nav.append(h('div', { style: 'padding:6px' }, h('button', { class: 'small', onclick: showLimitations }, 'Assumptions and limitations')));
}

const CENTER_TABS = [['floorplan', 'Floorplan and section'], ['results', 'Results'], ['view3d', '3D view']];
function setCenterTab(t) { app.centerTab = t; prefs.set('tab', t); renderCenter(); }
function renderCenterTabs() {
  const el = $('#center-tabs'); el.innerHTML = '';
  for (const [k, l] of CENTER_TABS) el.append(h('div', { class: 'tab' + (app.centerTab === k ? ' active' : ''), onclick: () => setCenterTab(k) }, l));
}
function renderCenter() {
  renderCenterTabs();
  const body = $('#center-body'); body.innerHTML = '';
  if (three) { try { three.renderer.dispose(); } catch (e) { /* ignore */ } three = null; }
  if (app.centerTab === 'floorplan') {
    const overlaySel = h('select', { onchange: e => { app.showOverlay = e.target.value; floorplan.draw(); } }, ...[['none', 'no overlay'], ['warpage', 'warpage, substrate bottom'], ['subtop', 'warpage, substrate top'], ['dieTop', 'die backside stress'], ['dieBottom', 'die active-face stress'], ['cpiV', 'bump shear, chip join'], ['cpiN', 'bump axial, chip join'], ['bumpV', 'bump shear, as-assembled'], ['bumpN', 'bump axial, as-assembled'], ['screening', 'fatigue screening ΔW']].map(([v, l]) => h('option', { value: v, selected: app.showOverlay === v ? '' : null }, l)));
    const cut = h('div', { class: 'fp-toolbar' }, h('b', null, 'Floorplan'), h('span', null, 'overlay ', overlaySel), app.results ? h('span', { class: 'small muted' }, '(' + (app.currentFields ? app.currentFields.T : 25) + ' °C, ' + app.results.preset + (app.results.preview ? ' preview' : '') + ')') : null,
      h('span', null, ' cut A-A\' '), h('select', { onchange: e => { app.cutLine.axis = e.target.value; floorplan.draw(); xsection.draw(); } }, h('option', { value: 'x', selected: app.cutLine.axis === 'x' ? '' : null }, 'along x at y ='), h('option', { value: 'y', selected: app.cutLine.axis === 'y' ? '' : null }, 'along y at x =')), h('input', { type: 'number', step: 0.5, value: app.cutLine.pos, style: 'width:70px', onchange: e => { app.cutLine.pos = +e.target.value; floorplan.draw(); xsection.draw(); } }), h('span', null, ' mm; vertical exaggeration '), h('select', { onchange: e => { app.exaggeration = +e.target.value; xsection.draw(); } }, ...[1, 5, 20].map(v => h('option', { value: v, selected: app.exaggeration === v ? '' : null }, v + '×'))), h('button', { class: 'small', onclick: () => { floorplan.zoomFit(); floorplan.draw(); } }, 'Fit'));
    const wrap = h('div', { id: 'floorplan-wrap' }, h('canvas', { id: 'floorplan' }), h('div', { id: 'fp-readout', class: 'readout' }), app.results && app.results.preview ? h('div', { class: 'preview-badge' }, 'Preview (Draft)') : null);
    body.append(cut, wrap, h('div', { id: 'fp-legend', class: 'legend' }), h('canvas', { id: 'xsection' }));
    floorplan.init($('#floorplan')); xsection.init($('#xsection'));
    requestAnimationFrame(() => { floorplan.draw(); xsection.draw(); });
  } else if (app.centerTab === 'results') {
    renderResults(body);
  } else {
    const r = app.results;
    if (!r) body.append(h('div', { class: 'msg info' }, 'Run the full analysis to see the 3D deformed shape.'));
    else renderView3D(body, r, app.currentFields || r.at25, h('select', { onchange: e => selectTemperature(+e.target.value) }, ...r.temps.all.map(T => h('option', { value: T, selected: T === app.selectedT ? '' : null }, T + ' °C'))));
  }
}
function renderContext() {
  const ctx = $('#context'); ctx.innerHTML = '';
  const s = STEPS.find(x => x.n === app.step);
  try { s.render(ctx); } catch (e) { ctx.append(h('div', { class: 'msg error' }, 'Panel error: ' + e.message)); console.error(e); }
}
function renderAll() { renderStepper(); renderCenter(); renderContext(); }

function showLimitations() {
  const box = h('div', null, h('p', null, 'Every modeling assumption of this tool, in plain language:'), h('ul', null, ...limitationsList(app.results).map(t => h('li', null, t))));
  showModal('Assumptions and limitations', box);
}

// ---- preview scheduling ----
let previewTimer = null;
document.addEventListener('configchange', ev => {
  const d = ev.detail || {};
  const o = d.opts || {};
  if (app.centerTab === 'floorplan') { floorplan.draw(); xsection.draw(); }
  if (o.dragging) {
    // debounce 250 ms after the pointer stops; cancel in-flight preview
    if (previewTimer) clearTimeout(previewTimer);
    if (app.running && app.running.startsWith('Drag preview')) worker.cancel();
    previewTimer = setTimeout(() => { previewTimer = null; if (!app.validation.errors.length) runPreview(false); }, 250);
    floorplan.drawReadout();
    return;
  }
  if (o.released) {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    if (app.running && app.running.startsWith('Drag preview')) worker.cancel();
    if (app.autoSolve && !app.validation.errors.length && app.step >= 2) {
      if (app.cfg.mesh.preset === 'draft' || !app.results) runPreview(false); else runFullAfterRelease();
    }
  }
  if (app.step !== 2 || !o.dragging) renderContext();
  renderStepper();
});
function runFullAfterRelease() {
  startRun({ type: 'run', cfg: app.cfg, preset: app.cfg.mesh.preset, evaluations: 'full', workers: app.workers }, 'Auto-solve (' + app.cfg.mesh.preset + ')').then(res => { app.results = res; app.currentFields = res.at25; app.selectedT = 25; app.dirty = false; app.screening = res.screening || null; app.submodels = []; renderAll(); }).catch(err => { if (err.message !== 'cancelled') toast('Auto-solve failed: ' + err.message, 'error'); });
}
document.addEventListener('dieselect', () => { if (app.step === 2) renderContext(); floorplan.draw(); });
document.addEventListener('themechange', () => { if (app.centerTab === 'floorplan') { floorplan.draw(); xsection.draw(); } else renderCenter(); });

function defaultCancel() { worker.cancel(); app.running = null; setStatus('Cancelled', null); toast('Job cancelled; the worker was restarted. Results in memory are kept.', 'warn'); }

// ---- init ----
function init() {
  app.theme = prefs.get('theme', 'auto');
  if (app.theme !== 'auto') document.documentElement.setAttribute('data-theme', app.theme);
  app.cfg = C.defaultConfig(MATERIALS_DB);
  app.step = prefs.get('step', 1);
  app.centerTab = prefs.get('tab', 'floorplan');
  onConfigChanged('geometry', {});
  $('#btn-theme').addEventListener('click', () => { const order = ['auto', 'light', 'dark']; applyTheme(order[(order.indexOf(app.theme) + 1) % 3]); toast('Theme: ' + app.theme, '', 1500); });
  $('#btn-help').addEventListener('click', showLimitations);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('#btn-cancel').onclick = defaultCancel;
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  renderAll();
  setStatus('Ready. Load a preset or edit the package, then run the analysis in step 6.', null);
}
init();
