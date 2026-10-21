import { main } from './report-scan.ts';

// Command-line entry point for the report scan. It always runs the scan: there is no check of
// how it was invoked that could silently skip it. Exit codes: 0 clean, 1 credential patterns
// found, 2 scan error or unexpected failure. Anything other than 0 means "do not publish".
//
// Usage: node --experimental-strip-types scripts/report-scan-cli.ts <report-dir>

try {
  process.exitCode = main(process.argv.slice(2));
} catch {
  console.log('report-scan: FAILED, not safe to publish: unexpected error');
  process.exitCode = 2;
}
