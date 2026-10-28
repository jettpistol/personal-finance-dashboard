import { spawn } from 'node:child_process';

/**
 * Extracts the text of a PDF keeping its column layout, which the statement readers rely on.
 * Needs poppler-utils (`pdftotext`); the Docker image installs it.
 */
export function extractPdfText(data: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', ['-layout', '-', '-']);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'ENOENT' ? 'El servidor no tiene pdftotext (poppler-utils) instalado, necesario para leer PDF.' : e.message)),
    );
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`No se pudo leer el PDF${err.length ? `: ${Buffer.concat(err).toString().trim()}` : ''}`));
    });
    child.stdin.on('error', () => {}); // pdftotext may close early on a broken file
    child.stdin.end(data);
  });
}
