// Decision for tests that write to BASE_URL. Pure (no process.env), so it can be unit-tested; the
// API fixtures in src/fixtures/api.ts pass in the environment values and enforce the result.
// Writes are allowed only when ALLOW_LIVE_WRITES is exactly 'true'. Otherwise write tests are
// skipped locally, and fail on CI so that a workflow missing the flag cannot pass with its write
// tests silently skipped.

export type LiveWriteDecision = 'allow' | 'skip' | 'fail';

export function liveWriteDecision(allowLiveWrites: string | undefined, ci: boolean): LiveWriteDecision {
  if (allowLiveWrites === 'true') return 'allow';
  return ci ? 'fail' : 'skip';
}
