import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { today } from './dates.js';

// Daily SQLite snapshots in DATA_DIR/backups. Keeps the last N daily copies plus the
// first-of-month copies for the last M months. Copy the whole DATA_DIR off the server
// (e.g. with rclone) to protect against losing the VM.

const PATTERN = /^finanzas-(\d{4}-\d{2}-\d{2})\.sqlite$/;

export async function runBackup(date = today()): Promise<string> {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const file = path.join(config.backupsDir, `finanzas-${date}.sqlite`);
  await db().backup(file);
  prune();
  return file;
}

export function listBackups(): { file: string; date: string; size: number }[] {
  if (!fs.existsSync(config.backupsDir)) return [];
  return fs
    .readdirSync(config.backupsDir)
    .map((f) => ({ f, m: PATTERN.exec(f) }))
    .filter((x) => x.m)
    .map((x) => ({ file: x.f, date: x.m![1], size: fs.statSync(path.join(config.backupsDir, x.f)).size }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function backupsToKeep(dates: string[], keepDaily: number, keepMonthly: number): Set<string> {
  const sorted = [...dates].sort().reverse();
  const keep = new Set(sorted.slice(0, keepDaily));
  const months = new Map<string, string>();
  // The earliest snapshot of each month represents that month.
  for (const d of [...sorted].reverse()) if (!months.has(d.slice(0, 7))) months.set(d.slice(0, 7), d);
  [...months.values()].sort().reverse().slice(0, keepMonthly).forEach((d) => keep.add(d));
  return keep;
}

function prune() {
  const all = listBackups();
  const keep = backupsToKeep(all.map((b) => b.date), config.backupKeepDaily, config.backupKeepMonthly);
  for (const b of all) if (!keep.has(b.date)) fs.rmSync(path.join(config.backupsDir, b.file), { force: true });
}
