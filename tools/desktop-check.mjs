// Desktop app check without Electron: starts desktop/compute-worker.js the way the app's main
// process does (a child process given the page's own core and driver), runs a full Draft analysis on
// two helper threads, checks that both threads' live solver reports arrive, and compares its 25 °C
// warpage with the same core run directly in this process.
// Used by the Windows build workflow; also runs locally: node tools/desktop-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staged = path.join(root, 'desktop', 'app', 'index.html');
const page = fs.existsSync(staged) ? staged : path.join(root, 'dist', 'fcbga_thermomech_tool.html');
const { computeSource } = createRequire(import.meta.url)(path.join(root, 'desktop', 'core-source.js'));
const html = fs.readFileSync(page, 'utf8');
const db = JSON.parse(html.match(/<script type="application\/json" id="materials-db">([\s\S]*?)<\/script>/)[1]);
const src = computeSource(page);
const core = new Function(src.slice(0, src.lastIndexOf('// ===== Web Worker driver')) + '\nreturn (name) => eval(name);')();
const cfg = core('presetConfig')(db, 'default');

const child = fork(path.join(root, 'desktop', 'compute-worker.js'), [], { serialization: 'advanced' });
child.send({ __fcbgaLoad: src });
let nextId = 1;
const pending = new Map();
const live = new Map();  // worker slot -> live reports received (the relay forwards the helpers' ports)
child.on('message', m => {
  if (m.type === 'live') { live.set(m.w, (live.get(m.w) || 0) + 1); return; }
  const p = pending.get(m.id);
  if (!p || m.type === 'progress' || m.type === 'partial') return;
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.payload);
});
child.on('exit', code => { for (const p of pending.values()) p.reject(new Error('compute process exited with code ' + code)); });
const send = msg => new Promise((resolve, reject) => { msg.id = nextId++; pending.set(msg.id, { resolve, reject }); child.send(msg); });

let failed = false;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failed = true; };
try {
  const init = await send({ type: 'init', db });
  check(init.ok && init.nested, 'compute process started with helper threads available');
  const t0 = Date.now();
  const r = await send({ type: 'run', cfg, preset: 'draft', evaluations: 'full', workers: 2 });
  console.log('full Draft analysis in the compute process: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + r.meshInfo.nDof + ' DOF, ' + r.solverLog.length + ' solves, ' + r.workers + ' workers');
  check(r.workers === 2 && r.solverLog.some(l => l.helper), 'temperature sweep shared with a helper thread');
  check(live.get(0) > 0 && live.get(1) > 0, 'live solver reports from the driver and the helper thread (' + JSON.stringify(Object.fromEntries(live)) + ')');
  check(Array.isArray(r.screening) && r.screening.length === cfg.dies.length, 'bump screening ran');
  const an = new (core('Analysis'))(cfg, { preset: 'draft', evaluations: 'preview' });
  an.build(); an.run();
  const direct = core('warpageJEITA')(an.mesh, an.mesh.geom, an.fields.get(25), cfg).signed;
  const viaApp = r.at25.warpage.signed;
  const rel = Math.abs(viaApp - direct) / Math.abs(direct);
  check(rel < 1e-6, '25 °C warpage ' + (viaApp * 1000).toFixed(4) + ' µm matches the direct run ' + (direct * 1000).toFixed(4) + ' µm (relative difference ' + rel.toExponential(1) + ')');
} catch (e) {
  check(false, 'compute process: ' + e.message);
}
child.kill();
process.exit(failed ? 1 : 0);
