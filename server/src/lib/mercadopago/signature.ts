import { InvalidWebhookSignatureError, SignatureFailureReason, WebhookSignatureValidator } from 'mercadopago';

// Webhook authenticity, per https://www.mercadopago.com/developers/en/docs/your-integrations/notifications/webhooks
// and the SDK's WebhookSignatureValidator (mercadopago@3.6.1): HMAC-SHA256 (hex) over
// "id:{data.id};request-id:{x-request-id};ts:{ts};" with the application's secret signature, compared in
// constant time with the v1 value of the x-signature header ("ts=...,v1=...").
//
// The docs describe ts in milliseconds, but the SDK's own tolerance option multiplies it by 1000, which would
// reject every genuine notification. So the SDK checks the HMAC and the replay window is enforced here,
// accepting either unit.

export { InvalidWebhookSignatureError, SignatureFailureReason };

export function verifyWebhookSignature(input: {
  xSignature: string | string[] | undefined;
  xRequestId: string | string[] | undefined;
  /** data.id from the query string, which is the signed value. */
  dataId: string | string[] | undefined;
  secret: string;
  toleranceSeconds: number;
  now?: () => number;
}) {
  WebhookSignatureValidator.validate({ xSignature: input.xSignature, xRequestId: input.xRequestId, dataId: input.dataId, secret: input.secret });
  if (input.toleranceSeconds <= 0) return;
  const header = Array.isArray(input.xSignature) ? input.xSignature[0]! : input.xSignature!;
  const ts = /(?:^|,)\s*ts=(\d+)/.exec(header)![1]!;
  const tsMs = ts.length >= 13 ? Number(ts) : Number(ts) * 1000;
  if (Math.abs((input.now ?? Date.now)() - tsMs) / 1000 > input.toleranceSeconds) {
    const requestId = Array.isArray(input.xRequestId) ? input.xRequestId[0] : input.xRequestId;
    throw new InvalidWebhookSignatureError(SignatureFailureReason.TimestampOutOfTolerance, requestId, ts);
  }
}
