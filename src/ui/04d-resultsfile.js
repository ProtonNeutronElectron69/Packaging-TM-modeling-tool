// ===== UI: results file (.fcbgares): save every result of the session, open it again later ====
//
// A results file holds the configuration, the results in memory (analysis, temperatures already evaluated,
// cross-sections, screening, bump submodels, baseline, sensitivity, verification), the view settings and,
// while the main worker still has it, the analysis behind the results: the thermal path's step increments,
// from which the worker rebuilds it without solving, so other temperatures, sections and submodels work
// again after opening. The format is in src/core/16-results-file.js.

/** View settings saved with the results, so the file opens where the user left off. */
const RESULTS_VIEW_KEYS = ['selectedT', 'resultsView', 'selectedDie', 'selectedChiplet', 'dirty', 'section', 'sectionQty', 'sectionPhase', 'sectionMesh', 'sectionExag', 'sectionRange',
  'subSection', 'ufMode', 'ufMaps', 'ufMapQty', 'ufMapDepth', 'ufMapShared', 'bumpState', 'bumpComp', 'dieStressFace', 'showOverlay', 'exaggeration', 'cutLine', 'view3dOpts', 'submodelSelection', 'sensInputs'];

function resultsFileName() {
  const r = app.results;
  return ((app.cfg.name || 'fcbga').replace(/[^\w.-]+/g, '_') + '_' + String(r.preset || '').toLowerCase() + (r.preview ? '_preview' : '')).replace(/_+$/, '') + C.CONST.RESULTS_FILE_EXT;
}
const fmtMB = bytes => fmt(bytes / 1048576, bytes < 10 * 1048576 ? 1 : 0) + ' MB';

/** Everything a results file holds, as one value tree (analysis: the worker's state with its step increments, or null). */
function resultsFileTree(analysis) {
  const view = {};
  for (const k of RESULTS_VIEW_KEYS) if (app[k] !== undefined && app[k] !== null) view[k] = app[k];
  return {
    kind: 'fcbga-results', savedAt: new Date().toISOString(),
    config: app.cfg, results: app.results, baseline: app.baseline && app.baseline === app.results ? 'results' : app.baseline,
    screening: app.screening, submodels: app.submodels, sensitivity: app.sensitivity, verification: app.verification,
    fieldsCache: app.fieldsCache, sectionCache: app.sectionCache, tractionCache: app.tractionCache, view, analysis,
  };
}

/**
 * Save the results in memory as one .fcbgares file, with the analysis behind them while the main worker still
 * holds it (its step increments travel in blocks, since the desktop app limits the size of one message).
 */
function saveResultsFile() {
  if (!app.results) { toast('No results to save yet; run the analysis first.', 'warn'); return; }
  if (app.job) { toast('Wait for the running job to finish, or cancel it, before saving the results.', 'warn', 7000); return; }
  const res = app.results, name = resultsFileName();
  const why = app.analysisLost ? 'the analysis behind these results is no longer in memory' : '';
  // cancelling stops the collection only: the worker and its analysis stay
  startRun(async (send, progress) => {
    let analysis = null, note = why;
    if (!app.analysisLost) {
      progress(0, 'Collecting the analysis');
      const head = await send({ type: 'exportState' });
      if (!head.hashes || !res.hashes || head.hashes.all !== res.hashes.all) note = 'the worker holds a different analysis than these results';
      else {
        const du = [];
        for (let k = 0; k < head.nSteps; k += head.chunk) {
          progress(0.8 * k / head.nSteps, 'Collecting the thermal path (' + k + ' of ' + head.nSteps + ' steps)');
          du.push(...(await send({ type: 'exportState', k0: k, k1: Math.min(head.nSteps, k + head.chunk) })).du);
        }
        analysis = Object.assign(head.state, { du });
      }
    }
    progress(0.85, 'Writing ' + name);
    const enc = C.encodeResultsFile(resultsFileTree(analysis));
    const a = h('a', { href: URL.createObjectURL(new Blob(enc.parts, { type: 'application/octet-stream' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 120000);
    return { size: enc.size, analysis: !!analysis, note };
  }, 'Saving the results', { cancel: () => {} }).then(r => {
    if (r.analysis) toast('Results file ' + name + ' (' + fmtMB(r.size) + ') written, with the analysis behind the results: opening it brings back every view, other temperatures, sections and submodels without solving again.', 'ok', 9000);
    else toast('Results file ' + name + ' (' + fmtMB(r.size) + ') written without the analysis (' + r.note + '): opening it shows these results, and Restore analysis re-runs the analysis for other temperatures and submodels.', 'warn', 11000);
  }).catch(err => { if (err.message !== 'cancelled') toast('Saving the results failed: ' + err.message, 'error', 9000); });
}

/** Ask for a results file and open it. */
function pickResultsFile() {
  const inp = h('input', { type: 'file', accept: C.CONST.RESULTS_FILE_EXT });
  inp.addEventListener('change', () => { const f = inp.files[0]; if (f) openResultsFile(f); });
  inp.click();
}

/** Open a results file (a File or Blob, or an ArrayBuffer with its name): its results in the views at once, then its analysis back in the worker. */
async function openResultsFile(file, name) {
  name = name || file.name || 'the results file';
  if (app.job && !window.confirm('A job is running (' + app.job.label + '). Stop it and open ' + name + '?')) return;
  let t;
  try {
    setStatus('Reading ' + name, 0);
    t = C.decodeResultsFile(file instanceof ArrayBuffer ? file : await file.arrayBuffer());
    if (!t || t.kind !== 'fcbga-results' || !t.results || !t.config) throw new Error('it holds no results');
  } catch (e) {
    setStatus('Ready', null);
    toast('Could not open ' + name + ': ' + e.message, 'error', 9000);
    return;
  }
  setStatus('Ready', null);
  if (app.job) cancelRunning();
  applyResultsFile(t);
  const st = t.analysis;
  t.analysis = null;
  if (!st || !st.du) {
    app.analysisLost = 'file'; app.analysisLostWhy = null;
    renderAll();
    toast('Opened ' + name + '. It was saved without the analysis behind its results; Restore analysis re-runs it for other temperatures and submodels.', 'warn', 9000);
    return;
  }
  app.analysisLost = 'loading';
  renderAll();
  const du = st.du;
  delete st.du;
  startRun(async (send, progress) => {
    const chunk = C.resultsChunkSteps(st.nDof);
    for (let k = 0; k < du.length; k += chunk) {
      progress(0.3 * k / du.length, 'Sending the thermal path (' + k + ' of ' + du.length + ' steps)');
      await send({ type: 'restoreSteps', k0: k, du: du.slice(k, k + chunk) });
      du.fill(null, k, k + chunk);  // the worker has its copy
    }
    return send({ type: 'restore', state: st });
  }, 'Opening ' + name).then(() => {
    app.analysisLost = false; app.analysisLostWhy = null;
    renderAll();
    toast('Opened ' + name + ' (saved ' + new Date(t.savedAt).toLocaleString() + '): the results and the analysis behind them are back.', 'ok', 7000);
  }).catch(err => {
    if (err.message === 'cancelled') return;
    app.analysisLost = 'file'; app.analysisLostWhy = err.message;
    renderAll();
    toast('Opened the results of ' + name + ', but not the analysis behind them: ' + err.message + '. Restore analysis re-runs it.', 'warn', 11000);
  });
}

/** Put the contents of a results file in place of the current configuration and results. */
function applyResultsFile(t) {
  // a file from before stacked modules gets the empty module list; materials are added only when a module is added
  app.cfg = C.normalizeConfig(t.config); app.selectedDie = 0; app.selectedChiplet = -1;
  onConfigChanged('geometry', { released: true });
  app.results = t.results;
  app.baseline = t.baseline === 'results' ? t.results : (t.baseline || null);
  app.screening = t.screening || t.results.screening || null;
  app.submodels = t.submodels || [];
  app.sensitivity = t.sensitivity || null;
  app.verification = t.verification || null; app.verifying = null;
  app.fieldsCache = t.fieldsCache instanceof Map ? t.fieldsCache : new Map();
  app.sectionCache = t.sectionCache instanceof Map ? t.sectionCache : new Map();
  app.tractionCache = t.tractionCache instanceof Map ? t.tractionCache : new Map(); app.tractionPending.clear();
  app.sectionPending = null; app.sectionDraft = null; app.submodelSelection = null; app.sensInputs = null;
  const v = t.view || {};
  for (const k of RESULTS_VIEW_KEYS) if (v[k] !== undefined) app[k] = v[k];
  const T = app.selectedT;
  app.currentFields = T === 25 ? app.results.at25 : (app.fieldsCache.get(T) || null);
  if (!app.currentFields) { app.selectedT = 25; app.currentFields = app.results.at25; }
  app.step = 6;
  floorplan.zoomFit();
  setCenterTab('results');
}

/** Results files dropped on the window open like File > Open results (and do not replace the page). */
function bindResultsFileDrop() {
  const isFile = ev => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragover', ev => { if (isFile(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('drop', ev => {
    if (!isFile(ev)) return;
    ev.preventDefault();
    const f = ev.dataTransfer.files[0];
    if (!f) return;
    if (f.name.toLowerCase().endsWith(C.CONST.RESULTS_FILE_EXT)) openResultsFile(f);
    else toast('Only results files (' + C.CONST.RESULTS_FILE_EXT + ') open by dropping; load a configuration with Load configuration in step 1.', 'warn', 7000);
  });
}

/** Desktop app: File menu commands, and a results file the program was started with (Open with, or dropped on the program file). */
async function bindDesktopResultsFile() {
  if (!DESKTOP || !DESKTOP.onMenu) return;
  DESKTOP.onMenu(cmd => { if (cmd === 'open-results') pickResultsFile(); else if (cmd === 'save-results') saveResultsFile(); });
  const f = await DESKTOP.openedFile();
  if (!f) return;
  // read in blocks: one message between the program and the page is limited in size
  const buf = new Uint8Array(f.size), step = C.CONST.RESULTS_FILE_CHUNK_BYTES;
  setStatus('Reading ' + f.name, 0);
  for (let p = 0; p < f.size; p += step) buf.set(await DESKTOP.readOpenedFile(p, Math.min(step, f.size - p)), p);
  DESKTOP.closeOpenedFile();
  openResultsFile(buf.buffer, f.name);
}
