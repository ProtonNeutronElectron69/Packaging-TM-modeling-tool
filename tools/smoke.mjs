// Browser smoke test with Playwright (headless Chromium): loads the built HTML,
// checks for console errors, runs a Draft preview and a full Draft analysis via
// the worker (saved to a results file and reopened after a page reload), and
// reports timings as seen in the browser.
//   node tools/smoke.mjs [--full] [--standard] [--workers N] [--submodels]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// playwright may be installed globally (cloud environment) or locally
const req = createRequire(import.meta.url);
let chromium;
try { chromium = req('playwright').chromium; } catch (e) { chromium = createRequire('/opt/node-tools/node_modules/')('playwright').chromium; }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = 'file://' + path.join(root, 'dist', 'fcbga_thermomech_tool.html');
const args = process.argv.slice(2);
const workers = args.includes('--workers') ? +args[args.indexOf('--workers') + 1] : 1;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
// the sandbox cannot reach the CDNs: serve a minimal three.js API stub so the 3D-view code path runs
import fs from 'node:fs';
const stub = fs.readFileSync(path.join(root, 'tools', 'three-stub.js'), 'utf8');
await page.route(/three(\.min)?\.js/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: stub }));
await page.goto(file);
await page.waitForSelector('#floorplan', { timeout: 20000 });
console.log('page loaded; steps:', await page.locator('.step').count(), 'errors so far:', errors.length);
// Draft preview (the step 6 Quick preview path)
const t0 = Date.now();
const preview = await page.evaluate(workers => new Promise((resolve, reject) => {
  const t = performance.now();
  worker.send({ type: 'run', cfg: app.cfg, preset: 'draft', evaluations: 'preview', workers }).then(r => resolve({ ms: performance.now() - t, dof: r.meshInfo.nDof, w: r.at25.warpage.signed * 1000, iters: r.solverLog.map(x => x.iters) })).catch(e => reject(e.message));
}), workers);
console.log('Draft preview:', JSON.stringify(preview));
if (args.includes('--full')) {
  // through startRun, as the Run button does, sampling the progress record (status dot, live worker rows) once a second
  const full = await page.evaluate(([preset, workers]) => new Promise((resolve, reject) => {
    const t = performance.now(), live = { maxRows: 0, reports: 0, colours: {}, steps: '' };
    const sample = setInterval(() => { const j = runProgress.job; if (!j) return; live.maxRows = Math.max(live.maxRows, j.rows.size); live.reports = j.reports; live.colours[j.colour] = (live.colours[j.colour] || 0) + 1; live.steps = j.steps.map(s => s.state[0]).join(''); if (j.colour !== 'green') live.reason = j.reason; }, 1000);
    startRun({ type: 'run', cfg: app.cfg, preset, evaluations: 'full', workers }, 'Full global analysis').then(r => { clearInterval(sample); app.results = r; app.currentFields = r.at25; app.screening = r.screening; resolve({ ms: performance.now() - t, dof: r.meshInfo.nDof, workers: r.workers, nested: r.nested, w25: r.at25.warpage.signed * 1000, solves: r.solverLog.length, iters: r.solverLog.map(x => x.iters), screeningMs: r.screening ? r.screening[0].ms : null, timings: r.timings, live, dotHidden: document.getElementById('status-dot').hidden }); }).catch(e => { clearInterval(sample); reject(e.message); });
  }), [args.includes('--standard') ? 'standard' : 'draft', workers]);
  console.log('full analysis:', JSON.stringify(full));
  const lv = full.live;
  console.log('progress: ' + lv.reports + ' live reports from up to ' + lv.maxRows + ' workers, dot ' + JSON.stringify(lv.colours) + (lv.reason ? ' (last warning: ' + lv.reason + ')' : '') + ', steps ' + lv.steps);
  if (!(lv.reports > 0) || (full.nested && full.workers > 1 && lv.maxRows < 2) || !full.dotHidden) errors.push('error: progress record: ' + JSON.stringify(lv) + ', dot hidden after the run: ' + full.dotHidden);
  if (args.includes('--submodels')) {
    const sub = await page.evaluate((workers) => new Promise((resolve, reject) => {
      const t = performance.now();
      const res = app.results; const sel = defaultSubmodelSelection(res); const keys = Array.from(sel);
      const jobs = keys.map(k => { const [die, q] = k.split(':').map(Number); const s = res.screening[die]; return { die, site: { x: s.x[q], y: s.y[q], ix: s.ix[q], iy: s.iy[q] } }; });
      worker.send({ type: 'submodels', jobs, nxy: app.cfg.submodel.nxy, nz: app.cfg.submodel.nz, workers }).then(r => { app.submodels = r; resolve({ ms: performance.now() - t, n: r.length, dW: r.map(x => x.dW), life: r.map(x => x.life.syedEnergy), steps: r.map(x => x.steps), perBumpMs: r.map(x => x.ms), snapshots: r.map(x => x.section ? x.section.snaps.length : 0) }); }).catch(e => reject(e.message));
    }), workers);
    console.log('submodels:', JSON.stringify(sub));
    // submodel cross-section: every moment, both cut directions, all three material focus choices, change and total stress
    await page.evaluate(() => { app.resultsView = 'subSection'; setCenterTab('results'); });
    await page.waitForTimeout(300);
    const ss = await page.evaluate(async () => {
      const st = app.subSection, out = [];
      for (const total of [false, true]) for (const axis of ['x', 'y']) for (const focus of ['uf', 'solder', 'all']) {
        st.total = total; st.axis = axis; st.focus = focus; st.pos = null; st.mesh = focus === 'all';
        for (let k = 0; k < app.submodels[0].section.snaps.length; k++) { st.snap = k; renderCenter(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }
        out.push(axis + '/' + focus + (total ? '/total' : ''));
      }
      const sm = app.submodels[0], sec = C.submodelSection(sm, st.snap, st.axis, st.pos), tot = C.submodelSection(sm, st.snap, st.axis, st.pos, true);
      let dmax = 0;
      for (let q = 0; q < sec.sig.length; q++) dmax = Math.max(dmax, Math.abs(tot.sig[q] - sec.sig[q]));
      return { combos: out.length, plots: document.querySelectorAll('#center-body canvas.map').length, quads: sec.n, finite: sec.sig.every(Number.isFinite), residual: !!sm.section.residual, totalFinite: tot.sig.every(Number.isFinite), totalIsTotal: tot.total, residualMaxMPa: +dmax.toFixed(2), stats: document.querySelectorAll('#center-body table tr').length - 1 };
    });
    console.log('submodel section:', JSON.stringify(ss));
    if (!ss.residual || !ss.totalFinite || !ss.totalIsTotal || !(ss.residualMaxMPa > 0)) errors.push('error: submodel total stress: ' + JSON.stringify(ss));
  }
  // results file: view one temperature (cached), save, reload the page, reopen the file; then a temperature never
  // evaluated before saving must come out of the reloaded analysis as it did from the original one
  const rf = await page.evaluate(async () => {
    const ts = app.results.temps.all, T1 = ts[ts.length - 1], T2 = ts.find(T => T < 25) ?? ts[0];
    selectTemperature(T1);
    const t0 = performance.now();
    while (!app.fieldsCache.has(T1) && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 100));
    const ref = await worker.send({ type: 'fieldsAt', T: T2 });
    return { T1, T2, w25: app.results.at25.warpage.signed, w2: ref.warpage.signed, s2: ref.dies[0].top.peakInterior, hash: C.configHashes(app.cfg).all, nSub: app.submodels.length, nCache: app.fieldsCache.size };
  });
  const dlP = page.waitForEvent('download', { timeout: 120000 });
  await page.evaluate(() => saveResultsFile());
  const dl = await dlP, rfPath = path.join(root, 'dist', dl.suggestedFilename());
  await dl.saveAs(rfPath);
  const rfSize = fs.statSync(rfPath).size;
  await page.reload();
  await page.waitForSelector('#floorplan', { timeout: 20000 });
  const fcP = page.waitForEvent('filechooser');
  await page.evaluate(() => pickResultsFile());
  await (await fcP).setFiles(rfPath);
  await page.waitForFunction(() => app.results && app.analysisLost === false && !app.job, null, { timeout: 300000 });
  const rb = await page.evaluate(async ([T1, T2]) => {
    const cached = app.fieldsCache.has(T1);
    selectTemperature(T2);
    const t0 = performance.now();
    while (!app.fieldsCache.has(T2) && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 100));
    const f = app.fieldsCache.get(T2);
    return { cached, w25: app.results.at25.warpage.signed, w2: f ? f.warpage.signed : null, s2: f ? f.dies[0].top.peakInterior : null, hash: C.configHashes(app.cfg).all, nSub: app.submodels.length, step: app.step, tab: app.centerTab };
  }, [rf.T1, rf.T2]);
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), 1e-30);
  console.log('results file:', JSON.stringify({ file: path.basename(rfPath), MB: +(rfSize / 1048576).toFixed(1), before: rf, after: rb, warpageRel: rel(rf.w2, rb.w2), stressRel: rel(rf.s2, rb.s2) }));
  if (!rb.cached || rb.w25 !== rf.w25 || rb.hash !== rf.hash || rb.nSub !== rf.nSub || !(rel(rf.w2, rb.w2) < 1e-5) || !(rel(rf.s2, rb.s2) < 1e-5)) errors.push('error: results file round trip: ' + JSON.stringify({ rf, rb }));
  fs.unlinkSync(rfPath);
  // render results views
  await page.evaluate(() => { app.section = { axis: 'x', c: 0, a0: -20, a1: 20 }; app.sectionMesh = true; });
  for (const view of ['warpage', 'dieStress', 'bumps', 'uf', 'section', 'fatigue', 'subSection', 'view3d', 'report']) {
    await page.evaluate(v => { app.resultsView = v; setCenterTab('results'); }, view);
    await page.waitForTimeout(400);
  }
  // cross-section stress: the worker answers the line set above, the view draws the contour
  await page.evaluate(() => { app.resultsView = 'section'; setCenterTab('results'); });
  await page.waitForFunction(() => app.sectionCache.size > 0, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  console.log('cross-section:', JSON.stringify(await page.evaluate(() => { const d = app.sectionCache.values().next().value; return { quads: d.n, error: d.error || null, plots: document.querySelectorAll('#center-body canvas.map').length }; })));
  const v3 = await page.evaluate(() => ({ threeLoaded: typeof THREE !== 'undefined', stub: !!(window.THREE && window.THREE.__stub), renders: window.__stubRenders || 0, faces: app.results.view3d ? app.results.view3d.part.length : 0, hasView: !!document.getElementById('view3d') }));
  console.log('3D view:', JSON.stringify(v3));
  // exercise the 3D controls while the view is active: colour modes, exaggeration, part toggles
  await page.evaluate(() => { app.resultsView = 'view3d'; setCenterTab('results'); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { app.view3dOpts.color = 'stress'; update3D(); app.view3dOpts.color = 'part'; update3D(); app.view3dOpts.scale = 50; app.view3dOpts.hidden.add(4); update3D(); });
  await page.evaluate(() => { app.view3dOpts.mesh = true; update3D(); app.view3dOpts.hidden.delete(4); update3D(); });
  const v3b = await page.evaluate(() => { const p = three.lines ? three.lines.geometry.attributes.position.array : null; return { renders: window.__stubRenders || 0, hasView: !!document.getElementById('view3d'), active: !!three, meshEdges: p ? p.length / 6 : 0, meshFinite: p ? p.every(Number.isFinite) : null, meshVisible: three.lines ? three.lines.visible : null }; });
  console.log('3D view after control changes:', JSON.stringify(v3b));
  await page.evaluate(() => setCenterTab('floorplan'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, 'dist', 'screenshot_floorplan.png') });
  await page.evaluate(() => { app.resultsView = 'warpage'; setCenterTab('results'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, 'dist', 'screenshot_results.png'), fullPage: true });
}
// walk the steps
for (let s = 1; s <= 6; s++) { await page.evaluate(n => { app.step = n; renderAll(); }, s); await page.waitForTimeout(150); }
await page.evaluate(() => { app.resultsView = 'sensitivity'; setCenterTab('results'); });
await page.waitForTimeout(200);
await page.evaluate(() => { app.resultsView = 'verification'; setCenterTab('results'); });
await page.waitForTimeout(200);
console.log('console errors/warnings:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ', e);
await browser.close();
