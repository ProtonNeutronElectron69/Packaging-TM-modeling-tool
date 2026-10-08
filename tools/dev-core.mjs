// Development helper: load src/core/*.js (concatenated, as in the HTML core block)
// and expose a scope accessor for ad-hoc tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function coreSource() {
  const dir = path.join(root, 'src', 'core');
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}
export function loadDb() { return JSON.parse(fs.readFileSync(path.join(root, 'src', 'materials-db.json'), 'utf8')); }
export function loadCore() {
  const get = new Function(coreSource() + '\nreturn (name) => eval(name);')();
  return get;
}
