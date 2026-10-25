import { test, expect } from '@playwright/test';
import { liveWriteDecision } from '../../src/config/live-writes';

// Offline: the decision behind the ALLOW_LIVE_WRITES guard in src/fixtures/api.ts.

test.describe('live-write guard decision', () => {
  test('allows writes when ALLOW_LIVE_WRITES is exactly "true", locally and on CI', () => {
    expect(liveWriteDecision('true', false)).toBe('allow');
    expect(liveWriteDecision('true', true)).toBe('allow');
  });

  // Missing, disabled, or anything other than exactly 'true'.
  for (const value of [undefined, '', 'false', '0', '1', 'yes', 'TRUE', 'True', ' true', 'true ']) {
    const label = value === undefined ? 'unset' : JSON.stringify(value);

    test(`skips locally and fails on CI when ALLOW_LIVE_WRITES is ${label}`, () => {
      expect(liveWriteDecision(value, false)).toBe('skip');
      expect(liveWriteDecision(value, true)).toBe('fail');
    });
  }
});
