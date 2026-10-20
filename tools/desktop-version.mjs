// Chooses the version of the next desktop app release and writes it into desktop/package.json
// (the version shown in the app and in the file names). Used by the Windows build workflow.
//   RELEASE_TAG=desktop-v1.2.0 node tools/desktop-version.mjs   explicit tag (manual run)
//   node tools/desktop-version.mjs                                automatic: one patch step past the latest
//                                                                 desktop-v* tag, or the package.json version
//                                                                 when that is higher (a deliberate bump)
// Prints tag=... and version=... (to $GITHUB_OUTPUT in a workflow).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'desktop', 'package.json');
const parse = v => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); return m ? m.slice(1).map(Number) : null; };
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current = parse(pkg.version);
if (!current) throw new Error('desktop/package.json version "' + pkg.version + '" is not of the form X.Y.Z');

let next;
const explicit = (process.env.RELEASE_TAG || '').trim();
if (explicit) {
  next = parse(explicit.replace(/^desktop-v/, ''));
  if (!next || !explicit.startsWith('desktop-v')) throw new Error('release tag "' + explicit + '" is not of the form desktop-vX.Y.Z');
} else {
  const tags = execFileSync('git', ['tag', '-l', 'desktop-v*'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/)
    .map(t => parse(t.replace(/^desktop-v/, ''))).filter(Boolean).sort(cmp);
  const latest = tags[tags.length - 1];
  next = !latest || cmp(current, latest) > 0 ? current : [latest[0], latest[1], latest[2] + 1];
}

const version = next.join('.');
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
const out = 'tag=desktop-v' + version + '\nversion=' + version + '\n';
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, out);
process.stdout.write(out);
