import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

// Email notifications over plain SMTP. With Gmail it's free: an "app password" from the Google
// account is enough (SMTP_HOST=smtp.gmail.com, SMTP_USER=you@gmail.com, SMTP_PASS=that password).

let transporter: Transporter | null = null;

export function mailEnabled(): boolean {
  return !!(config.smtp.host && config.smtp.user && config.smtp.pass);
}

function transport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string, attachment?: { fileName: string; data: Buffer }) {
  if (!mailEnabled()) throw new Error('El correo no está configurado.');
  await transport().sendMail({
    from: config.smtp.from || config.smtp.user,
    to,
    subject: `Finanzas · ${subject}`,
    text,
    attachments: attachment ? [{ filename: attachment.fileName, content: attachment.data }] : undefined,
  });
}
