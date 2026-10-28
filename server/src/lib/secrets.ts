import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Encryption at rest for credentials that give access to money (the Mercado Pago token).
// AES-256-GCM; the key never lives in a database, so a copied database or backup alone can't be
// read. The key comes from SECRET_KEY (64 hex characters or 32 bytes in base64) when set, else from
// DATA_DIR/secret.key, created on first use and readable only by the server's user.
//
// Each value is bound to what it belongs to (`context`, e.g. "mp:3"): a ciphertext copied onto
// another user's row fails to decrypt instead of handing over someone else's token.

const VERSION = 'v1';
let cached: { source: string; key: Buffer } | null = null;

function parseKey(raw: string): Buffer {
  const v = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (key.length !== 32) throw new Error('SECRET_KEY must be 32 bytes (64 hex characters or base64).');
  return key;
}

export function keyFile(): string {
  return path.join(config.dataDir, 'secret.key');
}

function loadKey(): Buffer {
  const env = process.env.SECRET_KEY;
  const source = env ? 'env' : keyFile();
  if (cached?.source === source) return cached.key;
  let key: Buffer;
  if (env) key = parseKey(env);
  else {
    const file = keyFile();
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // 'wx' fails instead of overwriting if another process created it in between.
      try {
        fs.writeFileSync(file, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    key = parseKey(fs.readFileSync(file, 'utf8'));
  }
  cached = { source, key };
  return key;
}

/** Where the key comes from, for the settings screen ("env" or "file"). */
export function keySource(): 'env' | 'file' {
  return process.env.SECRET_KEY ? 'env' : 'file';
}

export function encryptSecret(plain: string, context: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** The plain value, or null when it can't be read (wrong key, tampered, or another row's value). */
export function decryptSecret(stored: string, context: string): string | null {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
