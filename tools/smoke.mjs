// Browser smoke test with Playwright (headless Chromium): loads the built HTML,
// checks for console errors, runs a Draft preview and a full Draft analysis via
// the worker, and reports timings as seen in the browser.
//   node tools/smoke.mjs [--full] [--standard]
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
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
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
  const full = await page.evaluate((preset) => new Promise((resolve, reject) => {
    const t = performance.now();
    worker.send({ type: 'run', cfg: app.cfg, preset, evaluations: 'full' }, (f, m) => {}).then(r => { app.results = r; app.currentFields = r.at25; resolve({ ms: performance.now() - t, dof: r.meshInfo.nDof, w25: r.at25.warpage.signed * 1000, solves: r.solverLog.length, iters: r.solverLog.map(x => x.iters), screeningMs: r.screening ? r.screening[0].ms : null, timings: r.timings }); }).catch(e => reject(e.message));
  }), args.includes('--standard') ? 'standard' : 'draft');
  console.log('full analysis:', JSON.stringify(full));
  // render results views
  for (const view of ['warpage', 'dieStress', 'bumps', 'uf', 'fatigue', 'view3d', 'report']) {
    await page.evaluate(v => { app.resultsView = v; setCenterTab('results'); }, view);
    await page.waitForTimeout(400);
  }
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
