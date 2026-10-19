// Stage the desktop app's page: copy the built single-file page (dist/, rebuilt from src/ by
// node tools/build.mjs) and three.js (for the offline 3D view) into app/, which the app loads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(here, '..', 'dist', 'fcbga_thermomech_tool.html');
const appDir = path.join(here, 'app');
if (!fs.existsSync(page)) { console.error('Missing ' + page + '; run node tools/build.mjs in the repository root first.'); process.exit(1); }
const threeDir = path.dirname(createRequire(import.meta.url).resolve('three/package.json'));
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
fs.copyFileSync(page, path.join(appDir, 'index.html'));
fs.copyFileSync(path.join(threeDir, 'build', 'three.min.js'), path.join(appDir, 'three.min.js'));
fs.copyFileSync(path.join(threeDir, 'LICENSE'), path.join(appDir, 'three-LICENSE.txt'));
console.log('staged', path.relative(process.cwd(), appDir), '(page', (fs.statSync(page).size / 1024).toFixed(0), 'kB, three.js r128)');
