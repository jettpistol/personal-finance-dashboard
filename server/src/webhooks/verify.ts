// Webhook authenticity check.
//
// Docs: Your integrations > Notifications > Webhooks > "Validate notification origin"
//   https://www.mercadopago.com/developers/en/docs/your-integrations/notifications/webhooks
// SDK:  WebhookSignatureValidator (mercadopago@3.6.1, src/utils/webhook): HMAC-SHA256 (hex) over the
//       manifest "id:{data.id};request-id:{x-request-id};ts:{ts};" keyed with the app's secret signature,
//       compared in constant time against the `v1` value of the `x-signature` header (`ts=...,v1=...`).
import { InvalidWebhookSignatureError, SignatureFailureReason, WebhookSignatureValidator } from 'mercadopago';

export { InvalidWebhookSignatureError, SignatureFailureReason };

export type VerifyInput = {
  xSignature: string | string[] | undefined;
  xRequestId: string | string[] | undefined;
  /** `data.id` from the notification URL query string (not from the body), as the docs specify. */
  dataId: string | string[] | undefined;
  secret: string;
  toleranceSeconds: number;
  now?: () => number;
};

/**
 * Throws InvalidWebhookSignatureError when the notification cannot be attributed to Mercado Pago.
 *
 * GAP (timestamp unit): the docs describe `ts` as a millisecond timestamp, and the SDK's own fixtures use a
 * 13-digit value, but the SDK's tolerance check multiplies `ts` by 1000 (treats it as seconds). Using the
 * SDK's `toleranceSeconds` with a millisecond `ts` would reject every genuine notification, so the HMAC is
 * verified by the SDK and the replay window is enforced here, accepting either unit.
 */
export function verifyWebhookSignature(input: VerifyInput): { ts: string } {
  WebhookSignatureValidator.validate({
    xSignature: input.xSignature,
    xRequestId: input.xRequestId,
    dataId: input.dataId,
    secret: input.secret,
  });

  const header = Array.isArray(input.xSignature) ? input.xSignature[0]! : input.xSignature!;
  const ts = /(?:^|,)\s*ts=(\d+)/.exec(header)![1]!;

  if (input.toleranceSeconds > 0) {
    const tsMs = ts.length >= 13 ? Number(ts) : Number(ts) * 1000;
    const now = (input.now ?? Date.now)();
    if (Math.abs(now - tsMs) / 1000 > input.toleranceSeconds) {
      const requestId = Array.isArray(input.xRequestId) ? input.xRequestId[0] : input.xRequestId;
      throw new InvalidWebhookSignatureError(SignatureFailureReason.TimestampOutOfTolerance, requestId, ts);
    }
  }
  return { ts };
}
