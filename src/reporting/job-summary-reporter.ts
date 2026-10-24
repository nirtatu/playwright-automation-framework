import { appendFileSync } from 'node:fs';
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { redact } from '../security/redaction';

// GitHub Actions job summary: counts, duration, failed and flaky tests, and cleanup warnings.
// Registered only on GitHub Actions (playwright.config.ts) and writes only when
// GITHUB_STEP_SUMMARY is set, so local runs are unaffected.

export interface SummaryTest {
  /** Project and title path, e.g. "[api] Booking API › Booking lifecycle › updates a booking". */
  title: string;
  /** File and line, e.g. "tests/api/booking.spec.ts:41". */
  location: string;
  outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  /** First error of the failing attempt (unexpected and flaky tests only). */
  error?: string;
  cleanupWarnings: string[];
}

interface SummaryInput {
  status: FullResult['status'];
  durationMs: number;
  tests: SummaryTest[];
  /** Link to the workflow run, when known. */
  runUrl?: string;
}

const MAX_ERROR_LINES = 8;

export function renderSummary({ status, durationMs, tests, runUrl }: SummaryInput): string {
  const count = (outcome: SummaryTest['outcome']) => tests.filter((t) => t.outcome === outcome).length;
  const failed = tests.filter((t) => t.outcome === 'unexpected');
  const flaky = tests.filter((t) => t.outcome === 'flaky');
  const warnings = tests.flatMap((t) => t.cleanupWarnings.map((warning) => ({ title: t.title, warning })));

  const lines = [
    `## Playwright results: ${status}`,
    '',
    '| Passed | Failed | Flaky | Skipped | Duration |',
    '|---|---|---|---|---|',
    `| ${count('expected')} | ${failed.length} | ${flaky.length} | ${count('skipped')} | ${(durationMs / 1000).toFixed(1)}s |`,
  ];
  if (failed.length) lines.push('', '### Failed tests', ...failed.flatMap(describeTest));
  if (flaky.length) lines.push('', '### Flaky tests (passed on retry)', ...flaky.flatMap(describeTest));
  if (warnings.length) {
    lines.push('', '### Cleanup warnings', ...warnings.map(({ title, warning }) => `- ${title}: ${redact(warning)}`));
  }
  if (runUrl) lines.push('', `[View this workflow run](${runUrl})`);
  return `${lines.join('\n')}\n`;
}

function describeTest(test: SummaryTest): string[] {
  const lines = [`- **${test.title}** (\`${test.location}\`)`];
  if (test.error) {
    const excerpt = redact(test.error).replace(/~~~/g, '~ ~ ~').split('\n').slice(0, MAX_ERROR_LINES);
    lines.push('', '  ~~~', ...excerpt.map((line) => `  ${line}`), '  ~~~');
  }
  return lines;
}

export default class JobSummaryReporter implements Reporter {
  private rootSuite?: Suite;

  onBegin(_config: unknown, suite: Suite): void {
    this.rootSuite = suite;
  }

  onEnd(result: FullResult): void {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryFile || !this.rootSuite) return;
    const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
    const runUrl =
      GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
        ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
        : undefined;
    const markdown = renderSummary({
      status: result.status,
      durationMs: result.duration,
      tests: this.rootSuite.allTests().map(toSummaryTest),
      runUrl,
    });
    appendFileSync(summaryFile, markdown);
  }

  printsToStdio(): boolean {
    return false;
  }
}

function toSummaryTest(test: TestCase): SummaryTest {
  const outcome = test.outcome();
  const failedAttempt = test.results.find((result) => result.errors.length > 0);
  const projectName = test.parent.project()?.name;
  const title = test
    .titlePath()
    .filter((part, index) => index > 2 && part !== '') // drop root, project and file (shown as location)
    .join(' › ');
  return {
    title: projectName ? `[${projectName}] ${title}` : title,
    location: `${test.location.file.replace(`${process.cwd()}/`, '')}:${test.location.line}`,
    outcome,
    error: outcome === 'unexpected' || outcome === 'flaky' ? failedAttempt?.errors[0]?.message : undefined,
    cleanupWarnings: [
      ...new Set(
        test.results.flatMap((result) =>
          result.annotations.filter((a) => a.type === 'cleanup-warning').map((a) => a.description ?? ''),
        ),
      ),
    ],
  };
}
