import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';

// Access tokens and webhook secrets are stored with AES-256-GCM, so a copy of the database alone
// (a backup, an export) does not leak working Mercado Pago credentials.

let cached: Buffer | null = null;

function parseKey(raw: string): Buffer {
  const s = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  if (key.length !== 32) throw new Error('MP_TOKEN_KEY must be 32 bytes, as 64 hex characters or base64');
  return key;
}

function key(): Buffer {
  if (cached) return cached;
  if (config.mpTokenKey) {
    cached = parseKey(config.mpTokenKey);
  } else if (fs.existsSync(config.mpTokenKeyFile)) {
    cached = parseKey(fs.readFileSync(config.mpTokenKeyFile, 'utf8'));
  } else {
    fs.mkdirSync(path.dirname(config.mpTokenKeyFile), { recursive: true });
    const fresh = crypto.randomBytes(32);
    fs.writeFileSync(config.mpTokenKeyFile, fresh.toString('hex'), { mode: 0o600, flag: 'wx' });
    cached = fresh;
  }
  return cached;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
