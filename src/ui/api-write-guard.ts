import type { Page } from '@playwright/test';

/** A non-GET request to an `/api/` path that the guard aborted before it was sent. */
export interface BlockedApiWrite {
  method: string;
  url: string;
}

/**
 * Blocks API writes from a UI test. Installed on the page's browser context, so it covers every page
 * in that context, including popups: a non-GET request whose path starts with `/api/` (on any origin)
 * is aborted in the browser before it reaches the server, and recorded. GET requests continue
 * unchanged (to the network, or to a mock route registered later). Requests outside `/api/` are not
 * routed, so the site's Cloudflare `/cdn-cgi/rum` beacon still goes out.
 *
 * Not covered: requests handled by a service worker (the shared UI fixture in `ui-test.ts` blocks
 * service workers for this reason), WebSocket traffic, requests sent outside the browser (such as the
 * `request` fixture), and GET requests that have side effects.
 *
 * Returns the list of blocked attempts; the shared UI fixture asserts it is empty at teardown.
 */
export async function blockApiWrites(page: Page): Promise<BlockedApiWrite[]> {
  const blocked: BlockedApiWrite[] = [];
  await page.context().route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fallback();
        return;
      }
      blocked.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
    },
  );
  return blocked;
}
