// Desktop app smoke test (Electron, driven by Playwright): starts desktop/ as the user would, checks
// that the page runs its workers as compute processes, runs a Draft preview and a full analysis,
// renders every results view (the 3D view with the bundled three.js), opens the report window, checks
// that a compute process that dies is reported and replaced, and saves the results to a results file
// that a second launch opens from its command line.
//   node tools/desktop-smoke.mjs [--workers N] [--standard] [--submodels] [--exe path]
// Needs `npm install` in desktop/ and a display (in a headless container: xvfb-run -a node ...).
// --exe runs a packaged build (for example desktop/release/linux-unpacked/fcbga-thermomech-tool
// from npm run pack:dir) instead of the development app in desktop/.
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
let pw;
try { pw = req('playwright'); } catch (e) { pw = createRequire('/opt/node-tools/node_modules/')('playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desk = path.join(root, 'desktop');
const args = process.argv.slice(2);
const workers = args.includes('--workers') ? +args[args.indexOf('--workers') + 1] : 3;
const preset = args.includes('--standard') ? 'standard' : 'draft';
const exe = args.includes('--exe') ? path.resolve(args[args.indexOf('--exe') + 1]) : null;
if (!exe) execFileSync(process.execPath, [path.join(desk, 'stage.mjs')], { stdio: 'inherit' });
const electronBin = exe || createRequire(path.join(desk, 'package.json'))('electron');  // path of the Electron executable (downloads it on first use)
// in a headless Linux container: no setuid sandbox, and software WebGL for the 3D view
const linuxArgs = process.platform === 'linux' ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
const app = await pw._electron.launch({ executablePath: electronBin, args: (exe ? [] : [desk]).concat(linuxArgs), env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '0' }) });
const errors = [];
const page = await app.firstWindow();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.waitForSelector('#floorplan', { timeout: 30000 });
const procs = () => app.evaluate(() => global.fcbgaCompute.size);
console.log('window loaded:', JSON.stringify(await page.evaluate(() => ({ desktop: !!window.fcbgaDesktop, title: document.title, three: typeof THREE !== 'undefined' }))), 'compute processes:', await procs());
await page.waitForFunction(() => app.desktop !== null, null, { timeout: 10000 });
console.log('system:', JSON.stringify(await page.evaluate(() => app.desktop)));
const preview = await page.evaluate(() => new Promise((resolve, reject) => {
  const t = performance.now();
  worker.send({ type: 'run', cfg: app.cfg, preset: 'draft', evaluations: 'preview' }).then(r => resolve({ ms: performance.now() - t, dof: r.meshInfo.nDof, w: r.at25.warpage.signed * 1000, iters: r.solverLog.map(x => x.iters) })).catch(e => reject(e.message));
}));
console.log('Draft preview:', JSON.stringify(preview));
const full = await page.evaluate(([preset, workers]) => new Promise((resolve, reject) => {
  const t = performance.now();
  app.workers = workers;
  worker.send({ type: 'run', cfg: app.cfg, preset, evaluations: 'full', workers }).then(r => {
    r.request = { type: 'run', cfg: structuredClone(app.cfg), preset, evaluations: 'full', workers };
    app.results = r; app.currentFields = r.at25; app.screening = r.screening; app.selectedT = 25; app.analysisLost = false;
    resolve({ ms: performance.now() - t, dof: r.meshInfo.nDof, workers: r.workers, nested: r.nested, w25: r.at25.warpage.signed * 1000, solves: r.solverLog.length, iters: r.solverLog.map(x => x.iters), screeningMs: r.screening ? r.screening[0].ms : null });
  }).catch(e => reject(e.message));
}), [preset, workers]);
console.log('full analysis:', JSON.stringify(full));
if (args.includes('--submodels')) {
  const sub = await page.evaluate(workers => new Promise((resolve, reject) => {
    const t = performance.now();
    const res = app.results; const keys = Array.from(defaultSubmodelSelection(res));
    const jobs = keys.map(k => { const [die, q] = k.split(':').map(Number); const s = res.screening[die]; return { die, site: { x: s.x[q], y: s.y[q], ix: s.ix[q], iy: s.iy[q] } }; });
    worker.send({ type: 'submodels', jobs, nxy: app.cfg.submodel.nxy, nz: app.cfg.submodel.nz, workers }).then(r => { app.submodels = r; resolve({ ms: performance.now() - t, n: r.length, dW: r.map(x => x.dW), snapshots: r.map(x => x.section ? x.section.snaps.length : 0) }); }).catch(e => reject(e.message));
  }), workers);
  console.log('submodels:', JSON.stringify(sub));
}
// results file through File > Save results (the save dialog answered here), reopened at the end by a second launch
// with the file on the command line, as Windows "Open with" does
const rfPath = path.join(root, 'dist', 'desktop-smoke' + '.fcbgares');
try { fs.unlinkSync(rfPath); } catch (e) { /* none yet */ }
await app.evaluate(({ session }, p) => {
  session.defaultSession.removeAllListeners('will-download');
  session.defaultSession.on('will-download', (ev, item) => { item.setSavePath(p); item.once('done', (e, state) => { global.__dlState = state; }); });
}, rfPath);
const rfBefore = await page.evaluate(async () => {
  const ts = app.results.temps.all, T2 = ts.find(T => T < 25) ?? ts[0];
  const f = await worker.send({ type: 'fieldsAt', T: T2 });
  return { T2, w25: app.results.at25.warpage.signed, w2: f.warpage.signed, s2: f.dies[0].top.peakInterior, nSub: app.submodels.length };
});
await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'File').submenu.items.find(i => i.label === 'Save results…').click());
for (let t = 0; t < 600 && !(await app.evaluate(() => global.__dlState)); t++) await page.waitForTimeout(500);
console.log('results file saved:', JSON.stringify({ state: await app.evaluate(() => global.__dlState), MB: fs.existsSync(rfPath) ? +(fs.statSync(rfPath).size / 1048576).toFixed(1) : null }));
// every results view, then the 3D view with the bundled three.js (no CDN access needed)
await page.evaluate(() => { app.section = { axis: 'x', c: 0, a0: -20, a1: 20 }; });
for (const view of ['warpage', 'dieStress', 'bumps', 'uf', 'section', 'fatigue', 'subSection', 'view3d', 'report']) {
  await page.evaluate(v => { app.resultsView = v; setCenterTab('results'); }, view);
  await page.waitForTimeout(400);
}
await page.evaluate(() => { app.resultsView = 'view3d'; setCenterTab('results'); });
await page.waitForFunction(() => typeof THREE !== 'undefined', null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.evaluate(() => { app.view3dOpts.mesh = true; update3D(); });
console.log('3D view:', JSON.stringify(await page.evaluate(() => ({ three: THREE.REVISION, src: Array.from(document.scripts).map(s => s.src).filter(s => /three/.test(s)).map(s => s.split('/').pop()), active: !!three, meshEdges: three && three.lines ? three.lines.geometry.attributes.position.count / 2 : 0 }))));
await page.screenshot({ path: path.join(root, 'dist', 'screenshot_desktop_3d.png') });
// the printable report opens as an app window
const [report] = await Promise.all([app.waitForEvent('window'), page.evaluate(() => openReport())]);
await report.waitForLoadState();
console.log('report window:', JSON.stringify(await report.evaluate(() => ({ title: document.title, tables: document.querySelectorAll('table').length, hint: document.body.innerText.includes('File > Print') }))));
await report.close();
// a compute process that dies (memory running out, for example) is reported and replaced on the next request
console.log('compute processes before the simulated crash:', await procs());
await app.evaluate(() => { const first = global.fcbgaCompute.values().next().value; first.kill('SIGKILL'); });
await page.waitForFunction(() => app.analysisLost === 'stopped', null, { timeout: 10000 });
const notice = await page.evaluate(() => { app.resultsView = 'warpage'; setCenterTab('results'); return document.querySelector('#center-body .msg.warning') ? document.querySelector('#center-body .msg.warning').textContent.slice(0, 90) : null; });
console.log('after the crash:', JSON.stringify({ analysisLost: await page.evaluate(() => app.analysisLost), notice }));
const again = await page.evaluate(() => worker.send({ type: 'run', cfg: app.cfg, preset: 'draft', evaluations: 'preview' }).then(r => r.at25.warpage.signed * 1000, e => 'failed: ' + e.message));
console.log('preview after the restart:', again, 'compute processes:', await procs());
await page.evaluate(() => setCenterTab('floorplan'));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(root, 'dist', 'screenshot_desktop.png') });
await app.close();
// second launch with the results file on the command line: it opens by itself, and a temperature never evaluated
// before saving comes out of the reloaded analysis as it did from the original one
const app2 = await pw._electron.launch({ executablePath: electronBin, args: (exe ? [] : [desk]).concat(linuxArgs, [rfPath]), env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '0' }) });
const page2 = await app2.firstWindow();
page2.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('second launch ' + m.type() + ': ' + m.text()); });
page2.on('pageerror', e => errors.push('second launch pageerror: ' + e.message));
const t2 = Date.now();
await page2.waitForFunction(() => typeof app !== 'undefined' && app.results && app.analysisLost === false && !app.job, null, { timeout: 300000 });
const openMs = Date.now() - t2;
const rfAfter = await page2.evaluate(async T2 => {
  const f = await worker.send({ type: 'fieldsAt', T: T2 });
  return { w25: app.results.at25.warpage.signed, w2: f.warpage.signed, s2: f.dies[0].top.peakInterior, nSub: app.submodels.length, tab: app.centerTab };
}, rfBefore.T2);
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), 1e-30);
console.log('results file reopened by a second launch:', JSON.stringify({ openMs, before: rfBefore, after: rfAfter, warpageRel: rel(rfBefore.w2, rfAfter.w2), stressRel: rel(rfBefore.s2, rfAfter.s2) }));
if (rfAfter.w25 !== rfBefore.w25 || rfAfter.nSub !== rfBefore.nSub || !(rel(rfBefore.w2, rfAfter.w2) < 1e-5) || !(rel(rfBefore.s2, rfAfter.s2) < 1e-5)) errors.push('error: results file round trip: ' + JSON.stringify({ rfBefore, rfAfter }));
await app2.close();
fs.unlinkSync(rfPath);
console.log('console errors/warnings:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ', e);
