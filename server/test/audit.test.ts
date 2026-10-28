import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../src/config.js';
import { coreDb } from '../src/db/index.js';
import { initProfiles, listProfiles, resetProfile } from '../src/lib/profiles.js';
import { buildApp } from '../src/app.js';
import { unmappedRoutes } from '../src/lib/audit-routes.js';
import { currentMonth, today } from '../src/lib/dates.js';

// Actividad runs on the real layout (core database + one database per data profile), so the
// profile of each entry and the persistence across profile resets are tested for real.

let app: FastifyInstance;
const cookies: Record<string, string> = {};
let profileCookie = '';

type Entry = { id: number; at_ms: number; user_id: number | null; user_name: string | null; profile_id: number | null; section: string; action: string; summary: string; details: any; private: boolean };

async function call(who: 'ana' | 'beto' | null, method: string, url: string, payload?: unknown) {
  const cookie = [who ? cookies[who] : '', profileCookie].filter(Boolean).join('; ');
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: cookie ? { cookie } : {} });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body, res };
}

const log = async (who: 'ana' | 'beto', query = '') => (await call(who, 'GET', `/api/audit?page_size=200${query}`)).body.items as Entry[];
const latest = async (who: 'ana' | 'beto', query = '') => (await log(who, query))[0];
const raw = () => JSON.stringify(coreDb().prepare('SELECT * FROM audit_log').all());

const ids: Record<string, number> = {};
const cat: Record<string, number> = {};
const users: Record<string, number> = {};
const D = (day: number) => `${currentMonth()}-${String(day).padStart(2, '0')}`;

beforeAll(async () => {
  fs.rmSync(config.dataDir, { recursive: true, force: true });
  initProfiles();
  app = await buildApp();
  const setup = await call(null, 'POST', '/api/auth/setup', { username: 'ana', display_name: 'Ana', password: 'contraseña-larga' });
  cookies.ana = setup.res.headers['set-cookie']!.toString().split(';')[0];
  users.beto = (await call('ana', 'POST', '/api/users', { username: 'beto', display_name: 'Beto', password: 'otra-contraseña' })).body.id;
  const login = await call(null, 'POST', '/api/auth/login', { username: 'beto', password: 'otra-contraseña' });
  cookies.beto = login.res.headers['set-cookie']!.toString().split(';')[0];
  users.ana = (await call('ana', 'GET', '/api/me')).body.id;
  // Work in a second profile, so entries must carry its id (not the default profile's).
  const p = (await call('ana', 'POST', '/api/profiles', { name: 'Prueba' })).body;
  ids.profile = p.id;
  const sel = await call('ana', 'POST', '/api/profiles/select', { id: p.id });
  profileCookie = sel.res.headers['set-cookie']!.toString().split(';')[0];
  const cats = (await call('ana', 'GET', '/api/categories')).body as { id: number; name: string }[];
  for (const c of cats) cat[c.name] = c.id;
});

describe('Actividad: what gets logged', () => {
  it('logs logins under Accesos, tied to the user', async () => {
    const entries = await log('ana', '&section=Accesos&profile=all');
    expect(entries.find((e) => e.summary === 'Ingresó' && e.user_name === 'Beto')).toBeTruthy();
    expect(entries.find((e) => e.summary === 'Creó la primera cuenta e ingresó' && e.user_id === users.ana)).toBeTruthy();
    expect(entries.find((e) => e.summary.startsWith('Agregó a Beto'))?.user_id).toBe(users.ana);
  });

  it('logs a failed login for a known user, without the typed password', async () => {
    await call(null, 'POST', '/api/auth/login', { username: 'beto', password: 'clave-equivocada-123' });
    const e = await latest('beto', '&section=Accesos');
    expect(e.summary).toContain('contraseña incorrecta');
    expect(e.user_id).toBe(users.beto);
    expect(raw()).not.toContain('clave-equivocada-123');
    coreDb().prepare('DELETE FROM login_attempts').run();
  });

  it('logs accounts and movements with user, section, profile and a readable summary', async () => {
    const before = Date.now();
    const mk = async (who: 'ana' | 'beto', body: object) => (await call(who, 'POST', '/api/accounts', body)).body.id as number;
    ids.joint = await mk('ana', { name: 'Cuenta común', type: 'bank', currency: 'ARS', owner: 'joint' });
    ids.anaBank = await mk('ana', { name: 'Banco Ana', type: 'bank', currency: 'ARS', owner: 'me' });
    ids.anaSecret = await mk('ana', { name: 'Ahorro secreto', type: 'savings', currency: 'ARS', owner: 'me', is_private: true });
    ids.betoWallet = await mk('beto', { name: 'Billetera Beto', type: 'wallet', currency: 'ARS', owner: 'me' });

    const r = await call('ana', 'POST', '/api/transactions', {
      type: 'expense', date: D(1), amount: 5_000_00, account_id: ids.anaBank, category_id: cat['Almacén'], description: 'Coto',
    });
    expect(r.status).toBe(200);
    ids.coto = r.body.id;
    const e = await latest('beto', '&section=Movimientos');
    expect(e.summary).toBe('Registró un gasto de $ 5.000 «Coto» · Supermercado › Almacén · Banco Ana');
    expect(e.user_name).toBe('Ana');
    expect(e.profile_id).toBe(ids.profile);
    // UTC milliseconds, taken when it happened.
    expect(Number.isInteger(e.at_ms)).toBe(true);
    expect(e.at_ms).toBeGreaterThanOrEqual(before);
    expect(e.at_ms).toBeLessThanOrEqual(Date.now());

    const acc = (await log('beto', '&section=Cuentas')).map((x) => x.summary);
    expect(acc).toContain('Creó la cuenta «Billetera Beto»: Billetera virtual, ARS, personal · saldo inicial $ 0');
  });

  it('logs an edit with before → after', async () => {
    const tx = (await call('ana', 'GET', `/api/transactions/${ids.coto}`)).body;
    const put = await call('ana', 'PUT', `/api/transactions/${ids.coto}`, { type: tx.type, date: tx.date, account_id: ids.anaBank, category_id: tx.category_id, description: tx.description, amount: 6_000_00 });
    expect(put.status).toBe(200);
    const e = await latest('ana', '&section=Movimientos');
    expect(e.summary).toBe('Editó un gasto «Coto» · Monto: $ 5.000 → $ 6.000');
    expect(e.details.changes).toEqual([{ field: 'Monto', from: '$ 5.000', to: '$ 6.000' }]);
  });

  it('logs automatic recurring items as Automático, and the confirmation by the user', async () => {
    const r = await call('ana', 'POST', '/api/recurring', {
      description: 'Netflix', type: 'expense', amount: 12_999_00, account_id: ids.anaBank, category_id: cat['Streaming'], frequency: 'monthly', next_date: today(),
    });
    expect(r.status).toBe(200);
    const auto = (await log('ana', '&section=Recurrentes&user=auto'))[0];
    expect(auto.user_id).toBeNull();
    expect(auto.summary).toBe('Generó un pendiente de «Netflix»: $ 12.999, para confirmar');
    const pending = (await call('ana', 'GET', '/api/transactions?status=pending')).body.items[0];
    await call('ana', 'POST', `/api/transactions/${pending.id}/confirm`, { amount: 13_500_00 });
    const e = await latest('ana', '&section=Recurrentes');
    expect(e.summary).toBe('Confirmó el pendiente «Netflix»: $ 13.500 (esperado $ 12.999)');
    expect(e.user_id).toBe(users.ana);
  });

  it('logs a partial loan return with its reason', async () => {
    const loan = (await call('ana', 'POST', '/api/loans', { person: 'Sofi', kind: 'money', amount: 200_00, lent_on: D(1) })).body;
    const r = await call('ana', 'POST', `/api/loans/${loan.id}/returns`, { amount: 190_00, note: 'le faltaba cambio' });
    expect(r.status).toBe(200);
    const e = await latest('ana', '&section=Deudores');
    expect(e.summary).toBe('Devolución parcial de Sofi: $ 190 (falta $ 10) · motivo: le faltaba cambio');
    expect(e.private).toBe(true);
    // Loans are each person's own: the partner doesn't see the entry.
    expect((await log('beto', '&section=Deudores')).length).toBe(0);
  });

  it('logs budgets with the old and new amount', async () => {
    await call('ana', 'PUT', '/api/budgets', { category_id: cat['Salidas'], scope: 'household', amount: 120_000_00 });
    await call('ana', 'PUT', '/api/budgets', { category_id: cat['Salidas'], scope: 'household', amount: 150_000_00 });
    const [edit, create] = await log('beto', '&section=Presupuestos');
    expect(create.summary).toBe('Creó el presupuesto de «Salidas» (Hogar): $ 120.000');
    expect(edit.summary).toBe('Editó el presupuesto de «Salidas» (Hogar): $ 120.000 → $ 150.000');
  });

  it('does not log failed requests or read-only actions', async () => {
    const n = (await log('ana')).length;
    expect((await call('ana', 'POST', '/api/transactions', { type: 'expense', date: D(1), amount: -5, account_id: ids.anaBank })).status).toBe(400);
    await call('ana', 'POST', '/api/transactions/suggest', { description: 'Coto' });
    await call('ana', 'GET', '/api/reports/inflation');
    expect((await log('ana')).length).toBe(n);
  });

  it('has a descriptor for every mutating route', () => {
    expect(unmappedRoutes()).toEqual([]);
  });
});

describe('Actividad: privacy', () => {
  it('hides entries about a private account from the partner, also in search, counts and export', async () => {
    await call('ana', 'POST', '/api/transactions', { type: 'expense', date: D(2), amount: 999_00, account_id: ids.anaSecret, category_id: cat['Regalos'], description: 'Sorpresa' });
    const mine = await latest('ana', '&section=Movimientos');
    expect(mine.summary).toContain('Sorpresa');
    expect(mine.private).toBe(true);
    const betoAll = JSON.stringify(await log('beto', '&profile=all'));
    expect(betoAll).not.toContain('Sorpresa');
    expect(betoAll).not.toContain('Ahorro secreto');
    expect((await log('beto', '&q=sorpresa')).length).toBe(0);
    const csv = (await call('beto', 'GET', '/api/audit/export.csv')).body as string;
    expect(csv).not.toContain('Sorpresa');
    const counts = (await call('beto', 'GET', '/api/audit/sections')).body as { section: string; count: number }[];
    const anaCounts = (await call('ana', 'GET', '/api/audit/sections')).body as { section: string; count: number }[];
    const mov = (l: typeof counts) => l.find((c) => c.section === 'Movimientos')!.count;
    expect(mov(anaCounts)).toBe(mov(counts) + 1); // the movement on the private account
  });

  it('shows a shared expense from a private account to the partner with the account hidden', async () => {
    await call('ana', 'POST', '/api/transactions', { type: 'expense', date: D(3), amount: 3_000_00, account_id: ids.anaSecret, category_id: cat['Restaurantes'], description: 'Cena', is_shared: true });
    const forAna = await latest('ana', '&section=Movimientos');
    const forBeto = await latest('beto', '&section=Movimientos');
    expect(forAna.summary).toContain('Ahorro secreto');
    expect(forBeto.summary).toBe('Registró un gasto de $ 3.000 «Cena» · Salidas › Restaurantes · cuenta privada · compartido');
    expect(JSON.stringify(forBeto)).not.toContain('Ahorro secreto');
  });

  it('names the Pendientes item a new movement pays only for its owner', async () => {
    const c = await call('ana', 'POST', '/api/commitments', { kind: 'owe', title: 'Deuda con Juan', person: 'Juan', amount: 1_000_00, currency: 'ARS', day: 1, start_month: currentMonth() });
    expect(c.status).toBe(200);
    const r = await call('ana', 'POST', '/api/transactions', {
      type: 'expense', date: D(4), amount: 1_000_00, account_id: ids.joint, category_id: cat['Varios'], description: 'Pago Juan', pending: { source: 'commitment', id: c.body.id },
    });
    expect(r.status).toBe(200);
    const forAna = (await log('ana', '&section=Movimientos')).find((e) => e.summary.includes('Pago Juan'))!;
    const forBeto = (await log('beto', '&section=Movimientos')).find((e) => e.summary.includes('Pago Juan'))!;
    expect(forAna.summary).toBe('Registró un gasto de $ 1.000 «Pago Juan» · Otros gastos › Varios · Cuenta común · para «Deuda con Juan»');
    expect(forBeto.summary).toBe('Registró un gasto de $ 1.000 «Pago Juan» · Otros gastos › Varios · Cuenta común');
  });

  it('never stores passwords, tokens or chat ids', async () => {
    await call('ana', 'PUT', '/api/mail/settings', { user: 'avisos@gmail.com', pass: 'abcd efgh ijkl mnop', host: 'smtp.gmail.com', port: 465 });
    await call('ana', 'POST', '/api/auth/password', { current: 'contraseña-larga', next: 'una-clave-nueva-muy-larga' });
    await call('beto', 'PATCH', '/api/me', { telegram_chat_id: '987654321', display_name: 'Beto B' });
    // A Mercado Pago token in a bad format is refused before anything is stored or logged.
    const mp = await call('beto', 'PUT', '/api/me/mercadopago', { access_token: 'APP_USR-not-a-real-token' });
    expect(mp.status).toBeGreaterThanOrEqual(400);
    const all = raw();
    for (const secret of ['abcdefghijklmnop', 'abcd efgh', 'una-clave-nueva-muy-larga', 'contraseña-larga', 'otra-contraseña', '987654321', 'APP_USR-not-a-real-token']) {
      expect(all).not.toContain(secret);
    }
    const mail = (await log('beto', '&section=Ajustes')).find((e) => e.summary.startsWith('Configuró la cuenta que envía'));
    expect(mail?.details.changes).toContainEqual({ field: 'Contraseña de aplicación', from: '••••', to: 'nueva' });
    // Personal settings are only for their owner.
    const me = (await log('beto', '&section=Ajustes')).find((e) => e.summary.startsWith('Editó su perfil'));
    expect(me?.details.changes).toContainEqual({ field: 'Telegram', from: 'Sin vincular', to: 'Vinculado' });
    expect((await log('ana', '&section=Ajustes')).find((e) => e.summary.startsWith('Editó su perfil'))).toBeUndefined();
    // Password changes close other sessions: log in again.
    const again = await call(null, 'POST', '/api/auth/login', { username: 'ana', password: 'una-clave-nueva-muy-larga' });
    cookies.ana = again.res.headers['set-cookie']!.toString().split(';')[0];
  });
});

describe('Actividad: time, filters, export and clearing', () => {
  it('filters by UTC instants and exports both UTC and the chosen zone', async () => {
    const now = Date.now();
    expect((await log('ana', `&from=${now + 60_000}`)).length).toBe(0);
    expect((await log('ana', `&from=${now - 3_600_000}&to=${now + 60_000}`)).length).toBeGreaterThan(5);
    const csv = (await call('ana', 'GET', '/api/audit/export.csv?tz=Asia/Tokyo&section=Movimientos')).body as string;
    const [header, first] = csv.replace(/^﻿/, '').split(/\r?\n/);
    expect(header).toBe('Fecha y hora (UTC);Fecha y hora (Asia/Tokyo);Usuario;Perfil;Sección;Acción;Resumen;Detalle');
    const [utc, local] = first.split(';');
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(local).toMatch(/\(GMT\+9\)$/);
    // Same instant: Tokyo is 9 hours ahead of UTC all year.
    const utcHour = new Date(utc).getUTCHours();
    expect(Number(local.slice(11, 13))).toBe((utcHour + 9) % 24);
    expect((await call('ana', 'GET', '/api/audit/export.csv?tz=Mars/Base')).status).toBe(400);
  });

  it('keeps entries of other profiles apart, and keeps them after a profile reset', async () => {
    const def = listProfiles().find((p) => p.is_default)!;
    const saved = profileCookie;
    profileCookie = '';
    await call('ana', 'POST', '/api/accounts', { name: 'Cuenta en Vacío', type: 'cash', currency: 'ARS', owner: 'joint' });
    profileCookie = saved;
    expect(JSON.stringify(await log('ana'))).not.toContain('Cuenta en Vacío');
    const all = await log('ana', '&profile=all');
    expect(all.find((e) => e.summary.includes('Cuenta en Vacío'))?.profile_id).toBe(def.id);
    const count = (await log('ana', '&profile=all')).length;
    resetProfile(ids.profile);
    expect((await log('ana', '&profile=all')).length).toBe(count);
  });

  it('clears a section, logs the clearing, and leaves the partner’s private entries', async () => {
    const r = await call('ana', 'DELETE', '/api/audit?scope=section&section=Movimientos');
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBeGreaterThan(0);
    expect((await log('ana', '&section=Movimientos')).length).toBe(0);
    const e = await latest('beto', '&section=Actividad');
    expect(e.summary).toBe(`Borró ${r.body.deleted} entradas de la actividad de Movimientos`);
    expect(e.user_name).toBe('Ana');

    // Beto clears everything: Ana's private entries (which he can't see) stay.
    const privateBefore = (await log('ana', '&profile=all')).filter((x) => x.private).length;
    expect(privateBefore).toBeGreaterThan(0);
    const all = await call('beto', 'DELETE', '/api/audit?scope=all&profile=all');
    expect(all.body.deleted).toBeGreaterThan(0);
    const left = await log('ana', '&profile=all');
    expect(left.filter((x) => x.private).length).toBe(privateBefore);
    expect(left.find((x) => x.section === 'Actividad')?.summary).toContain('(todos los perfiles)');
  });

  it('clears what is older than an instant', async () => {
    const cut = Date.now() + 1;
    await new Promise((r) => setTimeout(r, 5));
    await call('ana', 'POST', '/api/rules', { name: 'Netflix', match_type: 'contains', pattern: 'netflix', set_category_id: cat['Streaming'] });
    const r = await call('ana', 'DELETE', `/api/audit?scope=before&before=${cut}&profile=all&tz=America/Argentina/Buenos_Aires`);
    expect(r.status).toBe(200);
    const left = await log('ana', '&profile=all');
    expect(left.every((x) => x.at_ms >= cut)).toBe(true);
    expect(left.find((x) => x.section === 'Reglas')?.summary).toBe('Creó la regla «Netflix»: si la descripción contiene «netflix» → Suscripciones › Streaming');
    expect(left.find((x) => x.section === 'Actividad')?.summary).toMatch(/anteriores al \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(GMT-3\)/);
  });
});
