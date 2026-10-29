// Desktop app check without Electron: starts desktop/compute-worker.js the way the app's main
// process does (a child process given the page's own core and driver), runs a full Draft analysis with
// a helper compute process, checks that live solver reports arrive from the driver and the helper,
// that the helper is a separate process (its own JavaScript heap) that goes away with the job, and
// that a failing driver reports its cause before the process exits, and compares its 25 °C
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

/** Child process ids of a process (Linux, from /proc), or null where /proc is missing. */
function childPids(pid) {
  try { return fs.readdirSync('/proc/' + pid + '/task').flatMap(t => fs.readFileSync('/proc/' + pid + '/task/' + t + '/children', 'utf8').trim().split(/\s+/).filter(Boolean)); } catch (e) { return null; }
}

let failed = false;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failed = true; };
try {
  const init = await send({ type: 'init', db });
  check(init.ok && init.nested, 'compute process started with helpers available');
  const t0 = Date.now();
  let kidsMax = 0;
  const watch = setInterval(() => { const k = childPids(child.pid); if (k) kidsMax = Math.max(kidsMax, k.length); }, 250);
  const r = await send({ type: 'run', cfg, preset: 'draft', evaluations: 'full', workers: 2 });
  clearInterval(watch);
  console.log('full Draft analysis in the compute process: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + r.meshInfo.nDof + ' DOF, ' + r.solverLog.length + ' solves, ' + r.workers + ' workers');
  check(r.workers === 2 && r.solverLog.some(l => l.helper), 'temperature sweep shared with a helper');
  check(live.get(0) > 0 && live.get(1) > 0, 'live solver reports from the driver and the helper (' + JSON.stringify(Object.fromEntries(live)) + ')');
  if (childPids(child.pid)) {
    await new Promise(res => setTimeout(res, 1000));
    check(kidsMax === 1 && childPids(child.pid).length === 0, 'the helper ran as a process of its own (' + kidsMax + ' during the run) and stopped with the job (' + childPids(child.pid).length + ' left)');
  } else console.log('SKIP helper process count (needs /proc)');
  check(Array.isArray(r.screening) && r.screening.length === cfg.dies.length, 'bump screening ran');
  const an = new (core('Analysis'))(cfg, { preset: 'draft', evaluations: 'preview' });
  an.build(); an.run();
  const direct = core('warpageJEITA')(an.mesh, an.mesh.geom, an.fields.get(25), cfg).signed;
  const viaApp = r.at25.warpage.signed;
  const rel = Math.abs(viaApp - direct) / Math.abs(direct);
  check(rel < 1e-6, '25 °C warpage ' + (viaApp * 1000).toFixed(4) + ' µm matches the direct run ' + (direct * 1000).toFixed(4) + ' µm (relative difference ' + rel.toExponential(1) + ')');
  // a driver that fails outside a job (here a malformed message) stops the process with its cause sent first
  const bad = fork(path.join(root, 'desktop', 'compute-worker.js'), [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  bad.send({ __fcbgaLoad: src });
  const stop = await new Promise(res => {
    let why = '';
    bad.on('message', m => { if (m && m.__fatal) why = m.__fatal; if (m && m.type === 'result') bad.send(null); });
    bad.on('exit', code => res({ code, why }));
    bad.send({ type: 'init', db, id: 1 });
  });
  check(stop.code === 1 && /Error/.test(stop.why), 'a failing driver reports its cause before the process exits (exit code ' + stop.code + ': ' + stop.why.split('\n')[0] + ')');
} catch (e) {
  check(false, 'compute process: ' + e.message);
}
child.kill();
process.exit(failed ? 1 : 0);
