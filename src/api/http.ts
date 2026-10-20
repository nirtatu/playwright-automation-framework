import { expect, type APIResponse } from '@playwright/test';
import { redactError, redact } from '../security/redaction';

/**
 * No HTTP response was received at all (DNS, connection reset, timeout). Playwright's error includes
 * a call log with every request header (e.g. `cookie: token=…`), so both the message and the
 * attached cause are redacted copies. Method, URL and error type stay visible.
 */
export class TransportError extends Error {
  constructor(description: string, cause: unknown) {
    const safeCause = redactError(cause);
    super(`[transport] ${description}: ${safeCause.message}`, { cause: safeCause });
    this.name = 'TransportError';
  }
}

/** Sends a request once. Failures without a response are rethrown as TransportError. */
export async function send(description: string, request: () => Promise<APIResponse>): Promise<APIResponse> {
  try {
    return await request();
  } catch (error) {
    throw new TransportError(description, error);
  }
}

// Gateway errors mean the request never reached a working application.
const INFRASTRUCTURE_STATUSES = new Set([502, 503, 504]);

/**
 * Asserts the status code. The failure message is labelled [infrastructure] for gateway errors
 * and [contract] for everything else, so reports show which kind of failure occurred.
 */
export async function expectStatus(response: APIResponse, expected: number, context?: string): Promise<void> {
  const status = response.status();
  if (status === expected) return;
  const kind = INFRASTRUCTURE_STATUSES.has(status) ? 'infrastructure' : 'contract';
  // Redacted after truncation: an unexpected success (e.g. a login) could return a token.
  const body = redact((await response.text().catch(() => '<unreadable body>')).slice(0, 500));
  const where = context ? ` (${context})` : '';
  expect(status, `[${kind}]${where} ${response.url()}: expected ${expected}, got ${status}. Body: ${body}`).toBe(
    expected,
  );
}
