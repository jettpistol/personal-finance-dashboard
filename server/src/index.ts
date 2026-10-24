import { config } from './config.js';
import { initProfiles } from './lib/profiles.js';
import { buildApp } from './app.js';
import { startScheduler } from './lib/scheduler.js';

initProfiles();
const app = await buildApp({ logger: true, serveWeb: true });
await app.listen({ port: config.port, host: config.host });
console.log(`Finanzas lista en http://localhost:${config.port} (datos en ${config.dataDir})`);
startScheduler();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
