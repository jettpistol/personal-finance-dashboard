import { config } from './config.js';
import { initProfiles } from './lib/profiles.js';
import { buildApp } from './app.js';
import { startScheduler } from './lib/scheduler.js';
import { appVersion } from './lib/version.js';

initProfiles();
const app = await buildApp({ logger: true, serveWeb: true });
try {
  await app.listen({ port: config.port, host: config.host });
} catch (e) {
  // Usually an older copy still running: say so instead of a stack trace.
  if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`El puerto ${config.port} ya está en uso: probablemente otra copia de Finanzas sigue abierta. Cerrala (Ctrl+C en esa terminal, o \`lsof -i :${config.port}\` para encontrarla) y volvé a intentar.`);
    process.exit(1);
  }
  throw e;
}
const version = appVersion() ? ` v${appVersion()}` : '';
console.log(`Finanzas${version} lista en http://localhost:${config.port} (datos en ${config.dataDir})`);
startScheduler();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
