import fs from 'node:fs';

let cached: string | undefined;

/** The app version from the root package.json (APP_VERSION in the Docker image, where that file isn't copied). */
export function appVersion(): string {
  if (cached === undefined) {
    let version = process.env.APP_VERSION ?? '';
    try {
      version = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version ?? version;
    } catch {
      /* optional */
    }
    cached = version;
  }
  return cached;
}
