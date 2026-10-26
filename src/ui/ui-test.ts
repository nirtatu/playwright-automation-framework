import { test as base, expect } from '@playwright/test';
import { blockApiWrites } from './api-write-guard';

/**
 * Playwright `test` for UI specs. Every test that imports it automatically gets:
 * - service workers blocked, because requests a service worker handles would bypass the guard;
 * - the API write guard (`blockApiWrites`) on its browser context, installed before the test body runs;
 * - uncaught page errors recorded from every page in that browser context, popups included (the
 *   context's `weberror` event);
 * - at teardown, one assertion that no API write was blocked and no page error occurred, reporting both
 *   lists. It runs even when the test itself has failed.
 *
 * The guard's own limits apply: it only aborts non-GET requests to `/api/` paths. Non-GET requests to
 * other paths, WebSocket traffic, requests sent outside the browser and GET requests with side effects
 * are not covered.
 */
export const test = base.extend<{ uiSafety: void }>({
  serviceWorkers: 'block',

  uiSafety: [
    async ({ page }, use) => {
      const blockedWrites = await blockApiWrites(page);
      const pageErrors: string[] = [];
      page.context().on('weberror', (webError) => pageErrors.push(webError.error().message));

      await use();

      expect(
        { blockedWrites, pageErrors },
        'no API write attempts (blocked before reaching the server) and no uncaught page errors',
      ).toEqual({ blockedWrites: [], pageErrors: [] });
    },
    { auto: true },
  ],
});

export { expect };
