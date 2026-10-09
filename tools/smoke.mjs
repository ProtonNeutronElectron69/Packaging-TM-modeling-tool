// Browser smoke test with Playwright (headless Chromium): loads the built HTML,
// checks for console errors, runs a Draft preview and a full Draft analysis via
// the worker, and reports timings as seen in the browser.
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
// quick preview through the UI path
const t0 = Date.now();
const preview = await page.evaluate(() => new Promise((resolve, reject) => {
  const t = performance.now();
  worker.send({ type: 'run', cfg: app.cfg, preset: 'draft', evaluations: 'preview', quick: true }).then(r => resolve({ ms: performance.now() - t, dof: r.meshInfo.nDof, w: r.at25.warpage.signed * 1000, iters: r.solverLog.map(x => x.iters) })).catch(e => reject(e.message));
}));
console.log('drag preview (Draft, quick):', JSON.stringify(preview));
if (args.includes('--full')) {
  const full = await page.evaluate(([preset, workers]) => new Promise((resolve, reject) => {
    const t = performance.now();
    worker.send({ type: 'run', cfg: app.cfg, preset, evaluations: 'full', workers }, (f, m) => {}).then(r => { app.results = r; app.currentFields = r.at25; app.screening = r.screening; resolve({ ms: performance.now() - t, dof: r.meshInfo.nDof, workers: r.workers, nested: r.nested, w25: r.at25.warpage.signed * 1000, solves: r.solverLog.length, iters: r.solverLog.map(x => x.iters), screeningMs: r.screening ? r.screening[0].ms : null, timings: r.timings }); }).catch(e => reject(e.message));
  }), [args.includes('--standard') ? 'standard' : 'draft', workers]);
  console.log('full analysis:', JSON.stringify(full));
  if (args.includes('--submodels')) {
    const sub = await page.evaluate((workers) => new Promise((resolve, reject) => {
      const t = performance.now();
      const res = app.results; const sel = defaultSubmodelSelection(res); const keys = Array.from(sel);
      const jobs = keys.map(k => { const [die, q] = k.split(':').map(Number); const s = res.screening[die]; return { die, site: { x: s.x[q], y: s.y[q], ix: s.ix[q], iy: s.iy[q] } }; });
      worker.send({ type: 'submodels', jobs, nxy: app.cfg.submodel.nxy, nz: app.cfg.submodel.nz, workers }).then(r => resolve({ ms: performance.now() - t, n: r.length, dW: r.map(x => x.dW), life: r.map(x => x.life.syedEnergy), steps: r.map(x => x.steps), perBumpMs: r.map(x => x.ms) })).catch(e => reject(e.message));
    }), workers);
    console.log('submodels:', JSON.stringify(sub));
  }
  // render results views
  for (const view of ['warpage', 'dieStress', 'bumps', 'uf', 'fatigue', 'view3d', 'report']) {
    await page.evaluate(v => { app.resultsView = v; setCenterTab('results'); }, view);
    await page.waitForTimeout(400);
  }
  const v3 = await page.evaluate(() => ({ threeLoaded: typeof THREE !== 'undefined', stub: !!(window.THREE && window.THREE.__stub), renders: window.__stubRenders || 0, faces: app.results.view3d ? app.results.view3d.part.length : 0, hasView: !!document.getElementById('view3d') }));
  console.log('3D view:', JSON.stringify(v3));
  // exercise the 3D controls while the view is active: colour modes, exaggeration, part toggles
  await page.evaluate(() => { app.resultsView = 'view3d'; setCenterTab('results'); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { app.view3dOpts.color = 'stress'; update3D(); app.view3dOpts.color = 'part'; update3D(); app.view3dOpts.scale = 50; app.view3dOpts.hidden.add(4); update3D(); });
  const v3b = await page.evaluate(() => ({ renders: window.__stubRenders || 0, hasView: !!document.getElementById('view3d'), active: !!three }));
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
