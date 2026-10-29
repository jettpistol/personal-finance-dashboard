import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../src/config.js';
import { initProfiles, resetProfile } from '../src/lib/profiles.js';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;
let session = '';

beforeAll(async () => {
  fs.rmSync(config.dataDir, { recursive: true, force: true });
  initProfiles();
  app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ivan', display_name: 'Iván', password: 'contraseña-larga' } });
  session = r.headers['set-cookie']!.toString().split(';')[0];
});

const get = (url: string, cookie = session) => app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, payload: object, cookie = session) => app.inject({ method: 'POST', url, payload, headers: { cookie } });

describe('data profiles', () => {
  it('starts on an empty default profile and keeps data apart per profile', async () => {
    const list = (await get('/api/profiles')).json();
    expect(list.profiles).toHaveLength(1);
    expect(list.profiles[0]).toMatchObject({ name: 'Vacío', is_default: true, transactions: 0, accounts: 0 });
    expect(list.current).toBe(list.profiles[0].id);

    await post('/api/accounts', { name: 'Banco', type: 'bank', currency: 'ARS', owner: 'me' });
    expect((await get('/api/accounts')).json()).toHaveLength(1);

    const created = (await post('/api/profiles', { name: 'Prueba' })).json();
    const sel = await post('/api/profiles/select', { id: created.id });
    const profileCookie = sel.headers['set-cookie']!.toString().split(';')[0];
    const both = `${session}; ${profileCookie}`;

    expect((await get('/api/accounts', both)).json()).toHaveLength(0);
    expect((await get('/api/profiles', both)).json().current).toBe(created.id);
    // Same login, same people, in every profile.
    expect((await get('/api/users', both)).json().map((u: { display_name: string }) => u.display_name)).toEqual(['Iván']);
    // Without the cookie the default profile is used again.
    expect((await get('/api/accounts')).json()).toHaveLength(1);
  });

  it('refuses to delete the default profile', async () => {
    const list = (await get('/api/profiles')).json();
    const def = list.profiles.find((p: { is_default: boolean }) => p.is_default);
    const r = await app.inject({ method: 'DELETE', url: `/api/profiles/${def.id}`, headers: { cookie: session } });
    expect(r.statusCode).toBe(400);
  });

  it('keeps a full copy of a profile before deleting or resetting it', async () => {
    const created = (await post('/api/profiles', { name: 'A borrar' })).json();
    const sel = await post('/api/profiles/select', { id: created.id });
    const both = `${session}; ${sel.headers['set-cookie']!.toString().split(';')[0]}`;
    await post('/api/accounts', { name: 'Caja', type: 'cash', currency: 'ARS', owner: 'me' }, both);
    const del = await app.inject({ method: 'DELETE', url: `/api/profiles/${created.id}`, headers: { cookie: session } });
    expect(del.statusCode).toBe(200);
    const dir = path.join(config.backupsDir, 'guardados');
    const kept = fs.readdirSync(dir).filter((f) => f.startsWith(`perfil-${created.id}-borrado-`));
    expect(kept).toHaveLength(1);
    const copy = new Database(path.join(dir, kept[0]), { readonly: true });
    expect(copy.prepare('SELECT name FROM accounts').all()).toEqual([{ name: 'Caja' }]);
    copy.close();
    const other = (await post('/api/profiles', { name: 'A reiniciar' })).json();
    resetProfile(other.id);
    expect(fs.readdirSync(dir).some((f) => f.startsWith(`perfil-${other.id}-antes-de-reiniciar-`))).toBe(true);
  });
});
