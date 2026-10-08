// Headless verification: extract the core block from the built HTML and run the suite in Node.
//   node tools/verify.mjs [V1,V2,...] [--presets draft,standard,fine]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'dist', 'fcbga_thermomech_tool.html');
if (!fs.existsSync(htmlPath)) { console.error('Build first: node tools/build.mjs'); process.exit(1); }
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script type="text\/plain" id="core">([\s\S]*?)<\/script>/);
if (!m) { console.error('core block not found'); process.exit(1); }
const core = m[1].replace(/<\\\/script/g, '</script');
const dbm = html.match(/<script type="application\/json" id="materials-db">([\s\S]*?)<\/script>/);
const db = JSON.parse(dbm[1].replace(/<\\\/script/g, '</script'));
const get = new Function(core + '\nreturn (name) => eval(name);')();
const args = process.argv.slice(2);
let ids = null, presets = ['draft', 'standard'];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--presets') presets = args[++i].split(',');
  else ids = args[i].split(',');
}
const runVerification = get('runVerification');
const t0 = Date.now();
const results = runVerification(ids, {
  db, presets,
  progress: (id, name) => console.log('... running ' + id + ' ' + name),
  onResult: r => console.log((r.pass ? 'PASS' : 'FAIL') + ' ' + r.id + ' (' + (r.ms / 1000).toFixed(1) + ' s): ' + r.measured + ' | criterion: ' + r.criterion),
});
console.log('\nSummary: ' + results.filter(r => r.pass).length + '/' + results.length + ' passed in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
fs.writeFileSync(path.join(root, 'dist', 'verification.json'), JSON.stringify(results, null, 1));
process.exit(results.every(r => r.pass) ? 0 : 1);
