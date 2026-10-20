import { test, expect } from '@playwright/test';
import { cleanupWarningLine } from '../../src/cleanup/warning-output';

test.describe('cleanup warning output', () => {
  test('keeps the plain console line locally', () => {
    expect(
      cleanupWarningLine('deletes a booking', '#7 (Auto-x): ownership check returned 500; not deleted', false),
    ).toBe('[cleanup-warning] deletes a booking: #7 (Auto-x): ownership check returned 500; not deleted');
  });

  test('emits a GitHub warning annotation with the same text on GitHub Actions', () => {
    expect(
      cleanupWarningLine('deletes a booking', '#7 (Auto-x): ownership check returned 500; not deleted', true),
    ).toBe(
      '::warning title=cleanup-warning::[cleanup-warning] deletes a booking: #7 (Auto-x): ownership check returned 500; not deleted',
    );
  });

  test('escapes characters that would break the workflow command', () => {
    expect(cleanupWarningLine('title', '100% done\r\nsecond line', true)).toBe(
      '::warning title=cleanup-warning::[cleanup-warning] title: 100%25 done%0D%0Asecond line',
    );
  });
});
