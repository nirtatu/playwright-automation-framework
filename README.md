# Playwright Automation Framework

UI and API test automation framework built with [Playwright Test](https://playwright.dev) and TypeScript.

**Application under test:** [Restful Booker Platform](https://automationintesting.online). It is a public demo hotel-booking app with a UI and a REST API.

## Status

| Phase | State |
|---|---|
| 1. Walking skeleton | Implemented: TypeScript setup, one API test and one UI test, validated locally |
| 2. Basic CI | Implemented: GitHub Actions workflow (`.github/workflows/playwright.yml`), validated locally. Not yet verified on GitHub |
| 3+ | Not implemented yet |

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
| `npm test` | Run all tests |
| `npm run test:api` | Run API tests only (no browser) |
| `npm run test:ui` | Run UI tests in Chromium |
| `npm run typecheck` | Type-check the project |
| `npm run report` | Open the last HTML report |

Run against another environment with `BASE_URL=https://example.test npm test`.

## Debugging

- `npx playwright test --ui`: interactive UI mode
- `npx playwright test --debug`: step through with the Playwright Inspector
- `npx playwright show-trace test-results/<test>/trace.zip`: open a recorded trace

Screenshots and videos are kept for failing tests. Traces are recorded on the first retry, and retries are enabled only on CI.

## Design notes

- **Shared public environment.** The target app is used by many people and resets its data periodically. Tests therefore check structure ("at least one room with these fields") rather than specific records.
- **Serial execution (`workers: 1`).** Parallelism will be increased only after test isolation and stability have been demonstrated.
- **Two projects.** `api` runs without launching a browser; `chromium` runs the UI tests.
