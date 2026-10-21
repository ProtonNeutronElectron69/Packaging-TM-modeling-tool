'use strict';
// ===== Desktop app: compute process =========================================================
// One of these Node processes stands in for each Web Worker of the browser version. It runs the
// page's own physics core and worker driver (the text of its "core" and "worker-driver" blocks, sent
// by the main process as the first message), so the desktop app and the browser always run the same
// code. Being a separate operating-system process, it is not bound by the browser's per-tab memory
// limit. The process's main thread only relays messages: the driver runs in a worker thread, and its
// nested helpers (parallel temperature sweep and submodels) are worker threads of the driver. Live
// solver reports travel on message ports straight to the relay, so the page hears from every thread
// even while the driver is busy with a solve of its own. Every thread runs this same file.

const vm = require('vm');
const { Worker, MessageChannel, isMainThread, parentPort, workerData } = require('worker_threads');

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

/** Give the driver the worker globals it expects (self, postMessage, onmessage) on top of the thread's port, then run it. */
function boot(src) {
  globalThis.self = globalThis;
  globalThis.postMessage = msg => parentPort.postMessage(msg);
  globalThis.__spawnHelper = () => new HelperThread(src);
  // a port for one helper's live reports: one end goes to the relay on the process's main thread, the other to the helper
  globalThis.__livePort = () => {
    const { port1, port2 } = new MessageChannel();
    parentPort.postMessage({ __livePort: port1 }, [port1]);
    return port2;
  };
  parentPort.on('message', data => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data }); });
  vm.runInThisContext(src, { filename: 'fcbga-core.js' });
}

if (!isMainThread) {
  boot(workerData.src);
} else {
  // child process of the Electron main process: the first message carries the code and starts the driver thread
  let driver = null;
  const relay = m => { try { process.send(m); } catch (e) { /* the app closed this process */ } };
  process.on('message', msg => {
    if (driver) { driver.postMessage(msg); return; }
    if (!msg || typeof msg.__fcbgaLoad !== 'string') return;
    driver = new Worker(__filename, { workerData: { src: msg.__fcbgaLoad } });
    driver.on('message', m => {
      if (m && m.__livePort) { m.__livePort.on('message', relay); m.__livePort.unref(); return; }
      relay(m);
    });
    driver.on('error', e => { process.stderr.write('compute driver error: ' + (e && e.stack || e) + '\n'); process.exit(1); });
    driver.on('exit', code => process.exit(code || 1));  // the driver only stops when it fails (most often memory running out)
  });
  process.on('disconnect', () => process.exit(0));  // the app closed or restarted this worker
}
