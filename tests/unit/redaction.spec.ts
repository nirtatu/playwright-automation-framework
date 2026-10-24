import { test, expect } from '@playwright/test';
import { redact, redactError } from '../../src/security/redaction';

// Offline tests for the shared redaction used by error messages, cleanup warnings and the job summary.

// Shaped like a Playwright request failure: the call log lists every request header.
const CALL_LOG_ERROR = [
  'apiRequestContext.get: read ECONNRESET',
  'Call log:',
  '  - → GET https://example.test/api/booking/7',
  '  - user-agent: Playwright/1.64.1',
  '  - accept: */*',
  '  - cookie: token=s3cr3tToken',
  '  - authorization: Bearer s3cr3tToken',
].join('\n');

test.describe('redact', () => {
  test('masks JSON token and password values', () => {
    expect(redact('{"token":"s3cr3tToken","password": "hunter2","nested":{"token": "a"},"bookingid":7}')).toBe(
      '{"token":"<redacted>","password": "<redacted>","nested":{"token": "<redacted>"},"bookingid":7}',
    );
  });

  test('masks a value cut off by truncation or the end of a line', () => {
    expect(redact('{"rooms":[],"token":"s3cr3tTo')).toBe('{"rooms":[],"token":"<redacted>');
    expect(redact('{"password":"hunter2\nnext line')).toBe('{"password":"<redacted>\nnext line');
  });

  test('masks token query/cookie values and cookie or authorization header lines', () => {
    expect(redact('url?token=s3cr3tToken&x=1')).toBe('url?token=<redacted>&x=1');
    expect(redact('Cookie: token=s3cr3tToken; other=1')).toBe('Cookie: <redacted>');
    expect(redact('authorization: Bearer s3cr3tToken')).toBe('authorization: <redacted>');
  });

  test('keeps the method, URL and other headers of a call log', () => {
    const redacted = redact(CALL_LOG_ERROR);

    expect(redacted).not.toContain('s3cr3tToken');
    expect(redacted).toContain('apiRequestContext.get: read ECONNRESET');
    expect(redacted).toContain('  - → GET https://example.test/api/booking/7');
    expect(redacted).toContain('  - accept: */*');
    expect(redacted).toContain('  - cookie: <redacted>');
  });

  test('strips ANSI colour codes', () => {
    expect(redact('\u001b[2m  - cookie: token=s3cr3tToken\u001b[22m')).toBe('  - cookie: <redacted>');
  });

  test('leaves text without credentials unchanged', () => {
    const text = '[contract] https://example.test/api/booking/7: expected 200, got 404. Body: ';
    expect(redact(text)).toBe(text);
  });
});

test.describe('redactError', () => {
  test('returns a copy with the type kept and message and stack redacted', () => {
    const original = new TypeError(CALL_LOG_ERROR);
    original.stack = `TypeError: ${CALL_LOG_ERROR}\n    at fetch (internal.js:1:1)`;

    const copy = redactError(original);

    expect(copy).not.toBe(original);
    expect(copy.name).toBe('TypeError');
    expect(copy.message).not.toContain('s3cr3tToken');
    expect(copy.message).toContain('GET https://example.test/api/booking/7');
    expect(copy.stack).not.toContain('s3cr3tToken');
    expect(copy.stack).toContain('at fetch (internal.js:1:1)');
    expect(original.message).toContain('s3cr3tToken'); // the original is not mutated
  });

  test('wraps non-Error values', () => {
    const copy = redactError('cookie: token=s3cr3tToken');

    expect(copy).toBeInstanceOf(Error);
    expect(copy.message).toBe('cookie: <redacted>');
  });
});
