import type { Page } from '@playwright/test';
import { blockApiWrites } from '../../src/ui/api-write-guard';
import { MOCK_ROOMS, mockRoomsListResponse } from '../../src/ui/rooms';
import { test, expect } from '../../src/ui/ui-test';

// Offline tests of the UI write guard (src/ui/api-write-guard.ts). The pages are served by the test
// from a fake origin on the reserved `.invalid` TLD, which cannot resolve, so no request can reach the
// demo site or any other host; every request the context sends is recorded and checked to be on that
// origin.
//
// Each test installs its own instance of the guard (`blockApiWrites`) so it can assert on what was
// blocked. It is registered after the shared fixture's guard, so it runs first and the fixture's guard
// never sees the attempts: the fixture's teardown check stays green. That check is the same function
// with the same recording; its teardown failure is not exercised here.

const FAKE_ORIGIN = 'https://write-guard.invalid';

/**
 * Serves every request to FAKE_ORIGIN from the test, at the context level so popups are covered: an
 * HTML page for any non-API path and a 404 for any GET to `/api/` that no page mock answered. Non-GET
 * `/api/` requests fall back to the write guard. Returns the requests it served and every request the
 * context sent.
 */
async function serveFakeOrigin(page: Page): Promise<{ served: string[]; sent: string[] }> {
  const served: string[] = [];
  const sent: string[] = [];
  const context = page.context();
  context.on('request', (request) => sent.push(request.url()));
  await context.route(
    (url) => url.origin === FAKE_ORIGIN,
    async (route) => {
      const method = route.request().method();
      const { pathname } = new URL(route.request().url());
      if (method !== 'GET' && pathname.startsWith('/api/')) {
        await route.fallback();
        return;
      }
      served.push(`${method} ${pathname}`);
      if (pathname.startsWith('/api/')) {
        await route.fulfill({ status: 404, json: { error: 'not mocked' } });
        return;
      }
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Write guard fixture</title>' });
    },
  );
  return { served, sent };
}

type FetchOutcome = { status: number; text: string } | { error: string };

/** Sends `fetch(path)` from the page and reports the response, or the error if the fetch rejected. */
function fetchFrom(page: Page, method: 'GET' | 'POST', path: string): Promise<FetchOutcome> {
  return page.evaluate(
    async ({ method, path }) => {
      try {
        const response = await fetch(path, { method, body: method === 'POST' ? 'write attempt' : undefined });
        return { status: response.status, text: await response.text() };
      } catch (error) {
        return { error: String(error) };
      }
    },
    { method, path },
  );
}

function expectOnlyFakeOrigin(sent: string[]): void {
  expect(
    sent.filter((url) => new URL(url).origin !== FAKE_ORIGIN),
    `every request went to ${FAKE_ORIGIN}`,
  ).toEqual([]);
}

test.describe('UI write guard (offline, fake origin)', { tag: '@offline' }, () => {
  test('blocks and records a POST to an API path before it reaches the server', async ({ page }) => {
    const { served, sent, blocked } =
      await test.step('Arrange: serve the fake origin and install the guard', async () => {
        const origin = await serveFakeOrigin(page);
        const guard = await blockApiWrites(page);
        await page.goto(`${FAKE_ORIGIN}/`);
        return { ...origin, blocked: guard };
      });

    const outcome = await test.step('Act: POST to /api/booking from the page', () =>
      fetchFrom(page, 'POST', '/api/booking'));

    await test.step('Verify: the request was aborted, recorded and never served', () => {
      expect(outcome, 'the page sees the aborted request as a failed fetch').toEqual({ error: expect.any(String) });
      expect(blocked, 'the guard recorded the attempt').toEqual([
        { method: 'POST', url: `${FAKE_ORIGIN}/api/booking` },
      ]);
      expect(served, 'only the page itself was served').toEqual(['GET /']);
      expectOnlyFakeOrigin(sent);
    });
  });

  test('lets a page mock answer a GET, and still blocks a POST to the mocked path', async ({ page }) => {
    const { served, sent, blocked, mock } =
      await test.step('Arrange: serve the fake origin, install the guard and mock GET /api/room', async () => {
        const origin = await serveFakeOrigin(page);
        const guard = await blockApiWrites(page);
        const roomsMock = await mockRoomsListResponse(page, { status: 200, json: { rooms: MOCK_ROOMS } });
        await page.goto(`${FAKE_ORIGIN}/`);
        return { ...origin, blocked: guard, mock: roomsMock };
      });

    const read = await test.step('Act: GET /api/room from the page', () => fetchFrom(page, 'GET', '/api/room'));

    await test.step('Verify: the mock answered the GET and nothing was blocked', () => {
      expect(read, 'the page received the mocked rooms').toEqual({
        status: 200,
        text: JSON.stringify({ rooms: MOCK_ROOMS }),
      });
      expect(mock.fulfilled, 'the page mock answered the GET').toBe(1);
      expect(blocked, 'the guard blocked nothing').toEqual([]);
    });

    const write = await test.step('Act: POST to the same mocked path', () => fetchFrom(page, 'POST', '/api/room'));

    await test.step('Verify: the mock passed the POST on and the guard blocked it', () => {
      expect(write, 'the page sees the aborted request as a failed fetch').toEqual({ error: expect.any(String) });
      expect(mock.fulfilled, 'the page mock did not answer the POST').toBe(1);
      expect(blocked, 'the guard recorded the attempt').toEqual([{ method: 'POST', url: `${FAKE_ORIGIN}/api/room` }]);
      expect(served, 'only the page itself was served').toEqual(['GET /']);
      expectOnlyFakeOrigin(sent);
    });
  });

  test('blocks a POST from a popup opened in the same browser context', async ({ page }) => {
    const { served, sent, blocked } =
      await test.step('Arrange: serve the fake origin and install the guard', async () => {
        const origin = await serveFakeOrigin(page);
        const guard = await blockApiWrites(page);
        await page.goto(`${FAKE_ORIGIN}/`);
        return { ...origin, blocked: guard };
      });

    const popup = await test.step('Act: open a popup from the page', async () => {
      const popupPromise = page.waitForEvent('popup');
      await page.evaluate(() => {
        window.open('/popup');
      });
      const opened = await popupPromise;
      await opened.waitForLoadState();
      return opened;
    });

    const outcome = await test.step('Act: POST to /api/booking from the popup', () =>
      fetchFrom(popup, 'POST', '/api/booking'));

    await test.step('Verify: the popup was guarded: the request was aborted, recorded and never served', () => {
      expect(outcome, 'the popup sees the aborted request as a failed fetch').toEqual({ error: expect.any(String) });
      expect(blocked, 'the guard recorded the popup attempt').toEqual([
        { method: 'POST', url: `${FAKE_ORIGIN}/api/booking` },
      ]);
      expect(served, 'only the two pages were served').toEqual(['GET /', 'GET /popup']);
      expectOnlyFakeOrigin(sent);
    });
  });
});
