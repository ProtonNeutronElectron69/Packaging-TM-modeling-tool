'use strict';
// ===== UI: run progress (status dot, bar, times, details panel) ===============
// Every job started through startRun() or runSensitivity() opens a progress record. Two sources feed it:
// the job's progress messages (step text and fraction) and the workers' live reports ({type: 'live'},
// at most once a second per worker: the running PCG solve with its iterations and residual history, or
// the bump submodel step). Once a second the record is judged and drawn:
//   green   running normally
//   orange  a solve needs far more iterations than the run's average, a preconditioner fallback, a
//           submodel step cutback, or no message at all from the job for CONST.LIVE_QUIET_MS
//   red     a solve whose residual has not halved over CONST.LIVE_STALL_ITERS iterations, a solve close to
//           the iteration limit, or a worker inside a solve or submodel silent for CONST.LIVE_STUCK_MS

const runProgress = { job: null, open: prefs.get('progOpen', false), timer: null, sel: null };

/** Step list of a global analysis, matched against its progress messages in order. */
function analysisSteps(msg) {
  const full = msg.evaluations !== 'preview';
  return [
    { label: 'Mesh and stiffness model', re: /^Meshing|^Mesh:/ },
    { label: full ? 'Thermal path: process chain, sweep, chip-join state' : 'Thermal path: process chain to 25 °C', re: /^Thermal path/, count: true },
    { label: 'Post-processing', re: /^Post-processing/ },
    full ? { label: '3D view fields', re: /^Boundary faces/ } : null,
    full ? { label: 'Bump screening', re: /^Screening/ } : null,
  ].filter(Boolean).map(s => Object.assign({ state: 'wait', t0: 0, t1: 0, note: '' }, s));
}

/** Open the progress record of a job. meta: {kind: 'analysis'|'submodels'|'sensitivity'|'other', msg, preset}. */
function progressBegin(label, meta) {
  meta = meta || {};
  const now = performance.now();
  const kind = meta.kind || 'other';
  runProgress.job = {
    label, kind, t0: now, lastAny: now, frac: 0, msg: '', preset: meta.preset || '', dof: 0,
    steps: kind === 'analysis' ? analysisSteps(meta.msg || {}) : [],
    rows: new Map(), names: new Map(), solves: [], log: [], reports: 0, colour: 'green', reason: '', reasonRow: null,
  };
  runProgress.sel = null;
  clearInterval(runProgress.timer);
  runProgress.timer = setInterval(progressTick, C.CONST.LIVE_INTERVAL_MS);
  progressTick();
}

/** A progress message of the running job (status text and overall fraction). */
function progressMsg(frac, msg) {
  const j = runProgress.job; if (!j) return;
  const now = performance.now();
  j.lastAny = now; j.frac = isFinite(frac) ? Math.max(j.frac, Math.min(1, frac)) : j.frac; j.msg = msg || '';
  const mDof = /^Mesh: (\d+) DOF/.exec(j.msg); if (mDof) j.dof = +mDof[1];
  if (j.kind === 'analysis') {
    const i = j.steps.findIndex(s => s.re.test(j.msg));
    if (i >= 0) {
      j.steps.forEach((s, k) => {
        if (k < i && s.state !== 'done') { s.state = 'done'; s.t1 = now; if (!s.t0) s.t0 = now; }
        if (k === i && s.state !== 'run') { s.state = 'run'; s.t0 = now; }
      });
      const c = /\((\d+)\/(\d+)/.exec(j.msg);
      if (j.steps[i].count && c) j.steps[i].note = c[1] + ' of ' + c[2];
    }
  } else {
    // other jobs: one step per distinct message head, e.g. "Running V3: ..." (verification), "Submodel 2/4 ..." (submodels)
    const sm = /^Submodel (\d+)\/(\d+)/.exec(j.msg);
    const key = sm ? 'Submodel ' + sm[1] : j.msg.replace(/\s*\(.*$/, '').replace(/\s*\d+\/\d+.*$/, '').replace(/:$/, '');
    let s = j.steps.find(x => x.key === key);
    if (!s) {
      if (!sm) for (const x of j.steps) if (x.state === 'run') { x.state = 'done'; x.t1 = now; }
      s = { key, label: sm ? 'Submodel ' + sm[1] + ' of ' + sm[2] : key, state: 'run', t0: now, t1: 0, note: '' };
      j.steps.push(s);
      if (j.steps.length > 12) j.steps.shift();
    }
    const st = /step (\d+)\/(\d+)/.exec(j.msg) || (!sm && /(\d+)\/(\d+)/.exec(j.msg));
    if (st) s.note = (sm ? 'step ' : '') + st[1] + ' of ' + st[2];
    if (sm && st && st[1] === st[2] && s.state === 'run') { s.state = 'done'; s.t1 = now; }
  }
  progressStatusbar();
}

/** A live report from one worker (key: client and worker slot). */
function progressLive(key, info) {
  const j = runProgress.job; if (!j || !info) return;
  const now = performance.now();
  j.lastAny = now; j.reports++;
  if (!j.names.has(key)) j.names.set(key, 'Worker ' + (j.names.size + 1));
  let r = j.rows.get(key);
  if (!r) { r = { key, name: j.names.get(key), active: false, last: now }; j.rows.set(key, r); }
  r.last = now;
  const ev = info.event;
  if (info.kind === 'submodel') {
    r.kind = 'submodel'; r.label = info.label;
    if (ev === 'start') Object.assign(r, { active: true, step: 0, nsteps: info.nsteps, T: 25, cutbacks: 0, cutbackAt: 0, n: info.n });
    if (ev === 'step') { Object.assign(r, { step: info.step, nsteps: info.nsteps, T: info.T, cutbacks: info.cutbacks, newton: info.newtonPerStep, cycle: info.cycle, cycles: info.cycles }); if (info.step >= info.nsteps) { r.active = false; progressLog(r.name + ': ' + info.label + ' done (' + info.nsteps + ' steps, ' + info.cutbacks + ' cutbacks)'); } }
    if (ev === 'cutback') { r.cutbacks = info.cutbacks; r.cutbackAt = now; progressLog(r.name + ': ' + info.label + ' step ' + info.step + ' at ' + fmt(info.T, 0) + ' °C cut back to ' + info.nsub + ' sub-steps'); }
    return;
  }
  r.kind = 'solve';
  if (ev === 'start') {
    Object.assign(r, { active: true, label: info.label, iters: 0, it: 0, relres: null, r0: null, hist: null, relresBack: null, precond: info.precond, building: !!info.building, fallback: false, maxit: C.CONST.PCG_MAXIT, tol: C.CONST.PCG_TOL, t0: now });
    if (info.n) j.dof = j.dof || Math.round(info.n);
    if (runProgress.sel === null) runProgress.sel = key;
  } else if (ev === 'iter') {
    Object.assign(r, { active: true, label: info.label, iters: info.iters, it: info.it, maxit: info.maxit, relres: info.relres, r0: info.r0, tol: info.tol, hist: info.hist, relresBack: info.relresBack, precond: info.precond, building: false });
  } else if (ev === 'rebuild') {
    r.building = true; r.hist = null; r.relresBack = null;
    progressLog(r.name + ': ' + info.label + ': preconditioner rebuilt after ' + info.iters + ' PCG iterations (residual ' + fmtE(info.relres, 1) + ')');
  } else if (ev === 'fallback') {
    r.building = true; r.fallback = true; r.hist = null; r.relresBack = null; r.precond = info.precond;
    progressLog(r.name + ': ' + info.label + ': switched to ' + precondName(info.precond) + ' after ' + info.iters + ' PCG iterations (' + precondName(info.from) + ' did not converge)');
  } else if (ev === 'solved') {
    Object.assign(r, { active: false, iters: info.iters, relres: info.relres, building: false, ms: info.ms, precond: info.precond });
    if (info.converged) j.solves.push(info.iters);
    progressLog(r.name + ': ' + info.label + (info.converged ? ' solved: ' : ' NOT converged: ') + info.iters + ' PCG iterations, residual ' + fmtE(info.relres, 1) + ', ' + fmt(info.ms / 1000, 1) + ' s');
  }
}

function precondName(k) { return k === 'ic' ? 'IC(0)' : 'multigrid'; }
function progressLog(text) {
  const j = runProgress.job; if (!j) return;
  const d = new Date(), p = n => String(n).padStart(2, '0');
  j.log.push(p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '  ' + text);
  if (j.log.length > 40) j.log.shift();
}

function progressEnd() {
  clearInterval(runProgress.timer); runProgress.timer = null;
  runProgress.job = null;
  const panel = $('#prog'); if (panel) { panel.hidden = true; panel.innerHTML = ''; }
  progressStatusbar();
}

const fmtDur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtAge = ms => ms < 60000 ? fmt(ms / 1000, ms < 10000 ? 1 : 0) + ' s ago' : Math.floor(ms / 60000) + ' min ' + Math.round(ms / 1000) % 60 + ' s ago';

/** Judge one worker row: {colour, reason}. */
function rowState(j, r, now) {
  const K = C.CONST;
  let colour = 'green', reason = '';
  const set = (c, why) => { if (c === 'red' || colour === 'green') { if (!(c === 'orange' && colour === 'red')) { colour = c; reason = why; } } };
  if (r.kind === 'submodel') {
    if (r.cutbackAt && now - r.cutbackAt < K.LIVE_CUTBACK_MS) set('orange', r.label + ' is cutting back its time step at ' + fmt(r.T, 0) + ' °C (' + r.cutbacks + ' cutbacks so far); the solder is flowing fast there');
  } else if (r.active) {
    const done = j.solves.length, avg = done ? j.solves.reduce((a, b) => a + b, 0) / done : 0;
    const slow = done >= K.LIVE_SLOW_MIN_SOLVES ? K.LIVE_SLOW_FACTOR * avg : K.LIVE_SLOW_ITERS;
    if (r.fallback) set('orange', r.label + ': the preferred preconditioner did not converge, so the solver switched to ' + precondName(r.precond));
    if (r.iters > slow) set('orange', r.label + ' is converging slowly (' + r.iters + ' PCG iterations' + (done >= K.LIVE_SLOW_MIN_SOLVES ? '; this run averages ' + Math.round(avg) : '') + ')');
    if (r.relresBack !== null && r.relres > K.LIVE_STALL_RATIO * r.relresBack) set('red', r.label + ' has stopped converging (residual ' + fmtE(r.relres, 1) + ', not halved over the last ' + K.LIVE_STALL_ITERS + ' iterations)');
    if (r.it > K.LIVE_MAXIT_FRAC * r.maxit) set('red', r.label + ' is close to the ' + r.maxit + '-iteration limit (' + r.it + ' iterations, residual ' + fmtE(r.relres, 1) + ')');
  }
  if (r.active && now - r.last > K.LIVE_STUCK_MS) set('red', r.name + ' has sent nothing for ' + fmtAge(now - r.last).replace(' ago', '') + ' while inside ' + (r.label || 'a solve'));
  return { colour, reason };
}

/** Judge the whole job: the worst worker, or silence. */
function jobState(j, now) {
  let colour = 'green', reason = '', row = null;
  for (const r of j.rows.values()) {
    const s = rowState(j, r, now); r.colour = s.colour;
    if (s.colour === 'red' && colour !== 'red' || s.colour === 'orange' && colour === 'green') { colour = s.colour; reason = s.reason; row = r.key; }
  }
  if (colour === 'green' && now - j.lastAny > C.CONST.LIVE_QUIET_MS) { colour = 'orange'; reason = 'no progress message for ' + fmtAge(now - j.lastAny).replace(' ago', ''); }
  return { colour, reason, row };
}

function progressTick() {
  const j = runProgress.job; if (!j) return;
  const now = performance.now();
  const s = jobState(j, now);
  if (s.colour !== j.colour) progressLog(s.colour === 'green' ? 'back to normal' : (s.colour === 'red' ? 'Red: ' : 'Orange: ') + s.reason);
  j.colour = s.colour; j.reason = s.reason; j.reasonRow = s.row;
  progressStatusbar();
  if (runProgress.open) renderProgressPanel();
}

/** Remaining time from the elapsed time and the overall fraction (none while red or too early to tell). */
function progressTimes(j, now) {
  const el = now - j.t0;
  let left = '';
  if (j.colour === 'red') left = 'remaining time unknown';
  else if (j.frac > 0.03 && el > 3000) left = 'about ' + fmtDur(el * (1 - j.frac) / j.frac) + ' left';
  return fmtDur(el) + ' elapsed' + (left ? ' · ' + left : '');
}

/** Status bar: dot, bar, times and the Details button follow the running job. */
function progressStatusbar() {
  const j = runProgress.job, dot = $('#status-dot'), bar = $('#status-progress'), time = $('#status-time'), det = $('#btn-details');
  if (!dot) return;
  if (!j) { dot.hidden = true; time.hidden = true; det.hidden = true; return; }
  const now = performance.now();
  dot.hidden = false; time.hidden = false; det.hidden = false;
  dot.className = 'sdot ' + j.colour;
  dot.setAttribute('data-tip', TIPS['progDot_' + j.colour] + (j.reason ? ' Now: ' + j.reason + '.' : ''));
  bar.className = 'sbar ' + (j.colour === 'green' ? '' : j.colour);
  time.textContent = progressTimes(j, now);
  det.textContent = runProgress.open ? 'Details ▾' : 'Details ▴';
  const text = j.colour !== 'green' && j.reason ? j.label + ': ' + j.reason : j.label + (j.msg ? ': ' + j.msg : ' starting…');
  $('#status-text').textContent = text;
}

function toggleProgressPanel() {
  runProgress.open = !runProgress.open;
  prefs.set('progOpen', runProgress.open);
  if (runProgress.open) renderProgressPanel(); else $('#prog').hidden = true;
  progressStatusbar();
}

/** Residual history of one solve as a small SVG: log10 residual over iterations, the target dashed. */
function residualSpark(r, colour) {
  const W = 260, H = 46, pts = r.hist || [];
  const n = pts.length / 2;
  const lo = Math.log10(r.tol) - 0.5;
  let hi = 0; for (let q = 0; q < n; q++) hi = Math.max(hi, pts[2 * q + 1]);
  const xmax = Math.max(1, n ? pts[2 * (n - 1)] : 1);
  const X = it => 4 + it / xmax * (W - 8), Y = v => 4 + (hi - Math.max(lo, Math.min(hi, v))) / (hi - lo) * (H - 8);
  let d = '';
  for (let q = 0; q < n; q++) d += (q ? 'L' : 'M') + X(pts[2 * q]).toFixed(1) + ' ' + Y(pts[2 * q + 1]).toFixed(1);
  const yt = Y(Math.log10(r.tol));
  const stroke = colour === 'red' ? '#dc2626' : colour === 'orange' ? '#ea8a0c' : 'var(--accent)';
  return '<svg width="' + W + '" height="' + H + '" style="display:block;flex:0 0 auto"><rect x="0" y="0" width="' + W + '" height="' + H + '" rx="4" fill="var(--panel2)"/>' +
    '<line x1="4" x2="' + (W - 4) + '" y1="' + yt + '" y2="' + yt + '" stroke="var(--muted)" stroke-dasharray="4 3"/>' +
    '<text x="' + (W - 6) + '" y="' + (yt - 3) + '" text-anchor="end" font-size="9" fill="var(--muted)">target ' + fmtE(r.tol, 0) + '</text>' +
    (d ? '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="1.8"/>' : '') + '</svg>';
}

/** Fraction of the way from the starting residual to the target, on a log scale. */
function solveFraction(r) {
  if (!r.relres || !r.r0 || !(r.r0 > r.tol)) return r.active ? 0 : 1;
  return Math.max(0, Math.min(1, Math.log(r.r0 / r.relres) / Math.log(r.r0 / r.tol)));
}

function renderProgressPanel() {
  const j = runProgress.job, panel = $('#prog');
  if (!panel) return;
  if (!j) { panel.hidden = true; return; }
  const now = performance.now();
  panel.hidden = false;
  const rows = Array.from(j.rows.values());
  const precs = Array.from(new Set(rows.filter(r => r.kind === 'solve' && r.precond).map(r => precondName(r.precond) + ' PCG')));
  const sub = [j.preset, j.dof ? j.dof.toLocaleString('en-US') + ' DOF' : '', rows.length ? rows.length + ' worker' + (rows.length > 1 ? 's' : '') + ' reporting' : '', precs.join(', ')].filter(Boolean).join(' · ');
  const steps = h('div', { class: 'stages' }, ...j.steps.map(s => h('div', { class: s.state },
    h('span', { class: 'ic' }, s.state === 'done' ? '✓' : s.state === 'run' ? '▶' : '○'),
    s.label + (s.note ? ' (' + s.note + ')' : ''),
    h('span', { class: 't' }, s.state === 'done' ? fmt((s.t1 - s.t0) / 1000, 1) + ' s' : s.state === 'run' ? 'running ' + fmtDur(now - s.t0) : ''))));
  if (!j.steps.length) steps.append(h('div', { class: 'run' }, h('span', { class: 'ic' }, '▶'), j.msg || 'Starting…'));
  const hdr = h('div', Object.assign({ class: 'wk hdr' }, tip('progRows')), h('span', null, 'Worker'), h('span', null, 'Task'), h('span', null, 'This task'), h('span', null, 'Iterations · residual'), h('span', null, 'Last message'));
  const wk = rows.map(r => {
    const frac = r.kind === 'submodel' ? (r.nsteps ? r.step / r.nsteps : 0) : solveFraction(r);
    let detail;
    if (r.kind === 'submodel') detail = 'step ' + r.step + ' of ' + r.nsteps + ' · ' + fmt(r.T, 0) + ' °C · ' + r.cutbacks + ' cutback' + (r.cutbacks === 1 ? '' : 's');
    else if (!r.active) detail = 'done: ' + r.iters + ' iterations, ' + fmt((r.ms || 0) / 1000, 1) + ' s';
    else if (r.building) detail = 'building the preconditioner';
    else detail = 'PCG ' + r.iters + ' · residual ' + fmtE(r.relres, 1);
    return h('div', Object.assign({ class: 'wk ' + (r.active ? r.colour || '' : 'idle') + (runProgress.sel === r.key ? ' sel' : ''), onclick: () => { runProgress.sel = r.key; renderProgressPanel(); } }, tip('progRow')),
      h('span', null, r.name), h('span', null, r.label || ''), h('div', { class: 'mini' }, h('i', { style: 'width:' + (100 * frac).toFixed(0) + '%' })), h('span', null, detail), h('span', null, fmtAge(now - r.last)));
  });
  const right = h('div', null, hdr, ...wk);
  if (!rows.length) right.append(h('div', { class: 'small muted' }, 'No solver reports yet (meshing, assembly or post-processing).'));
  // residual history of the selected worker (default: the one behind the warning, else the first one reporting)
  const selKey = j.reasonRow || (j.rows.has(runProgress.sel) ? runProgress.sel : rows.length ? rows[0].key : null);
  const sr = selKey && j.rows.get(selKey);
  if (sr && sr.kind === 'solve' && sr.hist) {
    const done = j.solves.length, avg = done ? Math.round(j.solves.reduce((a, b) => a + b, 0) / done) : 0;
    const trend = sr.colour === 'red' ? 'residual not falling' : sr.colour === 'orange' ? 'residual falling, but slowly' : 'residual falling steadily';
    const sp = h('div', Object.assign({ class: 'spark' }, tip('progSpark')));
    sp.innerHTML = residualSpark(sr, sr.colour) + '<span></span>';
    sp.lastChild.textContent = sr.name + ', ' + sr.label + ': ' + trend + ' (' + sr.iters + ' iterations' + (done ? '; this run averages ' + avg + ' per solve' : '') + ')';
    right.append(sp);
  } else if (sr && sr.kind === 'submodel') {
    right.append(h('div', { class: 'spark' }, sr.name + ', ' + sr.label + ': cycle ' + (sr.cycle || 1) + ' of ' + (sr.cycles || '–') + ', ' + fmt(sr.newton, 1) + ' Newton iterations per step on average'));
  }
  if (j.colour !== 'green') right.append(h('div', { class: 'msgline ' + j.colour }, (j.colour === 'red' ? 'Red: the run is likely stuck. ' : 'Orange: a step is taking longer than usual. ') + j.reason + '. ' + TIPS['progAdvice_' + j.colour]));
  if (j.log.length) right.append(h('div', { class: 'logt' }, ...j.log.slice(-6).map(l => h('div', null, l))));
  panel.innerHTML = '';
  panel.append(
    h('h4', null, h('span', { class: 'sdot ' + j.colour }), j.label, h('span', { class: 'sub' }, sub), h('span', { class: 'sub', style: 'margin-left:auto' }, progressTimes(j, now))),
    h('div', { class: 'pgrid' }, steps, right));
}
