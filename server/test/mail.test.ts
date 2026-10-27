import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// A tiny SMTP sink stands in for Gmail, so the whole path (settings -> notify -> SMTP) is exercised.
// It rejects the password "mala" the way Gmail does (535).
function fakeSmtp(received: string[]) {
  return net.createServer((socket) => {
    let data = false;
    let buffer = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (data) {
          if (line === '.') {
            data = false;
            socket.write('250 ok\r\n');
          } else received[received.length - 1] += `${line}\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH') {
          const [, , pass] = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString().split('\0');
          socket.write(pass === 'mala' ? '535 5.7.8 Username and Password not accepted\r\n' : '235 ok\r\n');
        } else if (cmd === 'DATA') {
          data = true;
          received.push('');
          socket.write('354 go\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
}

const received: string[] = [];
const smtp = fakeSmtp(received);
// A second server for the account set up from the app.
const appReceived: string[] = [];
const appSmtp = fakeSmtp(appReceived);

let app: FastifyInstance;
let cookie = '';

beforeAll(async () => {
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => appSmtp.listen(0, '127.0.0.1', () => r()));
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String((smtp.address() as net.AddressInfo).port), SMTP_USER: 'test@example.com', SMTP_PASS: 'x' });
  const { openDb, setDb } = await import('../src/db/index.js');
  const { buildApp } = await import('../src/app.js');
  setDb(openDb(':memory:'));
  app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ivan', display_name: 'Iván', password: 'contraseña-larga' } });
  cookie = r.headers['set-cookie']!.toString().split(';')[0];
});

afterAll(() => {
  smtp.close();
  appSmtp.close();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } });

describe('email notifications', () => {
  it('validates the address, sends a test email and delivers notifications by email', async () => {
    expect((await call('GET', '/api/me')).json().mail_available).toBe(true);
    expect((await call('POST', '/api/me/email/test')).statusCode).toBe(400); // no address yet
    expect((await call('PATCH', '/api/me', { email: 'no-es-un-correo' })).statusCode).toBe(400);
    expect((await call('PATCH', '/api/me', { email: 'ivan@example.com' })).statusCode).toBe(200);

    expect((await call('POST', '/api/me/email/test')).statusCode).toBe(200);
    expect(received.at(-1)).toContain('To: ivan@example.com');
    expect(received.at(-1)).toContain('los avisos de Finanzas te van a llegar');

    const { notify } = await import('../src/lib/notify.js');
    await notify({ kind: 'budget', users: null, title: 'Presupuesto superado: Supermercado', body: 'Gastado $ 1 de $ 1.' });
    expect(received).toHaveLength(2);
    expect(received.at(-1)).toContain('Gastado $ 1 de $ 1.');

    // Turning a kind off stops its emails (the bell still gets it).
    await call('PATCH', '/api/me', { notify_budget: false });
    await notify({ kind: 'budget', users: null, title: 'Otro aviso', body: '-' });
    expect(received).toHaveLength(2);
  });
});

describe('sending account set up from the app', () => {
  const appPort = () => (appSmtp.address() as net.AddressInfo).port;

  it('starts from the server settings', async () => {
    const r = (await call('GET', '/api/mail/settings')).json();
    expect(r).toMatchObject({ configured: true, source: 'server', host: '127.0.0.1', user: 'test@example.com', has_password: true });
    expect(r).not.toHaveProperty('pass');
  });

  it('validates the account', async () => {
    const bad = await call('PUT', '/api/mail/settings', { user: 'no-es-un-correo', pass: 'abcd' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'El correo no es válido.', fields: ['user'] });
    const noPass = await call('PUT', '/api/mail/settings', { user: 'casa@gmail.com' });
    expect(noPass.statusCode).toBe(400);
    expect(noPass.json().fields).toContain('pass');
  });

  it('stores it with Gmail defaults, without spaces in the app password and never returns it', async () => {
    expect((await call('PUT', '/api/mail/settings', { user: ' casa@gmail.com ', pass: 'abcd efgh ijkl mnop' })).statusCode).toBe(200);
    const r = await call('GET', '/api/mail/settings');
    expect(r.json()).toEqual({ configured: true, source: 'app', host: 'smtp.gmail.com', port: 465, user: 'casa@gmail.com', from: '', has_password: true });
    expect(r.body).not.toContain('abcd');
    const { storedSmtp } = await import('../src/lib/mail.js');
    expect(storedSmtp()?.pass).toBe('abcdefghijklmnop');
  });

  it('overrides the environment and keeps the password when it is not retyped', async () => {
    expect((await call('PUT', '/api/mail/settings', { user: 'casa@example.com', host: '127.0.0.1', port: appPort(), from: 'Finanzas <casa@example.com>' })).statusCode).toBe(200);
    const { storedSmtp } = await import('../src/lib/mail.js');
    expect(storedSmtp()?.pass).toBe('abcdefghijklmnop'); // kept

    const before = received.length;
    const t = await call('POST', '/api/mail/settings/test', {});
    expect(t.statusCode).toBe(200);
    expect(t.json()).toEqual({ ok: true, to: 'ivan@example.com' });
    expect(received).toHaveLength(before); // the environment's server got nothing
    expect(appReceived.at(-1)).toContain('To: ivan@example.com');
    expect(appReceived.at(-1)).toContain('From: Finanzas <casa@example.com>');

    // Notifications go through it too.
    const { notify } = await import('../src/lib/notify.js');
    await call('PATCH', '/api/me', { notify_budget: true });
    await notify({ kind: 'budget', users: null, title: 'Aviso', body: 'Por la cuenta de la app.' });
    expect(appReceived.at(-1)).toContain('Por la cuenta de la app.');
    expect(received).toHaveLength(before);
  });

  it('sends the test to another address and explains a rejected password', async () => {
    expect((await call('POST', '/api/mail/settings/test', { to: 'otra@example.com' })).statusCode).toBe(200);
    expect(appReceived.at(-1)).toContain('To: otra@example.com');
    expect((await call('POST', '/api/mail/settings/test', { to: 'nope' })).json()).toMatchObject({ error: 'El correo no es válido.', fields: ['to'] });

    await call('PUT', '/api/mail/settings', { user: 'casa@example.com', pass: 'mala', host: '127.0.0.1', port: appPort() });
    const sent = appReceived.length;
    const r = await call('POST', '/api/mail/settings/test', {});
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'El servidor rechazó el usuario o la contraseña.', fields: ['pass'] });
    expect(appReceived).toHaveLength(sent);

    const { describeMailError } = await import('../src/lib/mail.js');
    expect(describeMailError({ code: 'EAUTH', responseCode: 535, message: 'Invalid login' }, 'smtp.gmail.com').message).toBe('Gmail rechazó el usuario o la contraseña de aplicación.');
  });

  it('forgets the account and falls back to the server settings', async () => {
    expect((await call('DELETE', '/api/mail/settings')).statusCode).toBe(200);
    expect((await call('GET', '/api/mail/settings')).json()).toMatchObject({ configured: true, source: 'server', host: '127.0.0.1' });
    const before = received.length;
    expect((await call('POST', '/api/mail/settings/test', {})).statusCode).toBe(200);
    expect(received).toHaveLength(before + 1);
  });
});
