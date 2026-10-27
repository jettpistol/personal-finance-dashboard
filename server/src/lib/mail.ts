import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { coreDb } from '../db/index.js';

// Email notifications over plain SMTP. With Gmail it's free: an "app password" from the Google
// account is enough. The sending account is set up from Ajustes → Notificaciones and kept in the
// core database (shared by every data profile); the server settings (SMTP_HOST, SMTP_USER,
// SMTP_PASS...) are the fallback when nothing was set up there.

export type SmtpSettings = { host: string; port: number; user: string; pass: string; from: string };

const KEY = 'smtp';

/** The account saved from the app, if any. */
export function storedSmtp(): SmtpSettings | null {
  const row = coreDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as Partial<SmtpSettings>;
    if (!v.host || !v.user || !v.pass) return null;
    return { host: v.host, port: Number(v.port) || 465, user: v.user, pass: v.pass, from: v.from ?? '' };
  } catch {
    return null;
  }
}

export function saveSmtp(s: SmtpSettings) {
  coreDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(KEY, JSON.stringify(s));
  transporter = null;
}

export function clearSmtp() {
  coreDb().prepare('DELETE FROM settings WHERE key = ?').run(KEY);
  transporter = null;
}

function serverSmtp(): SmtpSettings | null {
  const s = config.smtp;
  return s.host && s.user && s.pass ? { ...s } : null;
}

/** Which settings are in use: the app's, else the server's. */
export function activeSmtp(): { source: 'app' | 'server'; settings: SmtpSettings } | null {
  const app = storedSmtp();
  if (app) return { source: 'app', settings: app };
  const server = serverSmtp();
  return server ? { source: 'server', settings: server } : null;
}

export function mailEnabled(): boolean {
  return activeSmtp() !== null;
}

// The transporter is rebuilt whenever the settings it was made from change.
let transporter: Transporter | null = null;
let transporterKey = '';

function transport(s: SmtpSettings): Transporter {
  const key = JSON.stringify([s.host, s.port, s.user, s.pass]);
  if (!transporter || key !== transporterKey) {
    transporter?.close();
    transporter = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.port === 465,
      auth: { user: s.user, pass: s.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    transporterKey = key;
  }
  return transporter;
}

function current(): SmtpSettings {
  const active = activeSmtp();
  if (!active) throw new Error('El correo no está configurado.');
  return active.settings;
}

/** Logs in to the SMTP server without sending anything. */
export async function verifyMail(): Promise<void> {
  await transport(current()).verify();
}

export async function sendMail(to: string, subject: string, text: string, attachment?: { fileName: string; data: Buffer }) {
  const s = current();
  await transport(s).sendMail({
    from: s.from || s.user,
    to,
    subject: `Finanzas · ${subject}`,
    text,
    attachments: attachment ? [{ filename: attachment.fileName, content: attachment.data }] : undefined,
  });
}

/** Turns an SMTP failure into a message a person can act on, plus the field to mark. */
export function describeMailError(e: unknown, host = activeSmtp()?.settings.host ?? ''): { message: string; field?: 'pass' | 'host' | 'port' } {
  const err = e as { code?: string; responseCode?: number; message?: string };
  const gmail = /(^|\.)(gmail|googlemail|google)\.com$/i.test(host);
  if (err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534) {
    if (gmail && err.responseCode === 534) {
      return { message: 'Gmail no acepta tu contraseña normal: creá una contraseña de aplicación y usala acá.', field: 'pass' };
    }
    return { message: gmail ? 'Gmail rechazó el usuario o la contraseña de aplicación.' : 'El servidor rechazó el usuario o la contraseña.', field: 'pass' };
  }
  if (err.code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(err.message ?? '')) {
    return { message: `No se encontró el servidor ${host}.`, field: 'host' };
  }
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || err.code === 'ESOCKET' || /ECONNREFUSED|ECONNRESET|wrong version number/i.test(err.message ?? '')) {
    return { message: `No se pudo conectar con ${host}. Revisá el servidor y el puerto (465 o 587).`, field: 'port' };
  }
  return { message: `No se pudo enviar el correo: ${err.message ?? String(e)}` };
}
