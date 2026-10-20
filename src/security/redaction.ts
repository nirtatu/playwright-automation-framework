import { stripVTControlCharacters } from 'node:util';

// Shared, offline-safe redaction for text that can reach logs, annotations, reports and the job
// summary: assertion messages with response bodies, and Playwright call logs with request headers.
// It covers the formats this framework produces; it is not a general-purpose secret scanner.

export function redact(text: string): string {
  return (
    stripVTControlCharacters(text) // ANSI colour and control sequences from Playwright errors
      // Masks up to the closing quote, a line break or the end of the text, so a value cut off by
      // truncation (e.g. the 500-character body excerpt) is still hidden.
      .replace(/("(?:token|password)"\s*:\s*")[^"\n]*/gi, '$1<redacted>')
      .replace(/(\btoken=)[^;\s"&]+/gi, '$1<redacted>')
      .replace(/(\b(?:cookie|authorization)\s*:\s*)[^\n]+/gi, '$1<redacted>')
  );
}

/**
 * A copy of `error` with its message and stack redacted, keeping the error type. Use it instead of
 * the original as an error `cause`, because reporters print the cause chain.
 */
export function redactError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(redact(String(error)));
  const copy = new Error(redact(error.message));
  copy.name = error.name;
  copy.stack = error.stack === undefined ? undefined : redact(error.stack);
  return copy;
}
