import { config } from './config.js';
import { openDb, setDb } from './db/index.js';
import { buildApp } from './app.js';
import { startScheduler } from './lib/scheduler.js';

setDb(openDb(config.dbPath));
const app = await buildApp({ logger: true, serveWeb: true });
await app.listen({ port: config.port, host: config.host });
startScheduler();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
