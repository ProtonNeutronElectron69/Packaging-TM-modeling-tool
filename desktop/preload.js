'use strict';
// ===== Desktop app: the page's end of the compute channel ==================================
// Runs before the page, isolated from it, and exposes window.fcbgaDesktop: start a compute process
// (the desktop stand-in for a Web Worker), post messages to it, stop it, and read the computer's
// memory and core count; also the File menu's results commands and a results file the program was started
// with. The page's WorkerClient uses it through DesktopWorker (src/ui/00-app.js); the results file through
// src/ui/04d-resultsfile.js.

const { contextBridge, ipcRenderer } = require('electron');

let nextId = 1;
const handlers = new Map();  // worker id -> { onMessage, onExit }

ipcRenderer.on('fcbga:message', (ev, id, msg) => { const h = handlers.get(id); if (h) h.onMessage(msg); });
ipcRenderer.on('fcbga:exit', (ev, id, info) => { const h = handlers.get(id); if (h) { handlers.delete(id); h.onExit(info); } });

contextBridge.exposeInMainWorld('fcbgaDesktop', {
  threeUrl: 'three.min.js',  // bundled next to the page, so the 3D view works offline
  /** Start a compute process; onMessage(msg) receives its messages, onExit({code, signal}) an unexpected stop. */
  spawn(onMessage, onExit) {
    const id = nextId++;
    handlers.set(id, { onMessage, onExit });
    ipcRenderer.send('fcbga:spawn', id);
    return {
      post: msg => ipcRenderer.send('fcbga:post', id, msg),
      terminate: () => { handlers.delete(id); ipcRenderer.send('fcbga:terminate', id); },
    };
  },
  system: () => ipcRenderer.invoke('fcbga:system'),
  /** File menu commands for the page ('open-results', 'save-results'). */
  onMenu(cb) { ipcRenderer.on('fcbga:menu', (ev, cmd) => cb(cmd)); },
  /** The results file the program was started with: {name, size} or null; read it in blocks, then close it. */
  openedFile: () => ipcRenderer.invoke('fcbga:opened-file'),
  readOpenedFile: (offset, length) => ipcRenderer.invoke('fcbga:opened-file-read', offset, length),
  closeOpenedFile: () => ipcRenderer.invoke('fcbga:opened-file-close'),
});
