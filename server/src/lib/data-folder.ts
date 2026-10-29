import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Which folder holds the household's data. There is one: <server>/data, for `npm start` and the
// demo commands alike (the demo is only the "Prueba (demo)" profile inside it). Up to 0.16.1 the
// demo commands used <server>/data-demo instead, so a household that lived there would have
// found an empty app after `npm start`. The first start brings that folder over as a copy;
// nothing is ever deleted: a folder that's set aside is renamed, and data-demo stays as it was.
// No config import here: config.ts calls this before anything else is set up.

/** How many logins a data folder holds (0 if it has none or can't be read). */
export function loginCount(dir: string): number {
  let n = 0;
  for (const file of ['core.sqlite', 'finanzas.sqlite']) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    try {
      const d = new Database(p, { readonly: true, fileMustExist: true });
      try {
        n = Math.max(n, (d.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n);
      } finally {
        d.close();
      }
    } catch {
      /* no users table in this file */
    }
  }
  return n;
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

/**
 * Copies a whole data folder. Databases go through SQLite's own copy (VACUUM INTO), which
 * includes what's still in their -wal files; everything else (secret.key, receipts, pictures,
 * backups) is copied as is.
 */
export function copyDataFolder(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'profiles') {
        fs.mkdirSync(dst, { recursive: true });
        for (const f of fs.readdirSync(src)) {
          if (f.endsWith('.sqlite')) vacuumInto(path.join(src, f), path.join(dst, f));
          else if (!/\.sqlite-(wal|shm)$/.test(f)) fs.cpSync(path.join(src, f), path.join(dst, f), { recursive: true });
        }
      } else fs.cpSync(src, dst, { recursive: true });
    } else if (entry.name.endsWith('.sqlite')) vacuumInto(src, dst);
    else if (!/\.sqlite-(wal|shm)$/.test(entry.name)) fs.cpSync(src, dst);
  }
  // The key that opens the Mercado Pago tokens stays readable only by the app.
  const key = path.join(to, 'secret.key');
  if (fs.existsSync(key)) fs.chmodSync(key, 0o600);
}

function vacuumInto(src: string, dst: string) {
  const d = new Database(src, { fileMustExist: true });
  try {
    d.prepare('VACUUM INTO ?').run(dst);
  } finally {
    d.close();
  }
}

/** Moves a folder out of the way under a dated name. Returns the new path. */
export function setAside(dir: string, label: string): string {
  const target = `${dir}-${label}-${stamp()}`;
  fs.renameSync(dir, target);
  return target;
}

/**
 * The data folder to use when DATA_DIR isn't set: <base>/data, after bringing <base>/data-demo
 * over if that's where the logins are and data has none.
 */
export function resolveDataFolder(base: string): string {
  const data = path.join(base, 'data');
  const legacy = path.join(base, 'data-demo');
  if (!fs.existsSync(legacy)) return data;
  const here = loginCount(data);
  const there = loginCount(legacy);
  if (here === 0 && there > 0) {
    let aside: string | null = null;
    if (fs.existsSync(data) && fs.readdirSync(data).length) aside = setAside(data, 'vacia');
    copyDataFolder(legacy, data);
    fs.writeFileSync(
      path.join(legacy, 'LEEME.txt'),
      `El ${new Date().toLocaleString('es-AR')} esta carpeta se copió a ${data}, que es la que usa la app desde la versión 0.16.2.\n` +
        'Esta copia queda como respaldo: no se usa ni se borra.\n',
    );
    console.log(`Finanzas usa ahora ${data}: se copiaron ahí los datos de ${legacy} (que queda como respaldo).`);
    if (aside) console.log(`La carpeta vacía que había en ${data} quedó guardada como ${aside}.`);
  } else if (here > 0 && there > 0 && !fs.existsSync(path.join(legacy, 'LEEME.txt'))) {
    console.warn(
      `Atención: ${legacy} también tiene usuarios. La app usa ${data}. ` + 'Para usar los de data-demo en su lugar: detené la app y corré «npm run data:recover».',
    );
  }
  return data;
}
