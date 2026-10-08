// Build the single-file application: dist/fcbga_thermomech_tool.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const listJs = dir => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js')).sort().map(f => read(path.join(dir, f)));

const db = JSON.parse(read('src/materials-db.json'));
const core = listJs('src/core').join('\n');
const worker = read('src/worker.js');
const ui = listJs('src/ui').join('\n');
const css = read('src/style.css');
let html = read('src/template.html');

// never allow a closing script tag inside inline blocks
const safe = s => s.replace(/<\/script/gi, '<\\/script');
html = html.replace('/*__CSS__*/', () => css);
html = html.replace('/*__MATERIALS_JSON__*/', () => safe(JSON.stringify(db)));
html = html.replace('/*__CORE__*/', () => safe(core));
html = html.replace('/*__WORKER__*/', () => safe(worker));
html = html.replace('/*__UI__*/', () => safe(ui));
html = html.replace('/*__BUILD_DATE__*/', () => new Date().toISOString().slice(0, 10));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'fcbga_thermomech_tool.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0), 'kB');
