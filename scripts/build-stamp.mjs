// Keeps the built app (web/dist, server/dist) in step with the code. The app runs from that
// built copy, so after `git pull` without `npm run build` it would keep running the old one.
//   node scripts/build-stamp.mjs write   after a build: stamps both with the version and commit
//   node scripts/build-stamp.mjs check   before starting: builds again if a stamp doesn't match
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamps = [path.join(root, 'web', 'dist', 'build.json'), path.join(root, 'server', 'dist', 'build.json')];

function current() {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    /* not a git checkout (e.g. a copied folder): the version alone decides */
  }
  return { version, commit };
}

const now = current();
if (process.argv[2] === 'write') {
  for (const f of stamps) if (fs.existsSync(path.dirname(f))) fs.writeFileSync(f, JSON.stringify(now) + '\n');
  process.exit(0);
}

const stale = stamps.some((f) => {
  try {
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    return s.version !== now.version || (now.commit && s.commit !== now.commit);
  } catch {
    return true;
  }
});
if (!stale) process.exit(0);
console.log(`Compilando la versión ${now.version} (la compilada era otra)…`);
const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
