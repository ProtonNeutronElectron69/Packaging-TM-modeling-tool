'use strict';
// ===== UI: end-of-run dialogs ==================================================
// When a job the user started ends, a dialog says so: a green one with the key figures of the run (times,
// mesh, PCG iterations, the headline result) when it finished, a red one when it failed, crashed or was
// cancelled (what happened, where it stopped, what is kept, what to try). startRun() and runSensitivity()
// take a snapshot of the progress record (progressSnapshot()) before closing it and pass it here.

/** Kind of failure: 'crashed' (the worker or compute process died), 'cancelled' (the user stopped it) or 'failed' (the job threw). */
function failureKind(err) {
  if (!err) return 'failed';
  if (err.message === 'cancelled') return 'cancelled';
  return err.crashed ? 'crashed' : 'failed';
}

const RUN_FAIL_TITLE = { crashed: 'crashed', failed: 'failed', cancelled: 'was cancelled' };

/** Two-column table of label and value rows; rows with a null value are left out. */
function runStatsTable(rows) {
  return h('table', { class: 'run-stats' }, ...rows.filter(r => r && r[1] !== null && r[1] !== undefined && r[1] !== '').map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v))));
}

/** Step durations from the progress record, as a table. */
function runStepsTable(snap, finished) {
  const steps = (snap && snap.steps || []).filter(s => s.ms > 0 || s.state === 'run').map(s => finished && s.state === 'run' ? Object.assign({}, s, { state: 'done' }) : s);
  if (!steps.length) return null;
  return h('div', null, h('h4', null, 'Steps'), h('table', { class: 'run-stats' },
    ...steps.map(s => h('tr', null, h('td', null, s.label + (s.note ? ' (' + s.note + ')' : '')), h('td', null, s.state === 'run' ? 'stopped here after ' + fmtDur(s.ms) : fmtDur(s.ms))))));
}

/** PCG summary of a solver log: number of solves, total, mean and largest iteration count, fallbacks to the other preconditioner. */
function pcgSummary(log) {
  if (!log || !log.length) return null;
  let tot = 0, max = 0, fallback = 0, ms = 0;
  for (const r of log) { tot += r.iters; max = Math.max(max, r.iters); if (r.fallback) fallback++; ms += r.ms || 0; }
  return { n: log.length, tot, mean: tot / log.length, max, fallback, ms };
}

function runDialogButtons(extra) {
  return h('div', { class: 'row run-buttons' }, ...(extra || []), h('button', tip('runDialogOk', { class: 'primary', onclick: closeModal }), 'OK'));
}

/** Rows that describe one kind of job's result: a global analysis, bump submodels or the verification suite. */
function runResultRows(msg, res, snap) {
  const rows = [];
  if (msg.type === 'run' && res && res.meshInfo) {
    const mi = res.meshInfo, pcg = pcgSummary(res.solverLog), nw = res.workers || 1;
    rows.push(['Mesh', mi.nDof.toLocaleString() + ' DOF, ' + mi.nElem.toLocaleString() + ' elements (' + (res.preset || msg.preset) + ')']);
    rows.push(['Parallel workers', String(nw)]);
    if (pcg) {
      rows.push(['Thermal path', pcg.n + ' linear solves' + (msg.evaluations === 'preview' ? ' (process chain to 25 °C)' : '')]);
      rows.push(['PCG iterations', pcg.tot.toLocaleString() + ' in total; ' + fmt(pcg.mean, 0) + ' per solve on average, ' + pcg.max + ' at most']);
      rows.push(['Solver time', fmtDur(pcg.ms) + (nw > 1 ? ' summed over the ' + nw + ' workers (the wall time of the thermal path is in the steps below)' : '')]);
      if (pcg.fallback) rows.push(['Preconditioner', pcg.fallback + ' solve' + (pcg.fallback === 1 ? '' : 's') + ' needed the fallback preconditioner']);
    }
    if (res.screening && res.screening.length) rows.push(['Bump screening', res.screening.reduce((n, s) => n + s.nSites, 0).toLocaleString() + ' sites in ' + fmt(res.screening.reduce((m, s) => m + (s.ms || 0), 0) / 1000, 1) + ' s']);
    if (res.at25 && res.at25.warpage) rows.push(['RT signed warpage', um(res.at25.warpage.signed) + ' µm at 25 °C (moderate confidence)']);
  } else if (msg.type === 'submodels' && Array.isArray(res)) {
    rows.push(['Bump submodels', res.length + ' sites, ' + msg.nxy + ' × ' + msg.nxy + ' × ' + msg.nz + ' voxels each']);
    const steps = res.reduce((n, s) => n + (s.steps || 0), 0), cut = res.reduce((n, s) => n + (s.cutbacks || 0), 0);
    rows.push(['Adaptive steps', steps.toLocaleString() + ' in total, ' + cut + ' cutback' + (cut === 1 ? '' : 's')]);
    const worst = res.reduce((m, s) => (s.dW > (m ? m.dW : -Infinity) ? s : m), null);
    if (worst) rows.push(['Largest ΔW per cycle', fmtE(worst.dW, 3) + ' MPa (' + worst.die + ' bump at ' + fmt(worst.site.x, 2) + ', ' + fmt(worst.site.y, 2) + ' mm; comparative only)']);
    const unstable = res.filter(s => s.stabWarn).length;
    if (unstable) rows.push(['Stabilization', unstable + ' of ' + res.length + ' sites changed by more than 5 % between the last two cycles; run more cycles']);
  } else if (msg.type === 'verify' && Array.isArray(res)) {
    const fails = res.filter(r => !r.pass);
    rows.push(['Tests', res.length + ' run, ' + (res.length - fails.length) + ' passed' + (fails.length ? ', ' + fails.length + ' failed (' + fails.map(r => r.id).join(', ') + ')' : '')]);
  }
  if (snap && snap.dof && !rows.some(r => r[0] === 'Mesh')) rows.unshift(['Mesh', snap.dof.toLocaleString() + ' DOF']);
  return rows;
}

/** Dialog for a job that finished: what ran, how long it took and its key figures. */
function runFinishedDialog(label, msg, res, snap) {
  const failedTests = msg.type === 'verify' && Array.isArray(res) ? res.filter(r => !r.pass).length : 0;
  const unconverged = msg.type === 'run' && res && res.solverLog ? res.solverLog.filter(r => r.converged === false).length : 0;
  const warn = failedTests > 0 || unconverged > 0;
  const rows = [['Total time', fmtDur(snap ? snap.elapsed : 0) + ' (min:s)'], snap && snap.preset ? ['Settings', snap.preset] : null, ...runResultRows(msg, res, snap)];
  if (unconverged) rows.push(['Warning', unconverged + ' linear solve' + (unconverged === 1 ? '' : 's') + ' did not reach the residual tolerance; treat the results with care']);
  const body = h('div', { class: 'run-dialog' },
    h('div', { class: 'run-banner ' + (warn ? 'warn' : 'ok') }, warn ? '⚠ Finished with warnings' : '✓ Finished successfully'),
    runStatsTable(rows), runStepsTable(snap, true), runDialogButtons());
  showModal(label + (warn ? ' finished with warnings' : ' finished'), body);
}

/** What the user keeps after a failed, crashed or cancelled job. */
function runKeptText(msg, kind) {
  if (!app.results) return 'No results were in memory before this job.';
  if (app.analysisLost === 'stopped') return 'Results already shown are kept, but the analysis behind them was in the compute process that stopped; use Restore analysis above the results to view other temperatures or run submodels.';
  if (app.analysisLost === true) return 'Results already shown are kept; restarting the worker discarded the analysis behind them, so use Restore analysis above the results to view other temperatures or run submodels.';
  return msg.type === 'run' ? 'The results of the previous run are kept unchanged.' : 'The results in memory are kept unchanged.';
}

/** Suggestions for the next try, by kind of failure. */
function runAdvice(kind, err) {
  if (kind === 'cancelled') return [];
  if (kind === 'crashed') return [
    'The most common cause is running out of memory. Check the memory estimate in the run panel (step 6) against the computer\'s memory.',
    'Fewer parallel workers need less memory (each helper holds its own copy of the stiffness model); a coarser mesh preset needs much less.',
    'Close other memory-heavy programs and run again.',
  ];
  const m = (err && err.message) || '';
  const tips = [];
  if (/converg|PCG|residual/i.test(m)) tips.push('A linear solve did not converge. Check the inputs for extreme stiffness contrasts (for example a near-zero modulus) or very thin layers, then run again.');
  if (/memory|allocation|Array buffer/i.test(m)) tips.push('The job ran out of memory; use fewer parallel workers or a coarser mesh preset.');
  tips.push('Check the input messages in steps 1 to 5 and run again. If it fails the same way, save the configuration (step 1) and the details below so the failure can be reproduced.');
  return tips;
}

/** Dialog for a job that failed, crashed or was cancelled: what happened, where it stopped, what is kept and what to try. */
function runFailedDialog(label, msg, err, snap) {
  const kind = failureKind(err);
  const where = snap ? (snap.msg || '') : '';
  const rows = [
    ['What happened', kind === 'cancelled' ? 'Cancelled by you.' : kind === 'crashed' ? (err.message || 'The worker stopped unexpectedly.') : (err && err.message) || 'Unknown error.'],
    ['Stopped after', fmtDur(snap ? snap.elapsed : 0) + ' (min:s)' + (snap && snap.frac > 0 ? ', about ' + Math.round(100 * snap.frac) + ' % through' : '')],
    where ? ['Last progress message', where] : null,
    snap && snap.dof ? ['Mesh', snap.dof.toLocaleString() + ' DOF' + (snap.preset ? ' (' + snap.preset + ')' : '')] : null,
    snap && snap.solves && snap.solves.length ? ['Solves completed', snap.solves.length + ' (' + snap.solves.reduce((a, b) => a + b, 0).toLocaleString() + ' PCG iterations)'] : null,
    ['What is kept', runKeptText(msg, kind)],
  ];
  const advice = runAdvice(kind, err);
  const details = [];
  if (snap && snap.log && snap.log.length) details.push(h('div', null, h('b', null, 'Last log lines'), h('pre', { class: 'run-log' }, snap.log.join('\n'))));
  if (err && err.stack && kind !== 'cancelled') details.push(h('div', null, h('b', null, 'Error details'), h('pre', { class: 'run-log' }, String(err.stack))));
  const body = h('div', { class: 'run-dialog' },
    h('div', { class: 'run-banner ' + (kind === 'cancelled' ? 'warn' : 'bad') }, kind === 'cancelled' ? '■ Cancelled' : kind === 'crashed' ? '✕ Crashed' : '✕ Failed'),
    runStatsTable(rows), runStepsTable(snap),
    advice.length ? h('div', null, h('h4', null, 'What to try'), h('ul', null, ...advice.map(a => h('li', null, a)))) : null,
    details.length ? h('details', null, h('summary', null, 'Details for troubleshooting'), ...details) : null,
    runDialogButtons((app.analysisLost === true || app.analysisLost === 'stopped') && app.results && app.results.request ? [h('button', tip('restoreAnalysis', { onclick: () => { closeModal(); restoreAnalysis(); } }), 'Restore analysis')] : null));
  showModal(label + ' ' + RUN_FAIL_TITLE[kind], body);
}

/** Dialog at the end of a sensitivity run: cases run and failed, time; a failure dialog when the base case is missing. */
function sensitivityDialog(nCases, nFailed, ms, ok, snap, firstErr) {
  if (!ok) { runFailedDialog('Sensitivity', { type: 'sensitivity' }, firstErr || new Error('The base case did not finish, so no sensitivities could be computed.'), snap); return; }
  const warn = nFailed > 0;
  const body = h('div', { class: 'run-dialog' },
    h('div', { class: 'run-banner ' + (warn ? 'warn' : 'ok') }, warn ? '⚠ Finished with failed cases' : '✓ Finished successfully'),
    runStatsTable([['Total time', fmtDur(ms) + ' (min:s)'], snap && snap.preset ? ['Settings', snap.preset] : null, ['Cases', nCases + ' run (the base case and two per input)' + (warn ? ', ' + nFailed + ' failed; their inputs are left out of the charts' : '')], firstErr ? ['First failure', firstErr.message] : null]),
    runDialogButtons());
  showModal('Sensitivity' + (warn ? ' finished with failed cases' : ' finished'), body);
}
