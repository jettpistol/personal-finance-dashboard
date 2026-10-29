// npm run data:recover — makes server/data a fresh copy of server/data-demo, for an install whose
// logins were in data-demo (the demo commands' folder up to 0.16.1) when data had others too.
// The current server/data is set aside under a dated name, never deleted. Stop the app first.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { copyDataFolder, loginCount, setAside } from './lib/data-folder.js';

const base = process.cwd();
const data = path.join(base, 'data');
const legacy = path.join(base, 'data-demo');
const port = Number(process.env.PORT || 3000);

const busy = await new Promise<boolean>((resolve) => {
  const s = net.connect(port, '127.0.0.1', () => {
    s.destroy();
    resolve(true);
  });
  s.on('error', () => resolve(false));
});
if (busy) {
  console.error(`La app sigue abierta en el puerto ${port}. Cerrala (Ctrl+C en su terminal) y volvé a correr «npm run data:recover».`);
  process.exit(1);
}
if (!fs.existsSync(legacy) || loginCount(legacy) === 0) {
  console.error(`No hay usuarios en ${legacy}: no hay nada que recuperar.`);
  process.exit(1);
}
let aside: string | null = null;
if (fs.existsSync(data)) aside = setAside(data, 'anterior');
copyDataFolder(legacy, data);
fs.writeFileSync(path.join(legacy, 'LEEME.txt'), `El ${new Date().toLocaleString('es-AR')} esta carpeta se copió a ${data}. Queda como respaldo: no se usa ni se borra.\n`);
console.log(`Listo: ${data} tiene ahora los datos de ${legacy} (${loginCount(data)} usuarios).`);
if (aside) console.log(`Lo que había en ${data} quedó guardado en ${aside}.`);
