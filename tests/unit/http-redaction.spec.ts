import { test, expect } from '@playwright/test';
import { expectStatus, send, TransportError } from '../../src/api/http';

// Offline tests for the redaction wiring in src/api/http.ts. No request is sent: send() gets a
// rejected promise, and expectStatus() gets a fake response object.

const SECRET = 'S3CRETVALUE123';

// Shaped like a Playwright request failure, whose call log lists every request header.
function playwrightStyleError(): Error {
  const message = [
    'apiRequestContext.get: read ECONNRESET',
    'Call log:',
    '  - → GET https://example.test/api/booking/7',
    '  - accept: */*',
    `  - cookie: token=${SECRET}`,
  ].join('\n');
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at BookingApi.get (src/api/booking-api.ts:23:5)`;
  return error;
}

type FakeResponse = Parameters<typeof expectStatus>[0];

function fakeResponse(status: number, body: string): FakeResponse {
  return {
    status: () => status,
    text: async () => body,
    url: () => 'https://example.test/api/auth/login',
  } as unknown as FakeResponse;
}

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (error: Error) => error,
  );
}

test.describe('send() transport errors', () => {
  test('redacts the message and cause while keeping method, URL and error text', async () => {
    const original = playwrightStyleError();

    const error = await failureOf(send('GET /api/booking/7', () => Promise.reject(original)));

    expect(error).toBeInstanceOf(TransportError);
    expect(error.name).toBe('TransportError');
    expect(error.message).not.toContain(SECRET);
    expect(error.message).toContain('[transport] GET /api/booking/7: apiRequestContext.get: read ECONNRESET');
    expect(error.message).toContain('  - → GET https://example.test/api/booking/7');
    expect(error.message).toContain('  - cookie: <redacted>');
    expect(error.stack).not.toContain(SECRET);
  });

  test('attaches a redacted copy as the cause, never the original error', async () => {
    const original = playwrightStyleError();

    const error = await failureOf(send('GET /api/booking/7', () => Promise.reject(original)));
    const cause = error.cause as Error;

    expect(cause).toBeInstanceOf(Error);
    expect(cause).not.toBe(original);
    expect(cause.name).toBe('Error');
    expect(cause.message).not.toContain(SECRET);
    expect(cause.stack).not.toContain(SECRET);
    expect(cause.stack).toContain('at BookingApi.get (src/api/booking-api.ts:23:5)');
  });
});

test.describe('expectStatus() body excerpt', () => {
  test('redacts a token in the body of an unexpected status', async () => {
    const error = await failureOf(expectStatus(fakeResponse(200, `{"token":"${SECRET}"}`), 401));

    expect(error.message).not.toContain(SECRET);
    expect(error.message).toContain('[contract] https://example.test/api/auth/login: expected 401, got 200.');
    expect(error.message).toContain('Body: {"token":"<redacted>"}');
  });

  test('redacts a token cut off by the 500-character excerpt', async () => {
    // The value starts at character 494, so the excerpt ends six characters into it.
    const body = `${'x'.repeat(485)}"token":"${SECRET}"}`;

    const error = await failureOf(expectStatus(fakeResponse(200, body), 401));

    expect(error.message).not.toContain(SECRET.slice(0, 6));
    expect(error.message).toContain('"token":"<redacted>');
  });

  test('passes without reading the body when the status matches', async () => {
    let bodyRead = false;
    const response = {
      status: () => 200,
      text: async () => {
        bodyRead = true;
        return '';
      },
      url: () => 'https://example.test/x',
    } as unknown as FakeResponse;

    await expectStatus(response, 200);

    expect(bodyRead).toBe(false);
  });
});
