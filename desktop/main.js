'use strict';
// ===== Desktop app: Electron main process ==================================================
// Shows the built page (app/index.html, staged from dist/ by stage.mjs) in a desktop window. The
// page's Web Workers are replaced by compute processes (compute-worker.js): plain Node processes of
// their own, so heavy runs can use the computer's whole memory and every core instead of stopping at
// the browser's per-tab memory limit. This process starts and stops them on the page's request and
// relays messages both ways (preload.js is the page's end of the channel).

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeSource } = require('./core-source.js');

// The page loads only local files and needs eval for its physics core (the renderer is sandboxed and
// context-isolated, with no Node access), so Electron's development-time CSP warning does not apply.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const PAGE = path.join(__dirname, 'app', 'index.html');
const COMPUTE = path.join(__dirname, 'compute-worker.js');
const APP_ID = 'com.fcbga.thermomech-tool';
const GB = 1024 ** 3;

let computeSrc = null;  // read from the page on first use
let mainWin = null;     // the app window (the File menu's results commands go to its page)
const compute = new Map();  // `${webContents id}:${worker id}` -> child process
global.fcbgaCompute = compute;  // read by tools/desktop-smoke.mjs (process count, simulated crash)

function workerKey(wc, id) { return wc.id + ':' + id; }

const ERR_TAIL = 4000;  // characters of a compute process's error output kept for the crash report
/** Why a compute process stopped: the cause its relay sent, else the fatal line or last lines of its error output. */
function exitReason(child) {
  if (child.fatal) return child.fatal;
  const lines = child.errTail.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.find(l => /FATAL ERROR|out of memory|Allocation failed/i.test(l)) || lines.slice(-3).join(' | ');
}

/** Start compute process `id` for a page; its messages go back to that page, and so does its unexpected exit. */
function spawnCompute(wc, id) {
  if (!computeSrc) computeSrc = computeSource(PAGE);
  const child = fork(COMPUTE, [], {
    serialization: 'advanced',  // structured clone, so typed arrays cross intact
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    execArgv: [],
    stdio: ['ignore', app.isPackaged ? 'ignore' : 'inherit', 'pipe', 'ipc'],
    windowsHide: true,
  });
  const key = workerKey(wc, id);
  compute.set(key, child);
  // the tail of its error output (V8 prints fatal errors there) and the cause it reports, for the page's crash report
  child.errTail = '';
  child.stderr.on('data', d => { const s = d.toString(); child.errTail = (child.errTail + s).slice(-ERR_TAIL); if (!app.isPackaged) process.stderr.write(s); });
  child.send({ __fcbgaLoad: computeSrc });
  child.on('message', msg => {
    if (msg && msg.__fatal) { child.fatal = msg.__fatal; return; }
    if (!wc.isDestroyed()) wc.send('fcbga:message', id, msg);
  });
  child.on('error', () => { /* reported through 'exit' */ });
  child.on('exit', (code, signal) => {
    if (compute.get(key) === child) compute.delete(key);
    if (!child.stopping && !wc.isDestroyed()) wc.send('fcbga:exit', id, { code, signal, reason: exitReason(child) });
  });
}

function stopCompute(key) {
  const child = compute.get(key);
  if (!child) return;
  compute.delete(key);
  child.stopping = true;
  child.kill();
}

/** Stop every compute process of a page (closed, reloaded or crashed). */
function stopAllFor(wc) {
  const prefix = wc.id + ':';
  for (const key of Array.from(compute.keys())) if (key.startsWith(prefix)) stopCompute(key);
}

ipcMain.on('fcbga:spawn', (ev, id) => { stopCompute(workerKey(ev.sender, id)); spawnCompute(ev.sender, id); });
ipcMain.on('fcbga:post', (ev, id, msg) => {
  const child = compute.get(workerKey(ev.sender, id));
  if (child && child.connected) child.send(msg, () => { /* a send to a process that just exited is reported by its 'exit' */ });
});
ipcMain.on('fcbga:terminate', (ev, id) => stopCompute(workerKey(ev.sender, id)));
ipcMain.handle('fcbga:system', () => ({
  totalMemGB: os.totalmem() / GB, freeMemGB: os.freemem() / GB, cpus: os.cpus().length, cpuModel: (os.cpus()[0] || {}).model || '',
  app: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
}));

// A results file (.fcbgares) named on the command line (Windows "Open with", or a file dropped on the program file):
// the page asks for it once loaded and reads it in blocks, since one message to the page is limited in size. Only
// this file can be read this way.
const RESULTS_EXT = /\.fcbgares$/i;
let openedFile = (() => { const f = process.argv.slice(1).find(a => RESULTS_EXT.test(a) && fs.existsSync(a)); return f ? path.resolve(f) : null; })();
ipcMain.handle('fcbga:opened-file', () => {
  if (!openedFile) return null;
  try { return { name: path.basename(openedFile), size: fs.statSync(openedFile).size }; } catch (e) { openedFile = null; return null; }
});
ipcMain.handle('fcbga:opened-file-read', (ev, offset, length) => {
  if (!openedFile) throw new Error('no results file to read');
  const fd = fs.openSync(openedFile, 'r');
  try { const b = Buffer.alloc(length); const n = fs.readSync(fd, b, 0, length, offset); return b.subarray(0, n); } finally { fs.closeSync(fd); }
});
ipcMain.handle('fcbga:opened-file-close', () => { openedFile = null; });

function isWeb(url) { return /^https?:/i.test(url); }

function createWindow() {
  const win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1100, minHeight: 700, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  const wc = win.webContents;
  win.once('ready-to-show', () => win.show());
  // web links (material sources, references) open in the system browser; the printable report opens as an app window
  wc.setWindowOpenHandler(({ url }) => {
    if (isWeb(url)) { shell.openExternal(url); return { action: 'deny' }; }
    if (url === '' || url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 900 } };
    return { action: 'deny' };
  });
  wc.on('will-navigate', (ev, url) => { ev.preventDefault(); if (isWeb(url)) shell.openExternal(url); });
  wc.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) stopAllFor(wc); });  // reload
  wc.on('render-process-gone', () => stopAllFor(wc));
  wc.on('destroyed', () => stopAllFor(wc));
  win.loadFile(PAGE);
  return win;
}

/** Print or save as PDF the focused window (the app, or the report opened from Results > Report). */
function focused() { return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; }
async function saveAsPdf() {
  const win = focused(); if (!win) return;
  const name = (win.webContents.getTitle() || 'FCBGA report').replace(/[^\w.-]+/g, '_') + '.pdf';
  const r = await dialog.showSaveDialog(win, { title: 'Save as PDF', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return;
  try { fs.writeFileSync(r.filePath, await win.webContents.printToPDF({ printBackground: true })); }
  catch (e) { dialog.showErrorBox('Save as PDF', 'The PDF could not be saved: ' + e.message); }
}
function about() {
  const win = focused();
  dialog.showMessageBox(win, {
    type: 'info', title: 'About', message: 'FCBGA Thermomechanical Screening Tool ' + app.getVersion(),
    detail: 'Screening tool. Results are approximate and intended for design comparison and trend studies, not sign-off.\n\nThe analysis runs in separate compute processes on this computer, limited only by its memory and cores (' + os.cpus().length + ' logical cores, ' + (os.totalmem() / GB).toFixed(1) + ' GB memory).\n\nElectron ' + process.versions.electron + ', Chromium ' + process.versions.chrome + ', Node ' + process.versions.node,
  });
}

/** A File menu command for the page (open or save a results file). */
function pageCommand(cmd) {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.focus();
  mainWin.webContents.send('fcbga:menu', cmd);
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open results…', accelerator: 'CmdOrCtrl+O', click: () => pageCommand('open-results') },
      { label: 'Save results…', accelerator: 'CmdOrCtrl+S', click: () => pageCommand('save-results') },
      { type: 'separator' },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => { const w = focused(); if (w) w.webContents.print({}); } },
      { label: 'Save as PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: saveAsPdf },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'reload', label: 'Reload (discards the results in memory)' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'About', click: about }] },
  ]));
}

app.setAppUserModelId(APP_ID);
app.whenReady().then(() => {
  buildMenu();
  // downloads (configuration JSON, CSV exports, results files) ask where to save, starting in Documents
  require('electron').session.defaultSession.on('will-download', (ev, item) => {
    const name = item.getFilename(), opts = { defaultPath: path.join(app.getPath('documents'), name) };
    if (RESULTS_EXT.test(name)) opts.filters = [{ name: 'FCBGA results file', extensions: ['fcbgares'] }];
    item.setSaveDialogOptions(opts);
  });
  mainWin = createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { for (const key of Array.from(compute.keys())) stopCompute(key); });
