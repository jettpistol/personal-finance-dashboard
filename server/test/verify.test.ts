import { describe, expect, it } from 'vitest';
import { InvalidWebhookSignatureError, SignatureFailureReason, verifyWebhookSignature } from '../src/webhooks/verify.js';
import { SECRET, sign } from './helpers.js';

const REQ = '2066ca19-c6f1-498a-be75-1923005edd06';

function reason(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidWebhookSignatureError);
    return (e as InvalidWebhookSignatureError).reason;
  }
  throw new Error('expected throw');
}

describe('verifyWebhookSignature', () => {
  const nowMs = 1761300000000;

  it('accepts a valid signature with a millisecond ts', () => {
    const ts = String(nowMs);
    expect(verifyWebhookSignature({ xSignature: sign('123', REQ, ts), xRequestId: REQ, dataId: '123', secret: SECRET, toleranceSeconds: 300, now: () => nowMs }))
      .toEqual({ ts });
  });

  it('accepts a valid signature with a second ts', () => {
    const ts = String(Math.floor(nowMs / 1000));
    expect(() => verifyWebhookSignature({ xSignature: sign('123', REQ, ts), xRequestId: REQ, dataId: '123', secret: SECRET, toleranceSeconds: 300, now: () => nowMs }))
      .not.toThrow();
  });

  it('rejects a wrong secret', () => {
    const ts = String(nowMs);
    expect(reason(() => verifyWebhookSignature({ xSignature: sign('123', REQ, ts, 'other'), xRequestId: REQ, dataId: '123', secret: SECRET, toleranceSeconds: 0 })))
      .toBe(SignatureFailureReason.SignatureMismatch);
  });

  it('rejects when data.id was tampered with', () => {
    const ts = String(nowMs);
    expect(reason(() => verifyWebhookSignature({ xSignature: sign('123', REQ, ts), xRequestId: REQ, dataId: '999', secret: SECRET, toleranceSeconds: 0 })))
      .toBe(SignatureFailureReason.SignatureMismatch);
  });

  it('rejects a missing header', () => {
    expect(reason(() => verifyWebhookSignature({ xSignature: undefined, xRequestId: REQ, dataId: '123', secret: SECRET, toleranceSeconds: 0 })))
      .toBe(SignatureFailureReason.MissingSignatureHeader);
  });

  it('rejects a replayed (old) notification', () => {
    const ts = String(nowMs - 3600_000);
    expect(reason(() => verifyWebhookSignature({ xSignature: sign('123', REQ, ts), xRequestId: REQ, dataId: '123', secret: SECRET, toleranceSeconds: 300, now: () => nowMs })))
      .toBe(SignatureFailureReason.TimestampOutOfTolerance);
  });

  it('skips the replay window when tolerance is 0', () => {
    const ts = String(nowMs - 3600_000);
    expect(() => verifyWebhookSignature({ xSignature: sign('123', REQ, ts), xRequestId: REQ, dataId: '123', secret: SECRET, toleranceSeconds: 0, now: () => nowMs }))
      .not.toThrow();
  });
});
