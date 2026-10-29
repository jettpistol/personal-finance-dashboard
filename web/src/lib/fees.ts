import type { FeeKind } from './types';

// Platform fees inside a movement's amount (Mercado Pago and any other platform). Same kinds as the server.
export const FEE_LABELS: Record<FeeKind, string> = { fee: 'Comisión', financing: 'Financiación', shipping: 'Envío', tax: 'Impuestos', other: 'Otro cargo' };
export const FEE_KINDS = Object.keys(FEE_LABELS) as FeeKind[];
