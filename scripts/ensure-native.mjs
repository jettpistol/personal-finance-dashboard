// Makes sure the database driver (better-sqlite3) has its compiled part before the app starts.
// npm leaves it out when install scripts are turned off (ignore-scripts, common on work laptops)
// or its download failed, and then the server can't open any database. Runs before start,
// demo:reset and update; when the driver is fine it only takes a moment.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

function works() {
  try {
    const Database = require('better-sqlite3');
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

if (works()) process.exit(0);

const dir = path.dirname(require.resolve('better-sqlite3/package.json'));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args) => spawnSync(npx, args, { cwd: dir, stdio: 'inherit' });

console.log('Falta el componente compilado de la base de datos (better-sqlite3). Instalándolo…');
// The ready-made copy for this computer, from the package's own releases.
run(['--yes', 'prebuild-install']);
if (!works()) {
  console.log('No se pudo descargar. Compilándolo en esta computadora…');
  run(['--yes', 'node-gyp', 'rebuild', '--release']);
}
if (!works()) {
  console.error(
    [
      '',
      'No se pudo instalar better-sqlite3.',
      process.platform === 'darwin'
        ? 'Instalá las herramientas de desarrollo de Apple con «xcode-select --install» y volvé a intentar.'
        : 'Instalá python3, make y un compilador de C++ (por ejemplo «sudo apt install build-essential python3») y volvé a intentar.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
console.log('Listo.');
