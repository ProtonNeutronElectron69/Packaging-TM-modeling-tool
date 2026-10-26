// Full analysis of a preset package in a desktop compute process, timed, with the process's peak resident memory
// (its helpers are threads of the same process). Use it to refit the run panel's runtime and memory estimates
// (RUN_S_PER_STEP, MEM_MAIN_MB*, MEM_HELPER_MB* in src/ui/00-app.js) after a speed or storage change.
//   node tools/desktop-run.mjs [preset] [package] [workers]     defaults: standard default 3
// Package names are those of presetConfig() (default, bare, stiffener2, offset, coreStudy). The compute process runs in
// plain Node; `npm install` in desktop/ is needed only for the staging step (three.js). Linux only (peak memory from /proc).
import fs from 'node:fs';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'desktop', 'stage.mjs')], { stdio: 'inherit' });
const page = path.join(root, 'desktop', 'app', 'index.html');
const { computeSource } = createRequire(import.meta.url)(path.join(root, 'desktop', 'core-source.js'));
const html = fs.readFileSync(page, 'utf8');
const db = JSON.parse(html.match(/<script type="application\/json" id="materials-db">([\s\S]*?)<\/script>/)[1]);
const src = computeSource(page);
const core = new Function(src.slice(0, src.lastIndexOf('// ===== Web Worker driver')) + '\nreturn (name) => eval(name);')();
const preset = process.argv[2] || 'standard', name = process.argv[3] || 'default', workers = +(process.argv[4] || 3);
const cfg = core('presetConfig')(db, name);
const child = fork(path.join(root, 'desktop', 'compute-worker.js'), [], { serialization: 'advanced' });
child.send({ __fcbgaLoad: src });
let nextId = 1, peak = 0;
const pending = new Map();
const sample = () => { try { const m = /VmHWM:\s+(\d+)/.exec(fs.readFileSync('/proc/' + child.pid + '/status', 'utf8')); if (m) peak = Math.max(peak, +m[1] / 1024); } catch (e) { /* process gone */ } };
const mem = setInterval(sample, 2000);
child.on('message', m => {
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
console.log(name + ' ' + preset + ': ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + r.meshInfo.nDof + ' DOF, ' + r.solverLog.length + ' solves (mean ' + (its.reduce((a, b) => a + b, 0) / its.length).toFixed(0) + ', max ' + Math.max(...its) + ' PCG iterations), ' + r.workers + ' workers, screening ' + (r.screening ? r.screening.map(s => s.ms.toFixed(0)).join('/') + ' ms' : '-') + ', RT warpage ' + (r.at25.warpage.signed * 1000).toFixed(2) + ' µm, peak resident memory ' + peak.toFixed(0) + ' MB');
clearInterval(mem); child.kill(); process.exit(0);
