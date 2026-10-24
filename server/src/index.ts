import fs from 'node:fs';
import { config } from './config.js';
import { initProfiles } from './lib/profiles.js';
import { buildApp } from './app.js';
import { startScheduler } from './lib/scheduler.js';

initProfiles();
const app = await buildApp({ logger: true, serveWeb: true });
await app.listen({ port: config.port, host: config.host });
// Root package.json carries the app version (absent in the Docker image, where the footer still shows it).
let version = '';
try {
  version = ` v${JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version}`;
} catch {
  /* optional */
}
console.log(`Finanzas${version} lista en http://localhost:${config.port} (datos en ${config.dataDir})`);
startScheduler();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
