// Thin wrapper over Mercado Pago APIs used by the dashboard.
//
// SDK: mercadopago@3.6.1 (https://github.com/mercadopago/sdk-nodejs, requires Node >= 18).
// Endpoints the SDK does not wrap (account balance, reports) are called with fetch + Bearer token,
// exactly as the REST reference describes: https://www.mercadopago.com/developers/en/reference
import { MercadoPagoConfig, Payment, User } from 'mercadopago';
import type { PaymentResponse } from 'mercadopago/dist/clients/payment/commonTypes.js';
import type { PaymentSearchOptions, PaymentSearchResult } from 'mercadopago/dist/clients/payment/search/types.js';

const API_BASE = 'https://api.mercadopago.com';

export type ReportKind = 'release_report' | 'settlement_report';

export type MpPayment = PaymentResponse | PaymentSearchResult;

/** Everything the rest of the app needs from Mercado Pago. Swappable with a fake in tests. */
export interface MpApi {
  /** GET /users/me: resolves the account's user_id. */
  getMe(): Promise<{ id: number | string; nickname?: string; site_id?: string }>;
  /** GET /v1/payments/{id}: source of truth for a payment's current state. */
  getPayment(id: string): Promise<PaymentResponse>;
  /** GET /v1/payments/search with auto-pagination. */
  searchPayments(options: PaymentSearchOptions): AsyncIterable<PaymentSearchResult>;
  /** GET /users/{user_id}/mercadopago_account/balance. See the GAP note note in getBalance. */
  getBalance(userId: string): Promise<unknown>;
  /** Reports API (Releases = release_report, Account money = settlement_report). */
  reports: {
    getConfig(kind: ReportKind): Promise<unknown>;
    createConfig(kind: ReportKind, body: unknown): Promise<unknown>;
    updateConfig(kind: ReportKind, body: unknown): Promise<unknown>;
    create(kind: ReportKind, range: { begin_date: string; end_date: string }): Promise<unknown>;
    list(kind: ReportKind): Promise<unknown>;
    download(kind: ReportKind, fileName: string): Promise<Response>;
  };
}

export class MpHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Mercado Pago ${path} responded ${status}`);
    this.name = 'MpHttpError';
  }
}

export function createMpApi(accessToken: string): MpApi {
  const config = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
  const payment = new Payment(config);
  const user = new User(config);

  async function raw(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new MpHttpError(res.status, path, (await res.text()).slice(0, 2000));
    return res;
  }

  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const res = await raw(path, init);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  const reportPath = (kind: ReportKind) => `/v1/account/${kind}`;

  return {
    async getMe() {
      const me = await user.get();
      return { id: me.id as number, nickname: me.nickname, site_id: me.site_id };
    },

    getPayment: (id) => payment.get({ id }),

    searchPayments: (options) => payment.searchAll({ options }),

    // GAP: this endpoint answers on api.mercadopago.com but has no page in the public developer
    // reference. The response shape is therefore not contractually documented: the raw JSON is
    // returned as-is and the UI must treat every field as optional. The documented alternative
    // for balances is the Account money report (settlement_report) below.
    getBalance: (userId) => json(`/users/${encodeURIComponent(userId)}/mercadopago_account/balance`),

    reports: {
      // Reference: "Releases report" and "Settlements/Account money report" sections of the API reference.
      getConfig: (kind) => json(`${reportPath(kind)}/config`),
      createConfig: (kind, body) => json(`${reportPath(kind)}/config`, { method: 'POST', body: JSON.stringify(body) }),
      updateConfig: (kind, body) => json(`${reportPath(kind)}/config`, { method: 'PUT', body: JSON.stringify(body) }),
      create: (kind, range) => json(reportPath(kind), { method: 'POST', body: JSON.stringify(range) }),
      list: (kind) => json(`${reportPath(kind)}/list`),
      download: (kind, fileName) => raw(`${reportPath(kind)}/${encodeURIComponent(fileName)}`, { headers: { Accept: '*/*' } }),
    },
  };
}
