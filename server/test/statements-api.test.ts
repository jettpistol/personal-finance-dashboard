import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, setDb, db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { sampleAccountXlsx, standardXlsx } from './statements/helpers/galicia-xlsx.js';

// The PDFs are stood in by their `pdftotext -layout` text, so the tests don't need poppler.
const fixture = (name: string) => readFileSync(new URL(`./statements/fixtures/${name}`, import.meta.url), 'utf8');
const TEXTS: Record<string, string> = { visa: fixture('visa.layout.txt'), amex: fixture('amex.layout.txt'), account: fixture('account.layout.txt') };
vi.mock('../src/lib/statements/pdf-text.js', () => ({
  extractPdfText: async (data: Uint8Array) => {
    const key = Buffer.from(data).toString().replace('%PDF-', '');
    if (key === 'visa-tampered') return TEXTS.visa!.replace(/(TOTAL A PAGAR\s+)171\.000,50/, '$1171.999,50');
    if (key === 'scan') return '';
    return TEXTS[key] ?? 'Otro documento';
  },
}));

let app: FastifyInstance;
let cookie = '';
const acc: Record<string, number> = {};
const cat: Record<string, number> = {};

async function call(method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { cookie } });
  return { status: res.statusCode, body: res.json() };
}

async function upload(fileName: string, data: Uint8Array | string) {
  const boundary = '----stmt';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({ method: 'POST', url: '/api/imports/upload', payload: body, headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  return res.json().upload_id as string;
}

const pdf = (kind: string) => upload(`${kind}.pdf`, `%PDF-${kind}`);

type Item = { description: string; type: string; category_id: number | null; include: boolean; hint: unknown; currency_mismatch: boolean; date: string; notes: string | null; suggested: string | null; direction: string; to_account_id: number | null; duplicate: string | null };

beforeAll(async () => {
  setDb(openDb(':memory:'));
  app = await buildApp();
  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ana', display_name: 'Ana', password: 'contraseña-larga' } });
  cookie = setup.headers['set-cookie']!.toString().split(';')[0]!;
  for (const c of db().prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]) cat[c.name] = c.id;
  const mk = async (body: object) => (await call('POST', '/api/accounts', body)).body.id as number;
  acc.bank = await mk({ name: 'Galicia caja', type: 'bank', currency: 'ARS', owner: 'me' });
  acc.visa = await mk({ name: 'Visa Galicia', type: 'credit_card', currency: 'ARS', owner: 'me' });
  acc.visaUsd = await mk({ name: 'Visa USD', type: 'credit_card', currency: 'USD', owner: 'me' });
});

describe('readers', () => {
  it('lists what can be read today', async () => {
    const r = await call('GET', '/api/statements/readers');
    expect(r.body.map((x: { id: string }) => x.id)).toEqual(['galicia-account-xlsx', 'galicia-account-pdf', 'galicia-card-visa', 'galicia-card-amex', 'naranjax-card']);
    expect(r.body[0]).toMatchObject({ institution: 'Banco Galicia', fileType: 'xlsx', target: 'bank' });
    expect(r.body[0]).not.toHaveProperty('read');
  });

  it('recognises each file by its content, not its name', async () => {
    const detect = async (id: string) => (await call('POST', '/api/statements/detect', { upload_id: id })).body;
    expect((await detect(await upload('cualquiera.bin', sampleAccountXlsx()))).reader.id).toBe('galicia-account-xlsx');
    expect((await detect(await pdf('account'))).reader.id).toBe('galicia-account-pdf');
    expect((await detect(await pdf('visa'))).reader.id).toBe('galicia-card-visa');
    expect((await detect(await pdf('amex'))).reader.id).toBe('galicia-card-amex');
  });

  it('says why a file is not accepted', async () => {
    const other = await call('POST', '/api/statements/detect', { upload_id: await pdf('otro') });
    expect(other.status).toBe(400);
    expect(other.body.error).toMatch(/No se reconoce este PDF/);
    expect(other.body.error).toMatch(/Tarjeta de crédito Visa/);
    const sheet = await call('POST', '/api/statements/detect', { upload_id: await upload('x.xlsx', standardXlsx()) });
    expect(sheet.body.error).toMatch(/No se reconoce este archivo de Excel/);
    const text = await call('POST', '/api/statements/detect', { upload_id: await upload('x.txt', 'hola') });
    expect(text.body.error).toMatch(/Solo se pueden leer archivos PDF y Excel/);
    const scan = await call('POST', '/api/statements/detect', { upload_id: await pdf('scan') });
    expect(scan.body.error).toMatch(/foto o un escaneo/);
  });
});

describe('Galicia extract (xlsx) into a bank account', () => {
  let rows: Item[];
  it('shows a summary, checks and warnings', async () => {
    const d = (await call('POST', '/api/statements/detect', { upload_id: await upload('extracto.xlsx', sampleAccountXlsx()) })).body;
    expect(d.integrity.ok).toBe(true);
    expect(d.summary).toMatchObject({ kind: 'account', count: 6, accountRef: '1234567' });
    expect(d.warnings.join(' ')).toContain('2026-10-26');
  });

  it('proposes types and categories for the review', async () => {
    const id = await upload('extracto.xlsx', sampleAccountXlsx());
    const p = await call('POST', '/api/statements/preview', { upload_id: id, account_id: acc.bank });
    expect(p.status).toBe(200);
    rows = p.body.items;
    const by = (re: RegExp) => rows.find((r) => re.test(r.description))!;
    expect(by(/HABERES/)).toMatchObject({ type: 'income', category_id: cat['Sueldo'], include: true });
    expect(by(/REINTEGRO/)).toMatchObject({ type: 'income', category_id: cat['Reintegros'] });
    expect(by(/OLLIEFOOD/)).toMatchObject({ type: 'expense', category_id: null }); // unknown stays unclassified
    expect(by(/PAGO TARJETA VISA/)).toMatchObject({ type: 'transfer', direction: 'out' });
    expect(by(/dolares/)).toMatchObject({ type: 'transfer', direction: 'in', notes: expect.stringContaining('1.495') });
    expect(by(/MARIA GOMEZ/)).toMatchObject({ type: 'expense', category_id: null });
  });

  it('imports through the usual commit, then flags a second import as duplicate and undoes it', async () => {
    const send = rows.map((r) => (r.type === 'transfer' ? { ...r, to_account_id: acc.visa } : r));
    const commit = await call('POST', '/api/imports/commit', { file_name: 'extracto.xlsx', account_id: acc.bank, rows: send });
    expect(commit.status).toBe(200);
    expect(commit.body).toMatchObject({ imported: 6, failures: [] });
    const again = await call('POST', '/api/statements/preview', { upload_id: await upload('extracto.xlsx', sampleAccountXlsx()), account_id: acc.bank });
    expect(again.body.items.every((i: Item) => i.duplicate === 'exact' && !i.include)).toBe(true);
    expect((await call('DELETE', `/api/imports/${commit.body.batch_id}`)).body.deleted).toBe(6);
  });
});

describe('Visa statement (pdf) into a card account', () => {
  it('reports the statement and passes its own checks', async () => {
    const d = (await call('POST', '/api/statements/detect', { upload_id: await pdf('visa') })).body;
    expect(d.integrity.ok).toBe(true);
    expect(d.integrity.checks.map((c: { label: string }) => c.label)).toContain('Total a pagar en dólares');
    expect(d.summary).toMatchObject({ kind: 'card', issuer: 'visa', closeDate: '2026-10-01', dueDate: '2026-10-09', totalDue: { ars: 17100050, usd: 419 } });
    expect(d.summary.cards).toEqual([{ last4: '1111', holder: 'JUAN PEREZ' }, { last4: '2222', holder: 'MARIA GOMEZ' }]);
    expect(d.summary.upcomingInstallments).toEqual([{ month: '2026-10', amount: 1000000 }, { month: '2026-11', amount: 500000 }]);
  });

  it('dates installments at the close date and starts unticked what is already recorded elsewhere', async () => {
    const p = await call('POST', '/api/statements/preview', { upload_id: await pdf('visa'), account_id: acc.visa });
    const items: Item[] = p.body.items;
    const by = (re: RegExp) => items.find((r) => re.test(r.description))!;
    expect(by(/LEDBASRL/)).toMatchObject({ description: 'MERPAGO*LEDBASRL (cuota 2/3)', date: '2026-10-01', include: true });
    expect(by(/LEDBASRL/).notes).toBe('Cuota 2 de 3, compra del 02/08/2026');
    expect(by(/UBER/).date).toBe('2026-08-29'); // not an installment: its own date
    expect(by(/SU PAGO/)).toMatchObject({ type: 'transfer', include: false, hint: { label: 'Pago de la tarjeta' } });
    expect(by(/TRANSFERENCIA DEUDA/)).toMatchObject({ include: false });
    expect(items.filter((i) => i.currency_mismatch).map((i) => i.include)).not.toContain(true); // USD lines into an ARS card
    expect(items.some((i) => i.currency_mismatch)).toBe(true);
  });

  it('categorises from the suggested-rules bank and by kind of charge, never guessing', async () => {
    const p = await call('POST', '/api/statements/preview', { upload_id: await pdf('visa'), account_id: acc.visa });
    const by = (re: RegExp) => (p.body.items as Item[]).find((r) => re.test(r.description))!;
    expect(by(/UBER/)).toMatchObject({ suggested: 'Uber' });
    const names = Object.fromEntries((db().prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]).map((c) => [c.id, c.name]));
    expect(names[by(/UBER/).category_id!]).toBe('Taxi y apps');
    expect(names[by(/RAPPI/).category_id!]).toBe('Delivery');
    expect(names[by(/FARMACITY/).category_id!]).toBe('Farmacia');
    expect(names[by(/INTERESES/).category_id!]).toBe('Intereses de tarjeta');
    expect(names[by(/IMPUESTO DE SELLOS/).category_id!]).toBe('Impuestos');
    expect(by(/MC2025/)).toMatchObject({ type: 'income', category_id: cat['Reintegros'] }); // a refund
  });

  it('puts the dollar lines into a dollar card', async () => {
    const p = await call('POST', '/api/statements/preview', { upload_id: await pdf('visa'), account_id: acc.visaUsd });
    const usd = (p.body.items as Item[]).filter((i) => /Google One|LinkedIn/.test(i.description));
    expect(usd.map((i) => [i.currency_mismatch, i.include])).toEqual([[false, true], [false, true]]);
  });

  it('household rules win over suggestions', async () => {
    await call('POST', '/api/rules', { name: 'Uber trabajo', match_type: 'contains', pattern: 'uber', set_category_id: cat['Varios'], set_merchant: 'Uber' });
    const p = await call('POST', '/api/statements/preview', { upload_id: await pdf('visa'), account_id: acc.visa });
    const uber = (p.body.items as (Item & { rule: string | null })[]).find((r) => /UBER/.test(r.description))!;
    expect(uber).toMatchObject({ rule: 'Uber trabajo', category_id: cat['Varios'], suggested: null });
  });
});

describe('American Express statement', () => {
  it('reads credits next to charges and reconciles', async () => {
    const d = (await call('POST', '/api/statements/detect', { upload_id: await pdf('amex') })).body;
    expect(d.integrity.ok).toBe(true);
    expect(d.summary).toMatchObject({ issuer: 'amex', minimumPayment: 0 });
    const p = await call('POST', '/api/statements/preview', { upload_id: await pdf('amex'), account_id: acc.visa });
    expect((p.body.items as Item[]).find((r) => /SOLO DEPORTES/.test(r.description))).toMatchObject({ date: '2026-08-27' });
  });
});

describe('statement that does not add up', () => {
  it('is reported and never imported', async () => {
    const id = await pdf('visa-tampered');
    const d = (await call('POST', '/api/statements/detect', { upload_id: id })).body;
    expect(d.integrity.ok).toBe(false);
    expect(d.integrity.checks.find((c: { ok: boolean }) => !c.ok)).toMatchObject({ label: 'Total a pagar en pesos', detail: expect.stringContaining('Se esperaba') });
    const p = await call('POST', '/api/statements/preview', { upload_id: id, account_id: acc.visa });
    expect(p.status).toBe(400);
    expect(p.body.error).toMatch(/no coinciden con sus propios totales/);
  });
});

describe('generic CSV/Excel import', () => {
  it('can now open Galicia\'s non-standard workbook', async () => {
    const raw = await call('POST', '/api/imports/raw', { upload_id: await upload('extracto.xlsx', sampleAccountXlsx()) });
    expect(raw.status).toBe(200);
    expect(raw.body.total_rows).toBe(12);
    expect(raw.body.rows[5]).toEqual(['Fecha', 'Movimiento', 'Débito', 'Crédito', 'Saldo Parcial', 'Comentarios']);
  });
});
