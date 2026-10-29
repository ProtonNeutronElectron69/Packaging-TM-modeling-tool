// Full analysis of a preset package in a desktop compute process, timed, with the peak resident memory of the
// compute process and its helper processes together (sampled every second, the sum of their resident sizes). Use it
// to refit the run panel's runtime and memory estimates (RUN_S_PER_STEP, MEM_MAIN_MB*, MEM_HELPER_MB* in
// src/ui/00-app.js) after a speed or storage change.
//   node tools/desktop-run.mjs [preset] [package] [workers] [--electron]     defaults: standard default 3
// The package is a presetConfig() name (default, bare, stiffener2, offset, coreStudy) or a configuration .json file.
// The compute process runs in plain Node, or with --electron in Electron's own Node (desktop/node_modules, as in the
// app: one JavaScript heap cage per process); `npm install` in desktop/ is needed for the staging step (three.js) and
// for --electron. Linux only (memory from /proc).
import fs from 'node:fs';
import path from 'node:path';
import { fork, execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
if (process.argv.includes('--electron') && !process.versions.electron) {
  // the messages between this tool and the compute process must use the same serializer: run this tool in Electron too
  const r = spawnSync(ELECTRON, process.argv.slice(1), { stdio: 'inherit', env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) });
  process.exit(r.status === null ? 1 : r.status);
}
execFileSync(process.execPath, [path.join(root, 'desktop', 'stage.mjs')], { stdio: 'inherit' });
const page = path.join(root, 'desktop', 'app', 'index.html');
const { computeSource } = createRequire(import.meta.url)(path.join(root, 'desktop', 'core-source.js'));
const html = fs.readFileSync(page, 'utf8');
const db = JSON.parse(html.match(/<script type="application\/json" id="materials-db">([\s\S]*?)<\/script>/)[1]);
const src = computeSource(page);
const core = new Function(src.slice(0, src.lastIndexOf('// ===== Web Worker driver')) + '\nreturn (name) => eval(name);')();
const args = process.argv.slice(2).filter(a => a !== '--electron'), electron = process.argv.includes('--electron');
const preset = args[0] || 'standard', name = args[1] || 'default', workers = +(args[2] || 3);
const cfg = /\.json$/i.test(name) ? core('parseConfig')(fs.readFileSync(name, 'utf8'), db) : core('presetConfig')(db, name);
const child = fork(path.join(root, 'desktop', 'compute-worker.js'), [], electron
  ? { serialization: 'advanced', execPath: ELECTRON, env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) }
  : { serialization: 'advanced' });
child.send({ __fcbgaLoad: src });
let nextId = 1, peak = 0;
const pending = new Map();
const rssMB = pid => { try { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/' + pid + '/status', 'utf8')); return m ? +m[1] / 1024 : 0; } catch (e) { return 0; } };
const kids = pid => { try { return fs.readdirSync('/proc/' + pid + '/task').flatMap(t => fs.readFileSync('/proc/' + pid + '/task/' + t + '/children', 'utf8').trim().split(/\s+/).filter(Boolean)); } catch (e) { return []; } };
const sample = () => { peak = Math.max(peak, rssMB(child.pid) + kids(child.pid).reduce((a, k) => a + rssMB(k), 0)); };
const mem = setInterval(sample, 1000);
let fatal = '';
child.on('exit', (code, signal) => { for (const p of pending.values()) p.reject(new Error('compute process stopped (' + (signal || 'exit code ' + code) + ')' + (fatal ? ': ' + fatal : ''))); });
child.on('message', m => {
  if (m.__fatal) { fatal = m.__fatal; return; }
  if (m.type === 'progress' && /Post|Screening|Boundary/.test(m.msg)) console.log('  ' + m.msg);
  const p = pending.get(m.id);
  if (!p || m.type === 'progress' || m.type === 'partial' || m.type === 'live') return;
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.payload);
});
const send = msg => new Promise((resolve, reject) => { msg.id = nextId++; pending.set(msg.id, { resolve, reject }); child.send(msg); });
await send({ type: 'init', db });
const t0 = Date.now();
const r = await send({ type: 'run', cfg, preset, evaluations: 'full', workers });
sample();
const its = r.solverLog.map(l => l.iters);
console.log(path.basename(name) + ' ' + preset + (electron ? ' (Electron)' : '') + ': ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + r.meshInfo.nDof + ' DOF, ' + r.solverLog.length + ' solves (mean ' + (its.reduce((a, b) => a + b, 0) / its.length).toFixed(0) + ', max ' + Math.max(...its) + ' PCG iterations), ' + r.workers + ' workers, screening ' + (r.screening ? r.screening.map(s => s.ms.toFixed(0)).join('/') + ' ms' : '-') + ', RT warpage ' + (r.at25.warpage.signed * 1000).toFixed(2) + ' µm, peak resident memory ' + peak.toFixed(0) + ' MB');
clearInterval(mem); child.kill(); process.exit(0);
