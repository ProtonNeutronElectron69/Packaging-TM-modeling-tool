'use strict';
// ===== Desktop app: compute process =========================================================
// One of these Node processes stands in for each Web Worker of the browser version. It runs the
// page's own physics core and worker driver (the text of its "core" and "worker-driver" blocks, sent
// by the main process as the first message), so the desktop app and the browser always run the same
// code. Being a separate operating-system process, it is not bound by the browser's per-tab memory
// limit. The driver's nested helpers (parallel temperature sweep and submodels) become worker
// threads of this process; each thread runs this same file with the code in workerData.

const vm = require('vm');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

/** A worker thread with the part of the Web Worker interface the driver uses (onmessage, onerror, postMessage, terminate). */
class HelperThread {
  constructor(src) {
    this.onmessage = null; this.onerror = null; this.ended = false;
    this.thread = new Worker(__filename, { workerData: { src } });
    this.thread.on('message', data => { if (this.onmessage) this.onmessage({ data }); });
    this.thread.on('error', e => { if (this.onerror) this.onerror({ message: e.message }); });
    this.thread.on('exit', code => { if (code !== 0 && !this.ended && this.onerror) this.onerror({ message: 'A helper thread stopped (exit code ' + code + '); the computer may have run out of memory.' }); });
  }
  postMessage(msg, transfer) { this.thread.postMessage(msg, transfer || []); }
  terminate() { this.ended = true; this.thread.terminate(); }
}

/** Give the driver the worker globals it expects (self, postMessage, onmessage) on top of a message channel, then run it. */
function boot(src, send, listen) {
  globalThis.self = globalThis;
  globalThis.postMessage = msg => send(msg);
  globalThis.__spawnHelper = () => new HelperThread(src);
  listen(data => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data }); });
  vm.runInThisContext(src, { filename: 'fcbga-core.js' });
}

if (!isMainThread) {
  boot(workerData.src, msg => parentPort.postMessage(msg), fn => parentPort.on('message', fn));
} else {
  // child process of the Electron main process: the first message carries the code, every later one goes to the driver
  let deliver = null;
  process.on('message', msg => {
    if (deliver) { deliver(msg); return; }
    if (msg && typeof msg.__fcbgaLoad === 'string') boot(msg.__fcbgaLoad, m => process.send(m), fn => { deliver = fn; });
  });
  process.on('disconnect', () => process.exit(0));  // the app closed or restarted this worker
}
