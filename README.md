# Playwright Automation Framework

[![Playwright Tests](https://github.com/nirtatu/playwright-automation-framework/actions/workflows/playwright.yml/badge.svg?branch=main)](https://github.com/nirtatu/playwright-automation-framework/actions/workflows/playwright.yml)

UI and API test automation framework built with [Playwright Test](https://playwright.dev) and TypeScript.

**Application under test:** [Restful Booker Platform](https://automationintesting.online). It is a public demo hotel-booking app with a UI and a REST API.

## Status

| Phase | State |
|---|---|
| 1. Walking skeleton | Implemented: TypeScript setup, one API test and one UI test, validated locally |
| 2. Basic CI | Implemented: GitHub Actions workflow (`.github/workflows/playwright.yml`) runs the type check and tests on pushes and pull requests to `main`. Verified on GitHub |
| 3. API coverage | Implemented: auth and booking API tests (`tests/api/`), run once locally against the live site with all tests passing. They run in CI only through the manual workflow (`.github/workflows/api-live.yml`). Neither the manual workflow nor the main workflow's updated test selection has run on GitHub yet |
| 4+ | Not implemented yet |

## Prerequisites

- Node.js 22+

## Setup

```bash
npm ci
npx playwright install chromium
```

## Running tests

| Command | What it does |
|---|---|
| `npm test` | Run all tests, including the API suite, which **creates and deletes bookings** |
| `npm run test:api` | Run API tests only (no browser). **Creates and deletes bookings**; see [API tests](#api-tests) |
| `npm run test:ui` | Run UI tests in Chromium |
| `npm run typecheck` | Type-check the project |
| `npm run report` | Open the last HTML report |

Run against another environment with `BASE_URL=https://example.test npm test`.

## API tests

> **Warning:** the API suite sends real requests to the configured `BASE_URL` (by default the public demo site) and **creates and deletes bookings** there. Check `BASE_URL` before running it, and never point it at an environment where test bookings are not allowed.

### Coverage

| Area | What is tested |
|---|---|
| Authentication | Login with valid credentials returns a token; a wrong password is rejected with 401 |
| Booking CRUD | Create and read back, update (checked with a follow-up read), delete (then 404) |
| Validation | A booking without a first name is rejected with 400 and a field error; check-out before check-in is rejected with 409 |
| Overlapping bookings | A second booking for the same room and dates is rejected with 409 |
| Unauthenticated access | A read without a token does not succeed and does not expose the booking; a delete without a token leaves the booking intact |
| Rooms | The room list has the expected shape (read-only) |

### Running locally

```bash
npm run test:api
```

No browser is needed. Admin credentials default to the public demo values; override them with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

### Test data and cleanup

- Every booking has a unique last name (`Auto-…`) that acts as an ownership marker. Bookings are placed in a room and date window (2–12 years ahead) checked free of existing bookings first.
- Tests only target bookings they created. Cleanup deletes them in fixture teardown, re-checking the exact marker immediately before each delete. This makes deleting someone else's booking very unlikely, but a race with an environment reset (which reuses booking IDs) cannot be ruled out.
- Cleanup is best-effort and never fails a test. Problems appear as `cleanup-warning` annotations in the HTML report and as `[cleanup-warning]` lines in the console. Each warning names the booking ID or marker; warnings about unconfirmed creates also give the room and check-in date.
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
| **Playwright Tests** (`playwright.yml`) | Pushes and pull requests to `main` | Type check, UI tests, and the read-only rooms API test. It never creates or deletes bookings |
| **API Tests (live, manual only)** (`api-live.yml`) | Manual only (**Run workflow**) | Type check and the full API suite (`npm run test:api`), including the booking write tests |

The automatic workflow selects its tests by file path. A new API spec runs on every push only if it is added explicitly to that list, so API tests that write data stay manual by default. New UI specs under `tests/ui/` are included automatically.

## Debugging

- `npx playwright test --ui`: interactive UI mode
- `npx playwright test --debug`: step through with the Playwright Inspector
- `npx playwright show-trace test-results/<test>/trace.zip`: open a recorded trace

Screenshots and videos are kept for failing tests. Traces are recorded on the first retry, and retries are enabled only on CI.

## Design notes

- **Shared public environment.** The target app is used by many people and resets its data periodically. Tests therefore check structure ("at least one room with these fields") rather than specific records.
- **Serial execution (`workers: 1`).** Parallelism will be increased only after test isolation and stability have been demonstrated.
- **Two projects.** `api` runs without launching a browser; `chromium` runs the UI tests.
