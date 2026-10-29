'use strict';
// ===== Desktop app: compute process =========================================================
// One of these Node processes stands in for each Web Worker of the browser version. It runs the
// page's own physics core and worker driver (the text of its "core" and "worker-driver" blocks, sent
// by the parent as the first message), so the desktop app and the browser always run the same code.
// Being a separate operating-system process, it is not bound by the browser's per-tab memory limit.
// The process's main thread only relays messages: the driver runs in a worker thread, so the relay
// answers even while the driver is busy with a solve.
//
// The driver's nested helpers (parallel thermal-path steps and submodels) are compute processes of
// their own, started by this relay, not threads of this process: Electron's V8 keeps the JavaScript
// heaps of all threads of a process in one shared cage of about 4 GB (only about 2.4 GB usable with
// eight threads), and exceeding it aborts the whole process however much memory the computer has
// left. Typed arrays live outside the cage; plain arrays and objects do not. A helper process
// reports live solver state through its own relay, so the page hears from every helper while the
// driver is busy.
//
// When a driver thread fails, its relay passes the cause to the parent ({__fatal}) before exiting, and
// each parent keeps the tail of its children's error output (V8 prints fatal errors there), so the
// page can say why a compute process stopped.

const vm = require('vm');
const { fork } = require('child_process');
const { Worker, MessageChannel, isMainThread, parentPort, workerData } = require('worker_threads');

const ERR_TAIL = 4000;  // characters of a child's error output kept for the report

/** Keep the last ERR_TAIL characters of a child's error output (and pass it on to this process's own). */
function captureStderr(child) {
  child.errTail = '';
  if (!child.stderr) return;
  child.stderr.on('data', d => {
    const s = d.toString();
    child.errTail = (child.errTail + s).slice(-ERR_TAIL);
    try { process.stderr.write(s); } catch (e) { /* nowhere to write */ }
  });
}

/** Why a child stopped: the cause it sent, else the last lines of its error output. */
function exitReason(child) {
  if (child.fatal) return child.fatal;
  const lines = (child.errTail || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const fatal = lines.find(l => /FATAL ERROR|out of memory|Allocation failed/i.test(l));
  return fatal || lines.slice(-3).join(' | ');
}

// ---- driver thread: the page's core and worker driver --------------------------------------------

/** A helper compute process as seen by the driver: the part of the Web Worker interface it uses (onmessage, onerror, postMessage, terminate). */
const helpers = new Map();  // helper id -> HelperProcess
let nextHelper = 1;
class HelperProcess {
  constructor() {
    this.id = nextHelper++; this.onmessage = null; this.onerror = null;
    helpers.set(this.id, this);
    parentPort.postMessage({ __helper: 'spawn', hid: this.id });
  }
  // transfer lists do not cross processes: the message is copied
  postMessage(msg) { parentPort.postMessage({ __helper: 'post', hid: this.id, msg }); }
  terminate() { if (helpers.delete(this.id)) parentPort.postMessage({ __helper: 'kill', hid: this.id }); }
}

/** Give the driver the worker globals it expects (self, postMessage, onmessage) on top of the thread's port, then run it. */
function boot(src) {
  globalThis.self = globalThis;
  globalThis.postMessage = msg => parentPort.postMessage(msg);
  globalThis.__spawnHelper = () => new HelperProcess();
  parentPort.on('message', data => {
    if (data && data.__fromHelper) {
      const h = helpers.get(data.__fromHelper);
      if (!h) return;
      if (data.exit) {
        helpers.delete(h.id);
        const x = data.exit;
        if (h.onerror) h.onerror({ message: 'A helper compute process stopped (' + (x.signal ? 'signal ' + x.signal : 'exit code ' + x.code) + ')' + (x.reason ? ': ' + x.reason : '; the computer may have run out of memory') + '.' });
      } else if (h.onmessage) h.onmessage({ data: data.data });
      return;
    }
    if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data });
  });
  vm.runInThisContext(src, { filename: 'fcbga-core.js' });
}

if (!isMainThread) {
  boot(workerData.src);
} else {
  // ---- main thread: relay between the parent (app or parent compute process), the driver and the helper processes ----
  let driver = null, src = null, ending = false;
  const kids = new Map();  // helper id -> child process
  const toParent = m => { try { process.send(m); } catch (e) { /* the parent closed this process */ } };
  const killKids = () => { for (const c of kids.values()) { c.stopping = true; try { c.kill(); } catch (e) { /* already gone */ } } kids.clear(); };

  /** Stop this process after telling the parent why (the message is flushed first, with a short limit). */
  function fail(text) {
    if (ending) return;
    ending = true;
    try { process.stderr.write('compute driver error: ' + text + '\n'); } catch (e) { /* nowhere to write */ }
    killKids();
    const end = () => process.exit(1);
    try { process.send({ __fatal: text }, end); } catch (e) { end(); }
    setTimeout(end, 1000);
  }

  function startHelper(hid) {
    const child = fork(__filename, [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    kids.set(hid, child);
    captureStderr(child);
    child.send({ __fcbgaLoad: src });
    child.on('message', m => {
      if (m && m.__fatal) { child.fatal = m.__fatal; return; }
      if (m && m.type === 'live') { toParent(m); return; }  // straight on, so it arrives while the driver is busy
      if (driver) driver.postMessage({ __fromHelper: hid, data: m });
    });
    child.on('error', () => { /* reported through 'exit' */ });
    child.on('exit', (code, signal) => {
      if (kids.get(hid) === child) kids.delete(hid);
      if (!child.stopping && driver) driver.postMessage({ __fromHelper: hid, exit: { code, signal, reason: exitReason(child) } });
    });
  }

  function helperOp(m) {
    if (m.__helper === 'spawn') startHelper(m.hid);
    else if (m.__helper === 'post') { const c = kids.get(m.hid); if (c && c.connected) c.send(m.msg, () => { /* a send to a process that just exited is reported by its 'exit' */ }); }
    else if (m.__helper === 'kill') { const c = kids.get(m.hid); if (c) { kids.delete(m.hid); c.stopping = true; c.kill(); } }
  }

  process.on('message', msg => {
    if (driver) {
      if (msg && msg.type === 'init' && msg.w) {
        // this process is a helper: its live reports go out on a port of its own, read here and passed to the parent
        const { port1, port2 } = new MessageChannel();
        port1.on('message', toParent); port1.unref();
        msg.live = port2;
        driver.postMessage(msg, [port2]);
      } else driver.postMessage(msg);
      return;
    }
    if (!msg || typeof msg.__fcbgaLoad !== 'string') return;
    src = msg.__fcbgaLoad;
    driver = new Worker(__filename, { workerData: { src } });
    driver.on('message', m => { if (m && m.__helper) helperOp(m); else toParent(m); });
    driver.on('error', e => fail((e && (e.code ? e.code + ': ' : '') + (e.stack || e.message)) || String(e)));
    driver.on('exit', code => fail('the compute driver stopped (exit code ' + code + ')'));  // it only stops when it fails
  });
  // the app (or the parent compute process) closed or restarted this one: its helpers go with it
  process.on('disconnect', () => { killKids(); process.exit(0); });
  process.on('exit', killKids);
}
