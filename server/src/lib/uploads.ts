import crypto from 'node:crypto';
import { HttpError } from './http.js';

// Uploaded files stay in memory for a short while so a preview can be rebuilt without uploading again.
type Upload = { userId: number; fileName: string; data: Buffer; expires: number; cache?: unknown };
const uploads = new Map<string, Upload>();
const UPLOAD_TTL = 30 * 60_000;

export function saveUpload(userId: number, fileName: string, data: Buffer): string {
  const id = crypto.randomUUID();
  uploads.set(id, { userId, fileName, data, expires: Date.now() + UPLOAD_TTL });
  return id;
}

export function getUpload(id: string, userId: number): Upload {
  for (const [k, u] of uploads) if (u.expires < Date.now()) uploads.delete(k);
  const u = uploads.get(id);
  if (!u || u.userId !== userId) throw new HttpError(404, 'El archivo expiró. Volvé a subirlo.');
  return u;
}
