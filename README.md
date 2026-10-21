# Playwright Automation Framework

[![Playwright Tests](https://github.com/nirtatu/playwright-automation-framework/actions/workflows/playwright.yml/badge.svg?branch=main)](https://github.com/nirtatu/playwright-automation-framework/actions/workflows/playwright.yml)

UI and API test automation framework built with [Playwright Test](https://playwright.dev) and TypeScript, written against a shared public environment where test data must be created, isolated and cleaned up safely.

**Application under test:** [Restful Booker Platform](https://automationintesting.online) from Automation in Testing. It is a public demo hotel-booking app with a UI and a REST API, used by many people at once and reset periodically.

## Status

| Phase | State |
|---|---|
| 1. Walking skeleton | Implemented: TypeScript setup, one API test and one UI test, validated locally |
| 2. Basic CI | Implemented: GitHub Actions workflow (`.github/workflows/playwright.yml`) runs the checks and tests on pushes and pull requests to `main`. The Phase 2 version was verified on GitHub |
| 3. API coverage | Implemented: auth and booking API tests (`tests/api/`), run once locally against the live site with all tests passing. The Phase 3 version of the automatic workflow was verified on GitHub at commit `f24c11f` (run `39283100497`: type check, the UI test and the read-only rooms API test passed). The manual live workflow (`.github/workflows/api-live.yml`) has not run on GitHub yet |
| 4. Quality gates | Implemented locally, not yet pushed: ESLint and Prettier checks, the cleanup engine extracted and covered by offline unit tests, and cleanup warnings emitted as GitHub Actions annotations. None of this has run on GitHub yet, including how the annotations render |
| 5+ | Not implemented yet |

## Architecture

```
tests/api, tests/ui       specs: assert behaviour through fixtures and API clients
        │
src/fixtures/api.ts       fixtures: adminToken, bookingApi, slot (free room/date window), createBooking
        │
        ├── src/api/          API clients: send each request once, return raw responses
        │                     (send/expectStatus label failures as transport, infrastructure or contract)
        └── src/cleanup/      cleanup engine: create tracking, ownership-checked delete, recovery
                              (depends only on injected interfaces, no Playwright or HTTP imports)

tests/unit                offline unit tests for src/cleanup and src/data, using in-memory fakes
```

- **API clients** (`src/api/`) wrap Playwright's request context. They contain no assertions; specs decide what a status means. The read-only rooms test and the unauthenticated booking tests call the request context directly (still through `send`), the latter deliberately without a token.
- **Fixtures** (`src/fixtures/api.ts`) wire the layers together: a fresh admin token per test, a room and date window checked free of existing bookings, and a `createBooking` function whose bookings are cleaned up in teardown.
- **Cleanup engine** (`src/cleanup/booking-cleanup.ts`) holds every safety rule for test data. The fixture adapts the real API clients to its small interfaces (`bookingsFor`, `validateToken`, `login`); the unit tests pass fakes instead.
- **Unit-test isolation** is structural: ESLint forbids `src/cleanup`, `src/data` and `tests/unit` from importing the API clients, fixtures, config or Playwright's request and browser APIs, and forbids unit tests from using the `request`, `page`, `context`, `browser` or `playwright` fixtures.

## Design decisions and trade-offs

- **API-first test data.** Tests create the bookings they need through the API and never depend on existing records. UI tests are read-only today. *Trade-off:* the UI booking flow itself is not covered yet.
- **Ownership-marker cleanup.** Every booking gets a unique last name (`Auto-…`). Cleanup deletes only bookings this test created, and only after a fresh read shows the exact marker. *Trade-off:* an extra request per delete, and a race with an environment reset (which reuses booking IDs) is narrowed but cannot be ruled out.
- **Bounded recovery, never blind retries.** Creates are sent once and never retried. A create without a clear answer is recovered by a read-only search for its exact marker, adopted only if exactly one booking matches. Cleanup re-logs in at most once, only after the token is confirmed dead, and never re-sends a DELETE without a fresh ownership check. In-flight creates get a bounded wait (35s, within a 60s fixture budget). *Trade-off:* a create that completes after the recovery search can leave a booking behind; it is reported with its marker, room and check-in date rather than hidden.
- **Cleanup never fails a test.** Problems become `cleanup-warning` annotations in the HTML report and console lines (on GitHub Actions, emitted as workflow warning commands), so a cleanup issue never hides the real test result.
- **Outcomes over unstable status codes.** Unauthenticated tests assert the security outcome (nothing exposed, booking intact) and only record the status, because the live site has answered both 500 and 403.
- **Read-only checks separated from live writes.** Every push and pull request runs the type check, lint, format check, unit tests, UI tests and the read-only rooms API test. Booking write tests run only through a manual workflow that never cancels a run mid-way, because cancelling skips teardown. *Trade-off:* write coverage is not exercised on every pull request.
- **Offline unit tests for the safety logic.** Every cleanup branch (ownership check, recovery, re-login, late creates, free-window boundaries) is tested with fakes that fail on any unscripted call. *Trade-off:* the thin fixture adapter is exercised only by live runs.
- **Serial execution (`workers: 1`)** on a shared environment, until isolation and stability justify more parallelism.
- **TypeScript 6.0.3 is pinned** because `typescript-eslint` does not support TypeScript 7 yet, and type-aware lint rules (such as catching a missing `await`) need it.

## Project structure

```
.github/workflows/
  playwright.yml          automatic: pushes and PRs to main, read-only tests only
  api-live.yml            manual only (workflow_dispatch): full API suite, writes to the target
src/
  api/                    auth-api.ts, booking-api.ts, http.ts (send, expectStatus)
  cleanup/                booking-cleanup.ts (tracking and cleanup), warning-output.ts
  config/env.ts           admin credentials from environment variables
  data/booking-data.ts    booking types, builders, unique markers, free-window search
  fixtures/api.ts         Playwright fixtures for the API tests
tests/
  api/                    auth.spec.ts, booking.spec.ts (write to the target), rooms.spec.ts (read-only)
  ui/                     home.spec.ts (read-only)
  unit/                   booking-cleanup.spec.ts, warning-output.spec.ts (offline)
playwright.config.ts      projects: api, chromium, unit
eslint.config.mjs, .prettierrc, .prettierignore, tsconfig.json
```

## Prerequisites

- Node.js 22+

## Setup

```bash
npm ci
npx playwright install chromium   # only needed for the UI tests
```

## Configuration

Settings are read from environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `https://automationintesting.online` | Target environment for API and UI tests |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | The public demo credentials published by the application (see `src/config/env.ts`) | Admin login for the API tests |

The project does not load a `.env` file automatically; `.env` is git-ignored so local values are never committed. To keep settings in a local `.env` file, export it into the shell before running the tests:

```bash
# .env (example; use your own values, never commit real credentials)
BASE_URL=https://your-test-environment.example
ADMIN_USERNAME=your-admin-user
ADMIN_PASSWORD=your-admin-password
```

```bash
set -a; source .env; set +a
npm run test:ui
```

No secrets are needed for the default target, and the workflows use none.

## Commands

**Safe to run any time (no writes to the target):**

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-check the project |
| `npm run lint` | ESLint, including type-aware and Playwright rules (zero warnings allowed) |
| `npm run format:check` | Check Prettier formatting (`npm run format` applies it) |
| `npm run test:unit` | Offline unit tests for the cleanup engine and data helpers |
| `npx playwright test --list` | List all tests without running them |
| `npm run test:ui` | UI tests in Chromium (read-only) |
| `npm test -- tests/unit/ tests/ui/ tests/api/rooms.spec.ts` | The automatic CI test selection: unit, UI and read-only rooms API tests |
| `npm run report` | Open the last HTML report |
| `npm run report:scan` | Scan `playwright-report/` for credential patterns (the check run before publishing; exit 0 = clean) |

**Writes to the configured target:**

| Command | What it does |
|---|---|
| `npm run test:api` | Full API suite. **Creates and deletes bookings on `BASE_URL`** |
| `npm test` | Every project, including the API suite. **Creates and deletes bookings on `BASE_URL`** |

> **Warning:** the API suite sends real requests to the configured `BASE_URL` (by default the public demo site) and **creates and deletes bookings** there. Check `BASE_URL` before running it, and never point it at an environment where test bookings are not allowed.

## API tests

### Coverage

| Area | What is tested |
|---|---|
| Authentication | Login with valid credentials returns a token; a wrong password is rejected with 401 |
| Booking CRUD | Create and read back, update (checked with a follow-up read), delete (then 404) |
| Validation | A booking without a first name is rejected with 400 and a field error; check-out before check-in is rejected with 409 |
| Overlapping bookings | A second booking for the same room and dates is rejected with 409 |
| Unauthenticated access | A read without a token does not succeed and does not expose the booking; a delete without a token leaves the booking intact |
| Rooms | The room list has the expected shape (read-only) |

### Test data and cleanup

- Every booking has a unique last name (`Auto-…`) that acts as an ownership marker. Bookings are placed in a room and date window (2–12 years ahead) checked free of existing bookings first.
- Tests only target bookings they created. Cleanup deletes them in fixture teardown, re-checking the exact marker immediately before each delete. This makes deleting someone else's booking very unlikely, but a race with an environment reset (which reuses booking IDs) cannot be ruled out.
- Cleanup is best-effort and never fails a test. Problems appear as `cleanup-warning` annotations in the HTML report and as `[cleanup-warning]` lines in the console. On GitHub Actions the same text is emitted as a `::warning title=cleanup-warning::` workflow command, intended to appear as a warning annotation on the run (not yet verified on GitHub). Each warning names the booking ID or marker; warnings about unconfirmed creates also give the room and check-in date.
- Responses for unauthenticated requests are recorded as `observed-status` annotations, not asserted: the live site has answered both 500 and 403.

### Running in GitHub Actions (manual only)

The **API Tests (live, manual only)** workflow (`.github/workflows/api-live.yml`) has no automatic triggers. To run it:

1. Open the repository's **Actions** tab.
2. Select **API Tests (live, manual only)**.
3. Click **Run workflow**, choose the branch and confirm.

GitHub lists the workflow only once the file is on the default branch. Only one run executes at a time, and a new run never cancels one in progress, so teardown is not cut short by an overlapping run. Avoid cancelling a run manually for the same reason.

## Continuous integration

| Workflow | Trigger | Runs |
|---|---|---|
| **Playwright Tests** (`playwright.yml`) | Pushes and pull requests to `main` | Type check, lint, format check, then unit tests, UI tests and the read-only rooms API test. It never creates or deletes bookings |
| **API Tests (live, manual only)** (`api-live.yml`) | Manual only (**Run workflow**) | Type check, lint, format check, then the full API suite (`npm run test:api`), including the booking write tests |

The automatic workflow selects its tests by file path (`tests/unit/ tests/ui/ tests/api/rooms.spec.ts`). A new API spec runs on every push only if it is added explicitly to that list, so API tests that write data stay manual by default. New UI and unit specs under `tests/ui/` and `tests/unit/` are included automatically.

On CI, Playwright adds its `github` reporter alongside `list` and `html`, which annotates failing and flaky tests on the run. Both workflows upload the HTML report and test results as artifacts.

**Job summary.** On GitHub Actions, a small custom reporter (`src/reporting/job-summary-reporter.ts`) writes the run's job summary: passed, failed, flaky and skipped counts, duration, failed and flaky tests with a short error excerpt, any cleanup warnings, and a link to the run. Token, cookie, authorization and password values are masked by a shared, pattern-based redactor (`src/security/redaction.ts`) in three places: the job summary, transport-error messages (including their cause), and the response-body excerpt of unexpected-status failures. The redaction is not exhaustive: it matches known formats only, and Playwright's own per-request steps in the HTML report may keep the original, unredacted error. API tests are not traced by default (`trace: 'off'` for the `api` project), so traces do not record their request headers or bodies unless a manual CLI override such as `--trace on` re-enables tracing. A final workflow step adds download links for the two ZIP artifacts; to view the HTML report, unzip it and run `npx playwright show-report <folder>`. Locally, the reporter is not registered and nothing changes. The job summary and artifact links have not run on GitHub yet.

**Published HTML report (GitHub Pages).** After a successful run of the **Playwright Tests** workflow on a push to `main`, the HTML report is published to GitHub Pages at a stable URL that always shows the latest published report: `https://nirtatu.github.io/playwright-automation-framework/`. Pull requests, failed runs and the manual **API Tests (live, manual only)** workflow are never published; their reports stay available as ZIP artifacts.

- **Public:** anyone can open the page without signing in, and search engines may index it. It shows test titles, file paths, durations, errors and attachments of a flaky test's failed attempt, environment details, and commit metadata (hash, message, author and committer names and emails). The source diff is not captured (`captureGitInfo: { commit: true, diff: false }`), and per-step source snippets are left out on that workflow (`PLAYWRIGHT_HTML_NO_SNIPPETS`).
- **Scanned before publishing:** `npm run report:scan` (`scripts/report-scan-cli.ts`, which always runs the scanner in `scripts/report-scan.ts`) reads the report data embedded in `index.html`, every attachment and every ZIP inside them (traces), and blocks publication if it finds credential patterns (token or password JSON values, `token=` values, cookie or authorization headers, cookies in traces). It prints where and which kind of match, never the value. Report file paths and ZIP entry names are scanned as well; in the scan's output, a name appears only when it consists of plain characters (letters, digits, `_`, `.`, `/`, `@`, `-`), and is otherwise replaced by a position label such as `entry #2`. It fails closed: an unreadable, malformed or ambiguous report, an unsupported ZIP feature or layout (for example, data outside the listed entries), or an unexpected error also blocks publication. Files are skipped only when their bytes are a recognised image, video or font format; their names and extensions are not trusted. It is pattern-based and cannot guarantee that every secret is detected: it only knows the formats above (a bare secret value without a recognisable key is not detected, also in a name); only ZIP archives with stored or deflated entries are decompressed, so other compressed data (such as gzip) is scanned as raw bytes; small ZIP header fields (such as timestamps, attributes and checksums) are checked for structure but not scanned; metadata inside images and videos is not read; and Playwright's trace-viewer assets (`trace/`) are not scanned.
- **When the scan does not pass:** the tests keep their own result (a green run stays green), but the scan step records `blocked`, adds a warning to the run, and neither the Pages upload nor the `deploy-report` job runs. The previously published report stays online, and the ZIP artifacts are uploaded as usual.
- **First-time setup, before pushing this to `main`:** a repository admin sets Settings → Pages → Build and deployment → Source: **GitHub Actions**. If this is missing, the `deploy-report` job fails on every push to `main`, so the workflow run (and the status badge) shows as failed even though the tests passed; nothing is published. Only the `deploy-report` job has Pages permissions (`pages: write`, `id-token: write`); the test job keeps a read-only token.
- **Retention:** the Pages artifact is kept for 1 day (it is only needed to deploy); the published site stays online until the next successful publish replaces it.
- Publishing has not run on GitHub yet.

The Phase 4 workflow changes (lint and format steps, unit tests in the automatic selection, the `github` reporter) ran successfully on GitHub in run `39390200870`. The cleanup warning annotations have not been seen on GitHub yet, because the automatic workflow runs no write tests.

## Debugging

- `npx playwright test --ui`: interactive UI mode
- `npx playwright test --debug`: step through with the Playwright Inspector
- `npx playwright show-trace test-results/<test>/trace.zip`: open a recorded trace

Screenshots and videos are kept for failing tests. Traces are recorded on the first retry, and retries are enabled only on CI.

## Design notes

- **Shared public environment.** The target app is used by many people and resets its data periodically. Tests therefore check structure ("at least one room with these fields") rather than specific records.
- **Three projects.** `api` runs without launching a browser, `chromium` runs the UI tests, and `unit` runs offline tests against in-memory fakes (no HTTP client or browser fixture, enforced by ESLint).
