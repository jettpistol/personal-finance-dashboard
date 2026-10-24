import { MercadoPagoConfig, Payment, User } from 'mercadopago';
import type { PaymentResponse } from 'mercadopago/dist/clients/payment/commonTypes.js';
import type { PaymentSearchOptions, PaymentSearchResult } from 'mercadopago/dist/clients/payment/search/types.js';
import { config } from '../../config.js';

// Calls to Mercado Pago for one connected account. Payments and users go through the official SDK
// (mercadopago@3.6.1); balance and reports are not wrapped by the SDK and use the REST API directly.
//   Payments:  https://www.mercadopago.com/developers/en/reference (Payments)
//   Reports:   https://www.mercadopago.com.ar/developers/en/docs/reports/released-money/api
//              (the Account money report, "settlement_report", follows the same pattern)

export type MpPayment = PaymentResponse | PaymentSearchResult;

export interface MpClient {
  getMe(): Promise<{ id: string; nickname: string | null; site_id: string | null }>;
  getPayment(id: string): Promise<MpPayment>;
  searchPayments(options: PaymentSearchOptions): AsyncIterable<MpPayment>;
  /** Not in the public API reference: the response is returned untouched. */
  getBalance(userId: string): Promise<unknown>;
  settlementReport: {
    getConfig(): Promise<unknown>;
    createConfig(body: unknown): Promise<unknown>;
    create(range: { begin_date: string; end_date: string }): Promise<unknown>;
    list(): Promise<unknown>;
    download(fileName: string): Promise<string>;
  };
}

export class MpHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Mercado Pago respondió ${status} en ${path}`);
    this.name = 'MpHttpError';
  }
}

export function httpStatusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' && s > 0 ? s : undefined;
}

export function createMpClient(accessToken: string): MpClient {
  const sdk = new MercadoPagoConfig({ accessToken, options: { timeout: 15_000 } });
  const payment = new Payment(sdk);
  const user = new User(sdk);

  async function raw(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${config.mpApiBase}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new MpHttpError(res.status, path, (await res.text()).slice(0, 1000));
    return res;
  }
  const json = async (path: string, init?: RequestInit) => {
    const text = await (await raw(path, init)).text();
    return text ? (JSON.parse(text) as unknown) : null;
  };

  const report = '/v1/account/settlement_report';
  return {
    async getMe() {
      const me = await user.get();
      return { id: String(me.id), nickname: me.nickname ?? null, site_id: me.site_id ?? null };
    },
    getPayment: (id) => payment.get({ id }),
    searchPayments: (options) => payment.searchAll({ options }),
    getBalance: (userId) => json(`/users/${encodeURIComponent(userId)}/mercadopago_account/balance`),
    settlementReport: {
      getConfig: () => json(`${report}/config`),
      createConfig: (body) => json(`${report}/config`, { method: 'POST', body: JSON.stringify(body) }),
      create: (range) => json(report, { method: 'POST', body: JSON.stringify(range) }),
      list: () => json(`${report}/list`),
      download: async (fileName) => (await raw(`${report}/${encodeURIComponent(fileName)}`, { headers: { Accept: '*/*' } })).text(),
    },
  };
}

// Tests swap the factory for a fake; nothing else should.
let factory: (accessToken: string) => MpClient = createMpClient;
export function mpClientFor(accessToken: string): MpClient {
  return factory(accessToken);
}
export function setMpClientFactory(f: ((accessToken: string) => MpClient) | null) {
  factory = f ?? createMpClient;
}
