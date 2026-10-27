import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// A tiny SMTP sink stands in for Gmail, so the whole path (settings -> notify -> SMTP) is exercised.
const received: string[] = [];
const smtp = net.createServer((socket) => {
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
      if (cmd === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd === 'AUTH') socket.write('235 ok\r\n');
      else if (cmd === 'DATA') {
        data = true;
        received.push('');
        socket.write('354 go\r\n');
      } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
      else socket.write('250 ok\r\n');
    }
  });
});

let app: FastifyInstance;
let cookie = '';

beforeAll(async () => {
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()));
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String((smtp.address() as net.AddressInfo).port), SMTP_USER: 'test@example.com', SMTP_PASS: 'x' });
  const { openDb, setDb } = await import('../src/db/index.js');
  const { buildApp } = await import('../src/app.js');
  setDb(openDb(':memory:'));
  app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ivan', display_name: 'Iván', password: 'contraseña-larga' } });
  cookie = r.headers['set-cookie']!.toString().split(';')[0];
});

afterAll(() => smtp.close());

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } });

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
