# Playwright Automation Framework

[![Playwright Tests](https://github.com/nirtatu/playwright-automation-framework/actions/workflows/playwright.yml/badge.svg?branch=main)](https://github.com/nirtatu/playwright-automation-framework/actions/workflows/playwright.yml)

UI and API test automation framework built with [Playwright Test](https://playwright.dev) and TypeScript, written against a shared public environment where test data must be created, isolated and cleaned up safely.

## Application under test

[Restful Booker Platform](https://automationintesting.online) from Automation in Testing: a public demo hotel-booking application with a UI and a REST API. It shapes most of the design decisions below:

- **It is shared.** Many people use it at the same time, so tests cannot rely on existing records and must never modify or delete data they did not create.
- **It resets periodically.** Data, including booking IDs, can disappear or be reused between two requests.
- **It is not always consistent.** Some endpoints have returned different status codes for the same situation (for example 500 or 403 for an unauthenticated request).

Because the API tests create and delete real bookings there, they run only when triggered deliberately (see [Continuous integration](#continuous-integration)).

## Observed results

The counts below were observed in one earlier run of each workflow. They are a snapshot, not a guarantee: later runs can fail, and the counts change as tests are added or removed. For the current state, see the badge above and the workflow's run history.

| Workflow | Tests selected | Observed in one run |
|---|---|---|
| [Playwright Tests](https://github.com/nirtatu/playwright-automation-framework/actions/workflows/playwright.yml) (automatic) | Unit tests, UI tests and the read-only rooms API test | 110 passed, 0 failed, 0 flaky, 0 skipped (observed in an earlier run). |
| API Tests (live, manual only) | Full API suite against the public demo site, including booking writes and cleanup | 11 passed, 0 failed, 0 flaky, 0 skipped in 31.8s ([workflow run](https://github.com/nirtatu/playwright-automation-framework/actions/runs/39733574245)) |

[Latest published report](https://nirtatu.github.io/playwright-automation-framework/): the HTML report of the most recent successful push to `main`. It is replaced on every such push, so its counts can differ from the snapshot above.

The booking write tests do not run on every push; see [Continuous integration](#continuous-integration) for why.

## Test coverage

| Suite | Location | What is tested | Runs |
|---|---|---|---|
| Authentication API | `tests/api/auth.spec.ts` | Valid login returns a token; a wrong password is rejected with 401 and returns no token | Manual workflow |
| Booking API | `tests/api/booking.spec.ts` | Create and read back; update (verified by a follow-up read); delete (then 404); missing first name rejected with 400 and a field error; check-out before check-in rejected with 409; overlapping booking for the same room rejected with 409; an unauthenticated read exposes nothing; an unauthenticated delete leaves the booking intact | Manual workflow |
| Rooms API | `tests/api/rooms.spec.ts` | The room list has the expected shape (read-only) | Every push and pull request, and the manual workflow |
| UI: rooms section | `tests/ui/home.spec.ts` | "shows the rooms section with at least one bookable room": the "Our Rooms" heading and a first "Book now" link to a reservation page (live data, read-only) | Every push and pull request |
| UI: rooms match the API | `tests/ui/home.spec.ts` | "renders only rooms from its rooms API response, each with matching type, price and reservation link": at least one card is rendered, and every card is a room from the `GET /api/room` response the page received during load, at most once, with that room's type as title, its nightly price, and a "Book now" link to `/reservation/<roomid>` with check-in and check-out dates. The page need not render every room in the response (it rendered 3 of 4 on 2026-10-26), so the card count is not asserted; the counts read once the first card is visible are recorded as an `observed-rendering` annotation that says they may not be the complete result (live data, read-only; compared with that same response, not a second request) | Every push and pull request |
| UI: rendering with mocked rooms | `tests/ui/home-rendering.spec.ts` | "renders exactly the mocked rooms with their type, price and reservation link": the browser's `GET /api/room` is answered by the test with three fixed rooms (ids, types and prices unlike the live data); the test asserts the mock answered the page's request, then that exactly one card per mocked room shows its type, nightly price and a "Book now" link to `/reservation/<roomid>`, and that the page raised no uncaught JavaScript errors (mocked rooms data, read-only; the page itself still loads from the live site) | Every push and pull request |
| UI: rendering more than three mocked rooms | `tests/ui/home-rendering.spec.ts` | "renders only the first three rooms when more than three are supplied": five mocked rooms, the second with an image on an external host that the test answers itself; the page renders exactly three cards (the shipped code renders the first three rooms of the response), the first three supplied rooms in page order, each with its type and price (mocked rooms and image, read-only; the page itself still loads from the live site) | Every push and pull request |
| UI: content from mocked branding | `tests/ui/home-content.spec.ts` | "renders the hero and location details from the branding response": `GET /api/branding` and `GET /api/room` are answered by the test with distinct-value data; the hero shows "Welcome to {name}" and the description, and the location section shows the phone, email, postcode and directions; the only API requests the page sends are those two (mocked branding, rooms, logo and map tiles, read-only; the page itself still loads from the live site) | Every push and pull request |
| UI: default reservation dates | `tests/ui/reservation-links.spec.ts` | "links each mocked room to its reservation page with today and tomorrow as default dates": with the browser clock fixed at noon UTC on 2030-03-15 (timezone UTC) and `GET /api/room` answered by the test, the test asserts the mock was used and that there is one card per mocked room, then finds each card by the room type it displays and asserts its "Book now" link's exact `href`, `/reservation/<that room's id>?checkin=2030-03-15&checkout=2030-03-16`, so a link to another host, another room, other dates or with extra query parameters fails. Links are read, not clicked; the reservation page itself is not covered (mocked rooms data and fixed clock, read-only; the page itself still loads from the live site) | Every push and pull request |
| Unit (offline) | `tests/unit/` | Cleanup engine, free-window search, redaction, failure messages, job summary rendering, warning output and the report scanner. Most use in-memory fakes; a few report-scanner tests start nested Playwright runs (one in Chromium) and the scanner CLI as local processes, without network requests | Every push and pull request |

UI tests are tagged `@live` (rooms data from the live backend) or `@mock` (rooms data answered by the test); both kinds load the page itself from the live site, so neither is offline. UI tests are read-only: every UI spec imports `test` from the shared UI fixture (`src/ui/ui-test.ts`, enforced by ESLint), which installs a write guard on each test's browser context that aborts non-GET requests to `/api/` paths from any page in that context, including popups, before they reach the server, and fails the test if any was attempted or any page in that context raised an uncaught JavaScript error. Like the API tests, UI tests are organised in `Arrange` / `Act` / `Verify` steps (`test.step`), which the HTML report shows per test. The guard only covers non-GET requests under `/api/`: it does not intercept non-GET requests to other paths (such as the site's analytics beacon), WebSocket traffic, requests sent outside the browser, or GET requests with side effects (details under [Architecture](#architecture)). The UI booking flow is not covered yet.

## Architecture

```
tests/api, tests/ui            specs: assert application behaviour through fixtures and API clients
        │
src/fixtures/api.ts            fixtures: adminToken, bookingApi, slot (free room/date window), createBooking
        │
        ├── src/api/           API clients: send each request once, return raw responses
        │                      (send/expectStatus label failures as transport, infrastructure or contract),
        │                      plus booking-checks.ts: assertion helpers shared by the booking specs
        ├── src/data/          booking types, builders, unique markers, free-window search
        └── src/cleanup/       cleanup engine: create tracking, ownership-checked delete, recovery
                               (depends only on injected interfaces, no Playwright or HTTP imports)

src/pages/                     page objects for the UI tests: locators and readers, no assertions
src/ui/api-write-guard.ts      aborts and records non-GET /api/ requests from UI tests
src/ui/branding.ts             GET /api/branding matcher, distinct-value MOCK_BRANDING and a counted mock
src/ui/rooms.ts                GET /api/room matcher and response reader (readRoomsList), fixed rooms data
                               (MOCK_ROOMS, MANY_MOCK_ROOMS) and a counted mock for @mock tests;
                               mockExternalImages answers external images and map tiles
src/ui/ui-test.ts              shared UI `test`: guard, service-worker blocking, page-error check

src/security/redaction.ts      masks token, cookie, authorization and password values in failure
                               messages, transport errors and the job summary
src/reporting/                 custom reporter that writes the GitHub Actions job summary
scripts/report-scan*.ts        scans the HTML report for credential patterns before it is published

tests/unit                     offline unit tests for the modules above: in-memory fakes, plus a few
                               report-scanner tests that run nested Playwright and CLI processes locally
```

- **API clients** (`src/api/*-api.ts`) wrap Playwright's request context, send each request once and return the raw response without asserting; specs decide what a status means. Assertions live in the specs and in shared helpers: `src/api/booking-checks.ts` holds booking assertion helpers (`createValidBooking`, and `expectStillOwned`, the ownership check before an in-test write), and `expectStatus` (`src/api/http.ts`) labels a wrong status as `[infrastructure]` (502, 503, 504) or `[contract]` (anything else), and `send` turns a request with no response into a `TransportError`, so a report shows which kind of failure occurred.
- **Fixtures** (`src/fixtures/api.ts`) wire the layers together: a fresh admin token per test, a room and date window checked free of existing bookings, and a `createBooking` function whose bookings are cleaned up in teardown.
- **Page objects** (`src/pages/`) expose locators and readers that return plain data; specs make the assertions, as with the API clients. `HomePage.readRoomCards()` reads the cards rendered at that moment, without waiting, so specs wait on the card locator first: for the full count where it is known (the three-room mocks, and the five-room mock, which waits for exactly three cards because the page renders only the first three rooms), otherwise only for the first card to be visible (the live rooms-match test, whose room count depends on the shared data, and which then reads whatever has rendered by then; the page has no render-complete signal). It throws a `[page]` error for a card without exactly one "Book now" link and one title, or whose link path or price cannot be parsed, so it never returns partial values.
- **UI write guard** (`src/ui/api-write-guard.ts`) routes `/api/` requests on the test's browser context, so it covers every page in that context, including popups: GET requests continue unchanged, any other method is aborted before it is sent and recorded, and the record is checked at teardown. It is applied through the shared UI fixture (`src/ui/ui-test.ts`): a spec that imports `test` from it automatically gets service workers blocked (requests a service worker handles would bypass the routing), the guard installed before the test body runs, uncaught page errors recorded from every page in the context, popups included (the context's `weberror` event), and one teardown assertion that reports both blocked writes and page errors, also when the test itself has failed. ESLint enforces its use: in `tests/ui`, importing `test` from `@playwright/test`, using the `request`, `browser` or `playwright` fixtures or `page.request` / `context.request` (requests the guard does not see, or new contexts without it), and importing the API fixtures, environment config or API clients (other than types and `src/api/http.ts`) are lint errors. In `tests/ui`, `src/ui` and `src/pages`, a local type-aware rule (`local/no-route-guard-bypass`) also rejects `route.continue()` and `route.fetch()` on Playwright's `Route`: a page-level handler that continues a request, or fetches it from Node, sends it without the guard seeing it, so mocks use `route.fallback()` or `route.fulfill()`. Not covered: non-GET requests outside `/api/`, which are not routed at all (such as the site's Cloudflare analytics beacon), WebSocket traffic, requests sent outside the browser (such as Playwright's `request` fixture), and GET requests with side effects.
- **Cleanup engine** (`src/cleanup/booking-cleanup.ts`) holds every safety rule for test data. The fixture adapts the real API clients to its small interfaces; the unit tests pass fakes instead.
- **Offline unit tests are enforced, not just intended.** ESLint forbids `src/cleanup`, `src/data`, `src/security`, `scripts` and `tests/unit` from importing the API clients, fixtures or environment config, and forbids unit tests from using the `request`, `page`, `context`, `browser` or `playwright` fixtures. The one exception is `src/api/http.ts`, whose redaction is unit-tested and which makes no requests on import.
- **Type-aware linting** (`no-floating-promises`, `no-misused-promises`) catches a missing `await` on a request or assertion, which would otherwise let a test pass or fail for the wrong reason.

## Design decisions and trade-offs

- **API-first test data.** Tests create the bookings they need through the API and never depend on existing records. *Trade-off:* the UI booking flow itself is not covered yet.
- **Ownership-marker cleanup.** Every booking gets a unique last name (`Auto-…`). Cleanup deletes only bookings the test created, and only after a fresh read shows the exact marker. In-test updates and deletes are guarded the same way. *Trade-off:* an extra request per write, and a race with an environment reset (which reuses booking IDs) is narrowed but cannot be ruled out.
- **Isolated date windows.** Each test books inside a 30-day window, 2–12 years ahead, in a room checked for existing bookings in that window just before the test, so collisions with other users' data are very unlikely.
- **Bounded recovery, never blind retries.** Creates are sent once and never retried. A create without a clear answer is recovered by a read-only search for its exact marker, adopted only if exactly one booking matches. Cleanup logs in again at most once, only after the token is confirmed invalid, and never re-sends a DELETE without a fresh ownership check. In-flight creates get a bounded wait (35s, within a 60s fixture budget). *Trade-off:* a create that completes after the recovery search can leave a booking behind; it is reported with its marker, room and check-in date rather than hidden.
- **Cleanup never fails a test.** Problems become `cleanup-warning` annotations in the HTML report, console lines (GitHub Actions warning annotations on CI) and a section of the job summary, so a cleanup issue never hides the real test result.
- **Outcomes over unstable status codes.** Unauthenticated tests assert the security outcome (nothing exposed, booking intact) and only record the status as an `observed-status` annotation, because the live site has answered both 500 and 403.
- **Read-only checks separated from live writes.** Every push and pull request runs only tests that do not write to the shared site. Booking write tests run in a manual workflow that runs one at a time and is never cancelled automatically, because cancelling skips the teardown that deletes test data. *Trade-off:* write coverage is not exercised on every pull request.
- **Offline unit tests for the safety logic.** Every cleanup branch (ownership check, recovery, re-login, late creates, free-window boundaries) is tested with fakes that fail on any unscripted call. They run on Playwright Test itself, so no second test runner is needed. *Trade-off:* the thin fixture adapter is exercised only by live runs.
- **Redaction and a pre-publication scan for a public report.** Failure messages and the job summary mask credential values, API tests are not traced (traces record request headers and bodies; only a manual `--trace` override re-enables it), and the published report is scanned before deployment. *Trade-off:* both are pattern-based: they cover the formats this framework produces and cannot guarantee that every secret is detected.
- **Serial execution (`workers: 1`)** on a shared environment, until isolation and stability justify more parallelism.
- **TypeScript 6.0.3 is pinned** because `typescript-eslint` does not support TypeScript 7 yet, and the type-aware lint rules need it.

## Project structure

```
.github/workflows/
  playwright.yml              automatic: pushes and PRs to main; read-only tests; publishes the report
  api-live.yml                manual only: full API suite, writes to the target
src/
  api/                        auth-api.ts, booking-api.ts, room-api.ts (clients), http.ts (send, expectStatus),
                              booking-checks.ts (booking assertion helpers)
  cleanup/                    booking-cleanup.ts (tracking and cleanup), warning-output.ts
  config/env.ts               admin credentials from environment variables
  data/booking-data.ts        booking types, builders, unique markers, free-window search
  fixtures/api.ts             Playwright fixtures for the API tests
  pages/home-page.ts          HomePage page object (rooms section, room-card and reservation-link readers)
  reporting/                  job-summary-reporter.ts (GitHub Actions job summary)
  security/redaction.ts       shared redaction of credential values
  ui/api-write-guard.ts       blocks API writes from UI tests
  ui/branding.ts              GET /api/branding matcher, mocked branding data and mock for @mock tests
  ui/rooms.ts                 GET /api/room matcher and readRoomsList, mocked rooms data (MOCK_ROOMS,
                              MANY_MOCK_ROOMS), the rooms mock for @mock tests and mockExternalImages
                              (external-image and map-tile answers)
  ui/ui-test.ts               shared UI test fixture (guard, service workers, page errors)
scripts/
  report-scan.ts              HTML report scanner
  report-scan-cli.ts          command-line entry point (npm run report:scan)
tests/
  api/                        auth.spec.ts, booking.spec.ts (write to the target), rooms.spec.ts (read-only)
  ui/                         home.spec.ts (live data), home-rendering.spec.ts and
                              reservation-links.spec.ts (mocked rooms API), home-content.spec.ts
                              (mocked branding API); all read-only
  unit/                       booking-cleanup, booking-data, http-redaction, job-summary, redaction,
                              report-scan and warning-output specs (offline); support/ holds the
                              report scanner's synthetic report builders
playwright.config.ts          projects: api, chromium, unit
eslint.config.mjs, .prettierrc, .prettierignore, tsconfig.json
```

## Getting started

**Prerequisites:** Node.js 22 or later.

```bash
npm ci
npx playwright install chromium   # for the UI tests and one report-scanner unit test (nested browser run)
```

### Configuration

Settings are read from environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `https://automationintesting.online` | Target environment for API and UI tests |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | The public demo credentials published by the application (see `src/config/env.ts`) | Admin login for the API tests |

No secrets are needed for the default target, and the workflows use none. The project does not load a `.env` file automatically (`.env` is git-ignored). To keep settings in one, export it into the shell first:

```bash
set -a; source .env; set +a
npm run test:ui
```

### Commands

**Offline checks (no requests to `BASE_URL`):**

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-check the project |
| `npm run lint` | ESLint, including type-aware and Playwright rules (zero warnings allowed) |
| `npm run format:check` | Check Prettier formatting (`npm run format` applies it) |
| `npm run test:unit` | Offline unit tests. A few report-scanner tests start nested Playwright runs and the scanner CLI as local processes; one needs Chromium installed and builds its page with `setContent`, aborting every request |
| `npx playwright test --list` | List all tests without running them; add `--grep` or `--grep-invert` to preview what a tag filter selects |
| `npm run report` | Open the last HTML report locally |
| `npm run report:scan` | Scan `playwright-report/` for credential patterns (exit code 0 = clean) |

**Contacts the live site, read-only (requests to `BASE_URL`, no booking data written):**

| Command | What it does |
|---|---|
| `npm run test:ui` | UI tests in Chromium. They load the live page and the rooms it requests, so they are not offline |
| `npm test -- tests/unit/ tests/ui/ tests/api/rooms.spec.ts` | The automatic CI test selection: the offline unit tests plus the live UI tests and the live rooms API test |

The API specs differ in what they do on the live service. `tests/api/rooms.spec.ts` (`GET /api/room`) and `tests/api/auth.spec.ts` (admin login, a `POST` that changes no booking data) contact it without writing booking data. `tests/api/booking.spec.ts` creates, updates and deletes bookings; the commands that run it are listed under "Writes to the configured target" below.

**Test tags.** `@live` marks tests that contact the live target; `@writes` marks tests that create, update or delete booking data on the configured target. Preview a selection with `--list` before running it:

| Command | What it lists |
|---|---|
| `npx playwright test --list --grep @writes` | Tests that create, update or delete booking data (currently the booking API tests) |
| `npx playwright test --list --grep-invert @live` | Tests not tagged `@live`. Currently `tests/ui/home.spec.ts` is untagged, so this includes that live UI test alongside the unit tests: it is **not** an offline selection |

Tags are filters, not runtime safety guards: they only decide which tests a command selects, and a filter is only reliable when every relevant test is correctly tagged. An untagged test is silently included by `--grep-invert`. Likewise, `--grep-invert @writes` leaves out the tagged write tests but still runs the live read-only tests (UI, rooms and auth API), so it is not an offline selection either. For an offline run, use `npm run test:unit`.

**Writes to the configured target:**

| Command | What it does |
|---|---|
| `npm run test:api` | Full API suite. **Creates, updates and deletes bookings on `BASE_URL`** |
| `npm test` | Every project, including the API suite. **Creates, updates and deletes bookings on `BASE_URL`** |

> **Warning:** the API suite sends real requests to `BASE_URL` (by default the public demo site) and creates, updates and deletes bookings there. Check `BASE_URL` before running it, and never point it at an environment where test bookings are not allowed.

## Continuous integration

| Workflow | Trigger | Runs |
|---|---|---|
| **Playwright Tests** (`playwright.yml`) | Pushes and pull requests to `main` | Type check, lint, format check, then unit tests, UI tests and the read-only rooms API test. It never writes to the target |
| **API Tests (live, manual only)** (`api-live.yml`) | Manual only | Type check, lint, format check, then the full API suite (`npm run test:api`), including booking writes |

The automatic workflow selects tests by path. New UI and unit specs are included automatically; a new API spec runs on every push only if it is added to the list in `playwright.yml`, so API tests that write data stay manual by default.

**Running the live API workflow.** In the repository's **Actions** tab, select **API Tests (live, manual only)**, then **Run workflow** on `main`. Only one run executes at a time and a new run never cancels one in progress. Avoid cancelling a run manually, because that skips the teardown that deletes test bookings.

**Diagnostics.** On CI, Playwright's `github` reporter annotates failing and flaky tests, and a custom reporter (`src/reporting/job-summary-reporter.ts`) writes a job summary with counts, failed and flaky tests with a redacted error excerpt, and any cleanup warnings. Both workflows upload the HTML report and test results (screenshots, videos and traces where recorded) as artifacts kept for 14 days.

**Published HTML report.** After a successful push to `main`, the automatic workflow publishes its HTML report to [GitHub Pages](https://nirtatu.github.io/playwright-automation-framework/). Pull requests, failed runs and the manual live workflow are never published.

- The page is public. It shows test titles, file paths, errors, environment details and commit metadata (hash, message, author and committer names and emails). Source diffs and per-step source snippets are left out.
- `npm run report:scan` runs first and blocks publication if it finds credential patterns in the report data, attachments or traces, or if it cannot read something (it fails closed). A blocked scan does not change the test result; the previous report stays online.
- Only the deploy job has Pages permissions; the test job keeps a read-only token.

## Debugging

- `npx playwright test --ui`: interactive UI mode
- `npx playwright test --debug`: step through with the Playwright Inspector
- `npx playwright show-trace test-results/<test>/trace.zip`: open a recorded trace

Screenshots and videos are kept for failing tests. Traces are recorded on the first retry (tracing is off for the API project), and retries are enabled only on CI.
