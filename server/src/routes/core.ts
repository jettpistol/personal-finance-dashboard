import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { coreDb, db, getSetting, setSetting } from '../db/index.js';
import { profilesEnabled, syncUsers } from '../lib/profiles.js';
import { HttpError } from '../lib/http.js';
import { accountBalances, accountVisible, loadAccounts, loadUsers } from '../lib/domain.js';
import { loadConverter } from '../lib/fx.js';
import { today } from '../lib/dates.js';
import { telegramEnabled, findChatIdByCode, sendTelegramMessage } from '../lib/telegram.js';
import { activeSmtp, clearSmtp, describeMailError, mailEnabled, saveSmtp, sendMail, storedSmtp, verifyMail } from '../lib/mail.js';
import { idParam, parse } from './util.js';
import crypto from 'node:crypto';

const accountSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(['bank', 'cash', 'credit_card', 'savings', 'investment', 'wallet']),
  currency: z.enum(['ARS', 'USD']),
  owner: z.enum(['joint', 'me']),
  is_private: z.boolean().default(false),
  opening_balance: z.number().int().default(0),
  color: z.string().max(20).nullish(),
  archived: z.boolean().default(false),
  sort: z.number().int().default(0),
});

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  parent_id: z.number().int().nullish(),
  kind: z.enum(['expense', 'income']),
  color: z.string().max(20).nullish(),
  icon: z.string().max(30).nullish(),
  archived: z.boolean().default(false),
  sort: z.number().int().default(0),
});

const settingsSchema = z
  .object({
    household_name: z.string().trim().min(1).max(60),
    default_split: z.record(z.string(), z.number().min(0).max(100)),
    fx_side: z.enum(['sell', 'buy', 'avg']),
    budget_thresholds: z.array(z.number().int().min(1).max(200)).max(5),
    budget_indexing: z.boolean(),
    hide_cents: z.object({ ARS: z.boolean(), USD: z.boolean() }),
  })
  .partial();

const profileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(60),
    color: z.string().max(20),
    share_dashboard: z.boolean(),
    telegram_chat_id: z.string().trim().max(40).nullable(),
    email: z.union([z.email('El correo no es válido.'), z.literal('')]).nullable(),
    notify_budget: z.boolean(),
    notify_recurring: z.boolean(),
    notify_review: z.boolean(),
  })
  .partial();

const mailSettingsSchema = z.object({
  user: z.string({ error: 'Falta el correo.' }).trim().pipe(z.email('El correo no es válido.')),
  pass: z.string('La contraseña no es válida.').max(200, 'La contraseña es demasiado larga.').optional(),
  host: z
    .string('El servidor no es válido.')
    .trim()
    .max(200, 'El servidor no es válido.')
    .regex(/^[A-Za-z0-9.-]*$/, 'El servidor no es válido.')
    .optional(),
  port: z.coerce.number('El puerto no es válido.').int('El puerto no es válido.').min(1, 'El puerto no es válido.').max(65535, 'El puerto no es válido.').optional(),
  from: z.string('El remitente no es válido.').trim().max(200, 'El remitente es demasiado largo.').optional(),
});

/** Like parse(), but answers with the schema's own message and the field to mark in red. */
function parseField<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new HttpError(400, issue?.message ?? 'Hay datos inválidos.', issue?.path[0] === undefined ? undefined : String(issue.path[0]));
}

const mailTestSchema = z.object({
  to: z
    .string('El correo no es válido.')
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, 'El correo no es válido.')
    .optional(),
});

// Pending Telegram link codes: code -> user id.
const linkCodes = new Map<string, { userId: number; expires: number }>();

export default async function coreRoutes(app: FastifyInstance) {
  // ---- Users and profile ----
  app.get('/users', async () => loadUsers().map(({ telegram_chat_id, email, ...u }) => ({ ...u, has_telegram: !!telegram_chat_id, has_email: !!email })));

  app.get('/me', async (req) => {
    const u = loadUsers().find((x) => x.id === req.userId)!;
    return { ...u, telegram_available: telegramEnabled(), mail_available: mailEnabled() };
  });

  app.patch('/me', async (req) => {
    const input = parse(profileSchema, req.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(input)) {
      sets.push(`${k} = ?`);
      values.push(typeof v === 'boolean' ? (v ? 1 : 0) : v === '' ? null : v);
    }
    if (sets.length) coreDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, req.userId);
    if (profilesEnabled()) syncUsers();
    return { ok: true };
  });

  app.post('/me/email/test', async (req) => {
    if (!mailEnabled()) throw new HttpError(400, 'Falta configurar la cuenta que envía los avisos.');
    const u = loadUsers().find((x) => x.id === req.userId)!;
    if (!u.email) throw new HttpError(400, 'Primero guardá tu correo.', 'email');
    try {
      await sendMail(u.email, 'Correo de prueba', `Hola ${u.display_name}: los avisos de Finanzas te van a llegar a este correo.`);
    } catch (e) {
      throw new HttpError(502, describeMailError(e).message);
    }
    return { ok: true };
  });

  // ---- Sending account (shared by everyone; either person can change it) ----
  app.get('/mail/settings', async () => {
    const active = activeSmtp();
    if (!active) return { configured: false, source: null, host: 'smtp.gmail.com', port: 465, user: '', from: '', has_password: false };
    const { host, port, user, from } = active.settings;
    return { configured: true, source: active.source, host, port, user, from, has_password: true };
  });

  app.put('/mail/settings', async (req) => {
    const input = parseField(mailSettingsSchema, req.body);
    const host = input.host || 'smtp.gmail.com';
    const gmail = /(^|\.)(gmail|googlemail|google)\.com$/i.test(host);
    // Google shows app passwords as four groups of four letters; the spaces aren't part of it.
    const typed = input.pass === undefined ? '' : gmail ? input.pass.replace(/\s+/g, '') : input.pass.trim();
    const pass = typed || storedSmtp()?.pass || '';
    if (!pass) throw new HttpError(400, 'Falta la contraseña de aplicación.', 'pass');
    saveSmtp({ host, port: input.port ?? 465, user: input.user, pass, from: input.from ?? '' });
    return { ok: true };
  });

  app.delete('/mail/settings', async () => {
    clearSmtp();
    return { ok: true };
  });

  app.post('/mail/settings/test', async (req) => {
    const input = parseField(mailTestSchema, req.body ?? {});
    if (!mailEnabled()) throw new HttpError(400, 'Falta configurar la cuenta que envía los avisos.');
    const u = loadUsers().find((x) => x.id === req.userId)!;
    const to = input.to || u.email;
    if (!to) throw new HttpError(400, 'Indicá a qué correo mandar la prueba.', 'to');
    try {
      await verifyMail();
      await sendMail(to, 'Correo de prueba', `Hola ${u.display_name}: la cuenta que envía los avisos de Finanzas funciona.`);
    } catch (e) {
      const { message, field } = describeMailError(e);
      throw new HttpError(400, message, field);
    }
    return { ok: true, to };
  });

  app.post('/me/telegram/code', async (req) => {
    if (!telegramEnabled()) throw new HttpError(400, 'El bot de Telegram no está configurado (TELEGRAM_BOT_TOKEN).');
    const code = crypto.randomBytes(4).toString('hex');
    linkCodes.set(code, { userId: req.userId, expires: Date.now() + 15 * 60_000 });
    return { code };
  });

  app.post('/me/telegram/verify', async (req) => {
    const { code } = parse(z.object({ code: z.string() }), req.body);
    const entry = linkCodes.get(code);
    if (!entry || entry.userId !== req.userId || entry.expires < Date.now()) throw new HttpError(400, 'Código vencido. Generá uno nuevo.');
    const chatId = await findChatIdByCode(code);
    if (!chatId) throw new HttpError(404, 'Todavía no recibimos tu mensaje. Enviá el comando al bot y reintentá.');
    coreDb().prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?').run(chatId, req.userId);
    if (profilesEnabled()) syncUsers();
    linkCodes.delete(code);
    await sendTelegramMessage(chatId, '✅ Listo, vas a recibir las alertas de Finanzas acá.');
    return { ok: true };
  });

  app.post('/me/telegram/test', async (req) => {
    const u = loadUsers().find((x) => x.id === req.userId)!;
    if (!u.telegram_chat_id) throw new HttpError(400, 'Primero vinculá tu cuenta de Telegram.');
    await sendTelegramMessage(u.telegram_chat_id, '🔔 Mensaje de prueba de Finanzas.');
    return { ok: true };
  });

  // ---- Household settings ----
  app.get('/settings', async () => ({
    household_name: getSetting('household_name'),
    default_split: getSetting('default_split'),
    fx_side: getSetting('fx_side'),
    budget_thresholds: getSetting('budget_thresholds'),
    budget_indexing: getSetting('budget_indexing'),
    hide_cents: getSetting('hide_cents'),
  }));

  app.patch('/settings', async (req) => {
    const input = parse(settingsSchema, req.body);
    if (input.default_split) {
      const total = Object.values(input.default_split).reduce((a, b) => a + b, 0);
      if (Object.keys(input.default_split).length && Math.abs(total - 100) > 0.01) throw new HttpError(400, 'La división por defecto debe sumar 100%.');
    }
    for (const [k, v] of Object.entries(input)) setSetting(k, v);
    return { ok: true };
  });

  // ---- Accounts ----
  app.get('/accounts', async (req) => {
    const accounts = loadAccounts();
    const balances = accountBalances(accounts);
    const fx = loadConverter();
    const d = today();
    return [...accounts.values()]
      .filter((a) => accountVisible(a, req.userId))
      .map((a) => {
        const balance = balances.get(a.id) ?? 0;
        return {
          ...a,
          balance,
          balance_ars: fx.convert(balance, a.currency, 'ARS', d),
          balance_usd: fx.convert(balance, a.currency, 'USD', d),
          can_edit: a.owner_id === null || a.owner_id === req.userId,
        };
      });
  });

  app.post('/accounts', async (req) => {
    const a = parse(accountSchema, req.body);
    const owner = a.owner === 'me' ? req.userId : null;
    const id = db()
      .prepare('INSERT INTO accounts (name, type, currency, owner_id, is_private, opening_balance, color, archived, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.name, a.type, a.currency, owner, owner && a.is_private ? 1 : 0, a.opening_balance, a.color ?? null, a.archived ? 1 : 0, a.sort).lastInsertRowid;
    return { id: Number(id) };
  });

  app.patch('/accounts/:id', async (req) => {
    const id = idParam(req.params);
    const existing = loadAccounts().get(id);
    if (!existing || !(existing.owner_id === null || existing.owner_id === req.userId)) throw new HttpError(404, 'Cuenta no encontrada');
    const a = parse(accountSchema.partial(), req.body);
    const hasTx = db().prepare('SELECT 1 FROM transactions WHERE account_id = ? OR to_account_id = ? LIMIT 1').get(id, id);
    if (a.currency && a.currency !== existing.currency && hasTx) throw new HttpError(400, 'No se puede cambiar la moneda de una cuenta con movimientos.');
    const owner = a.owner === undefined ? existing.owner_id : a.owner === 'me' ? req.userId : null;
    if (owner !== existing.owner_id && hasTx) throw new HttpError(400, 'No se puede cambiar el titular de una cuenta con movimientos.');
    const isPrivate = owner !== null && (a.is_private ?? !!existing.is_private);
    db()
      .prepare('UPDATE accounts SET name = ?, type = ?, currency = ?, owner_id = ?, is_private = ?, opening_balance = ?, color = ?, archived = ?, sort = ? WHERE id = ?')
      .run(
        a.name ?? existing.name,
        a.type ?? existing.type,
        a.currency ?? existing.currency,
        owner,
        isPrivate ? 1 : 0,
        a.opening_balance ?? existing.opening_balance,
        a.color === undefined ? existing.color : a.color,
        a.archived === undefined ? existing.archived : a.archived ? 1 : 0,
        a.sort ?? existing.sort,
        id,
      );
    return { ok: true };
  });

  app.delete('/accounts/:id', async (req) => {
    const id = idParam(req.params);
    const existing = loadAccounts().get(id);
    if (!existing || !(existing.owner_id === null || existing.owner_id === req.userId)) throw new HttpError(404, 'Cuenta no encontrada');
    const used =
      db().prepare('SELECT 1 FROM transactions WHERE account_id = ? OR to_account_id = ? LIMIT 1').get(id, id) ||
      db().prepare('SELECT 1 FROM recurring WHERE account_id = ? LIMIT 1').get(id);
    if (used) throw new HttpError(409, 'La cuenta tiene movimientos. Archivala en lugar de borrarla.');
    db().prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return { ok: true };
  });

  // ---- Categories ----
  app.get('/categories', async () => db().prepare('SELECT * FROM categories ORDER BY kind, sort, name').all());

  app.post('/categories', async (req) => {
    const c = parse(categorySchema, req.body);
    if (c.parent_id != null) {
      const parent = db().prepare('SELECT kind, parent_id FROM categories WHERE id = ?').get(c.parent_id) as { kind: string; parent_id: number | null } | undefined;
      if (!parent || parent.parent_id !== null) throw new HttpError(400, 'Solo se permite un nivel de subcategorías.');
      if (parent.kind !== c.kind) throw new HttpError(400, 'La subcategoría debe ser del mismo tipo que su categoría.');
    }
    const id = db()
      .prepare('INSERT INTO categories (name, parent_id, kind, color, icon, archived, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.name, c.parent_id ?? null, c.kind, c.color ?? null, c.icon ?? null, c.archived ? 1 : 0, c.sort).lastInsertRowid;
    return { id: Number(id) };
  });

  app.patch('/categories/:id', async (req) => {
    const id = idParam(req.params);
    const existing = db().prepare('SELECT * FROM categories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) throw new HttpError(404, 'Categoría no encontrada');
    const c = parse(categorySchema.partial().omit({ kind: true, parent_id: true }), req.body);
    db()
      .prepare('UPDATE categories SET name = ?, color = ?, icon = ?, archived = ?, sort = ? WHERE id = ?')
      .run(
        c.name ?? existing.name,
        c.color === undefined ? existing.color : c.color,
        c.icon === undefined ? existing.icon : c.icon,
        c.archived === undefined ? existing.archived : c.archived ? 1 : 0,
        c.sort ?? existing.sort,
        id,
      );
    return { ok: true };
  });

  app.delete('/categories/:id', async (req) => {
    const id = idParam(req.params);
    // Transactions keep existing but become uncategorised (ON DELETE SET NULL).
    db().prepare('DELETE FROM categories WHERE id = ?').run(id);
    return { ok: true };
  });

  // ---- Notifications ----
  app.get('/notifications', async (req) =>
    db().prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.userId),
  );

  app.post('/notifications/read', async (req) => {
    db().prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.userId);
    return { ok: true };
  });
}
