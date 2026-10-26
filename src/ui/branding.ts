import type { Page } from '@playwright/test';
import { EXTERNAL_IMAGE_HOST } from './rooms';

// Branding helpers for UI tests: a deterministic GET /api/branding response and its mock.

// Same shape as the live GET /api/branding response. Every field has a distinct value (unlike the
// live data, where the name, contact name and first address line coincide, and the description
// equals the directions), so a test can tell which field the page rendered where. The logo is on the
// reserved image host that mockExternalImages answers.
export const MOCK_BRANDING = {
  name: 'Mocked Meadows B&B',
  map: { latitude: 52.6351, longitude: 1.2993 },
  logoUrl: `https://${EXTERNAL_IMAGE_HOST}/logo.jpg`,
  description: 'Mocked hero description for the UI tests.',
  directions: 'Mocked directions: follow the test signs to the door.',
  contact: { name: 'Mock Contact', phone: '01234 000111', email: 'mock-contact@example.test' },
  address: {
    line1: 'Mock House',
    line2: '1 Mock Lane',
    postTown: 'Mocktown',
    county: 'Mockshire',
    postCode: 'MO1 1CK',
  },
};

/** True for the branding endpoint on `origin` only (the page requests it relative to its own URL). */
export const isBranding = (url: URL, origin: string) => url.origin === origin && url.pathname === '/api/branding';

/**
 * Answers the page's GET /api/branding on the origin of `baseURL` (pass Playwright's `baseURL`
 * fixture) with `branding`, before it reaches the network. Other methods fall through to the write
 * guard. Returns a counter of answered requests, so a test can prove the mock was used rather than
 * silently rendering live data.
 */
export async function mockBranding(
  page: Page,
  branding: unknown,
  baseURL: string | undefined,
): Promise<{ fulfilled: number }> {
  if (!baseURL) throw new Error('[setup] mockBranding needs the baseURL from the Playwright config');
  const origin = new URL(baseURL).origin;
  const counter = { fulfilled: 0 };
  // A page route takes precedence over the write guard's context route.
  await page.route(
    (url) => isBranding(url, origin),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      counter.fulfilled += 1;
      await route.fulfill({ json: branding });
    },
  );
  return counter;
}
