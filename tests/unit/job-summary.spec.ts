import { test, expect } from '@playwright/test';
import { renderSummary, type SummaryTest } from '../../src/reporting/job-summary-reporter';

// Offline tests for the GitHub Actions job summary: pure string rendering, no files or network.

const passed = (title: string): SummaryTest => ({
  title,
  location: 'tests/api/x.spec.ts:1',
  outcome: 'expected',
  cleanupWarnings: [],
});

test.describe('job summary', () => {
  test('summarises an all-pass run with counts, duration and the run link', () => {
    const markdown = renderSummary({
      status: 'passed',
      durationMs: 8700,
      tests: [passed('[api] A › one'), passed('[api] A › two')],
      runUrl: 'https://github.com/o/r/actions/runs/1',
    });

    expect(markdown).toBe(
      [
        '## Playwright results: passed',
        '',
        '| Passed | Failed | Flaky | Skipped | Duration |',
        '|---|---|---|---|---|',
        '| 2 | 0 | 0 | 0 | 8.7s |',
        '',
        '[View this workflow run](https://github.com/o/r/actions/runs/1)',
        '',
      ].join('\n'),
    );
  });

  test('lists failed tests with location and an error excerpt', () => {
    const markdown = renderSummary({
      status: 'failed',
      durationMs: 1000,
      tests: [
        passed('[api] A › ok'),
        {
          title: '[api] Booking API › updates a booking',
          location: 'tests/api/booking.spec.ts:41',
          outcome: 'unexpected',
          error: 'Error: [contract] expected 200, got 500\nline 2',
          cleanupWarnings: [],
        },
      ],
    });

    expect(markdown).toContain('| 1 | 1 | 0 | 0 | 1.0s |');
    expect(markdown).toContain('### Failed tests');
    expect(markdown).toContain('- **[api] Booking API › updates a booking** (`tests/api/booking.spec.ts:41`)');
    expect(markdown).toContain('  ~~~\n  Error: [contract] expected 200, got 500\n  line 2\n  ~~~');
    expect(markdown).not.toContain('Flaky tests');
  });

  test('lists flaky tests separately from failures', () => {
    const markdown = renderSummary({
      status: 'passed',
      durationMs: 500,
      tests: [
        {
          title: '[chromium] Home page › shows rooms',
          location: 'tests/ui/home.spec.ts:4',
          outcome: 'flaky',
          error: 'Timeout',
          cleanupWarnings: [],
        },
      ],
    });

    expect(markdown).toContain('| 0 | 0 | 1 | 0 | 0.5s |');
    expect(markdown).toContain('### Flaky tests (passed on retry)\n- **[chromium] Home page › shows rooms**');
    expect(markdown).not.toContain('### Failed tests');
  });

  test('counts skipped tests without listing them', () => {
    const markdown = renderSummary({
      status: 'passed',
      durationMs: 0,
      tests: [passed('[unit] a'), { ...passed('[unit] b'), outcome: 'skipped' }],
    });

    expect(markdown).toContain('| 1 | 0 | 0 | 1 | 0.0s |');
    expect(markdown).not.toContain('[unit] b');
  });

  test('lists cleanup warnings with their test', () => {
    const markdown = renderSummary({
      status: 'passed',
      durationMs: 100,
      tests: [
        {
          ...passed('[api] Booking API › deletes a booking'),
          cleanupWarnings: ['#7 (Auto-x): ownership check returned 500; not deleted'],
        },
      ],
    });

    expect(markdown).toContain(
      '### Cleanup warnings\n- [api] Booking API › deletes a booking: #7 (Auto-x): ownership check returned 500; not deleted',
    );
  });

  test('never prints tokens, cookies, authorization headers or passwords', () => {
    const error = [
      'Body: {"token":"abc123secret","password":"hunter2"}',
      'Cookie: token=abc123secret',
      'authorization: Bearer abc123secret',
      'url?token=abc123secret&x=1',
    ].join('\n');
    const markdown = renderSummary({
      status: 'failed',
      durationMs: 0,
      tests: [{ ...passed('[api] t'), outcome: 'unexpected', error, cleanupWarnings: ['token=abc123secret'] }],
    });

    expect(markdown).not.toContain('abc123secret');
    expect(markdown).not.toContain('hunter2');
  });

  test('masks a JSON token value cut off before its closing quote', () => {
    const truncatedBody = 'Body: {"bookings":[],"token":"eyJabc123secret'; // excerpt ends mid-value

    expect(
      renderSummary({
        status: 'failed',
        durationMs: 0,
        tests: [{ ...passed('[api] t'), outcome: 'unexpected', error: truncatedBody, cleanupWarnings: [] }],
      }),
    ).not.toContain('eyJabc123secret');
  });

  test('keeps only the first lines of a long error and cannot close the code fence early', () => {
    const error = ['~~~ injected', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join('\n');
    const markdown = renderSummary({
      status: 'failed',
      durationMs: 0,
      tests: [{ ...passed('[api] t'), outcome: 'unexpected', error, cleanupWarnings: [] }],
    });

    expect(markdown).toContain('  ~ ~ ~ injected');
    expect(markdown).toContain('  line 6\n  ~~~');
    expect(markdown).not.toContain('line 7');
  });
});
