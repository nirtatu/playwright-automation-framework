import type { Page } from '@playwright/test';
import { HomePage } from '../../src/pages/home-page';
import { MOCK_BRANDING, mockBranding } from '../../src/ui/branding';
import { MOCK_ROOMS, isRoomsListResponse, mockExternalImages, mockRoomsList } from '../../src/ui/rooms';
import { test, expect } from '../../src/ui/ui-test';

// Branding-driven content with mocked data: the test answers the browser's GET /api/branding and
// GET /api/room, the logo on the reserved image host and the location map's OpenStreetMap tiles. The
// page itself (HTML, scripts, styles, analytics beacon) still comes from the live site, so it needs the
// site to be up and is not offline. Read-only; the shared UI fixture fails the test on any blocked API
// write or uncaught page error.

const MAP_TILE_HOST = 'tile.openstreetmap.org';

/** Records `<METHOD> <path>` for every request the page sends to an `/api/` path, in order. */
function recordApiRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) requests.push(`${request.method()} ${pathname}`);
  });
  return requests;
}

test.describe('Home page content (mocked branding API)', { tag: '@mock' }, () => {
  test('renders the hero and location details from the branding response', async ({ page, baseURL }, testInfo) => {
    const home = new HomePage(page);

    // Everything is registered before navigation: the page fetches branding, then rooms, once loaded.
    const { apiRequests, branding, rooms, logo, tiles } =
      await test.step('Arrange: record API requests and mock branding, rooms, logo and map tiles', async () => ({
        apiRequests: recordApiRequests(page),
        branding: await mockBranding(page, MOCK_BRANDING, baseURL),
        rooms: await mockRoomsList(page, MOCK_ROOMS),
        // MOCK_ROOMS use same-site images, so the only request to the reserved image host is the logo.
        logo: await mockExternalImages(page),
        tiles: await mockExternalImages(page, MAP_TILE_HOST),
      }));

    await test.step('Act: open the home page', async () => {
      // The rooms are requested only after the branding has rendered the page.
      const roomsResponse = page.waitForResponse(isRoomsListResponse);
      await home.goto();
      await roomsResponse;
    });

    await test.step('Verify: the hero shows the branding name, description and logo', async () => {
      expect(
        branding.fulfilled,
        'the page requested GET /api/branding and the mock answered it',
      ).toBeGreaterThanOrEqual(1);
      expect(rooms.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);
      await expect(home.hero.getByRole('heading', { level: 1 }), 'the hero greets with the branding name').toHaveText(
        `Welcome to ${MOCK_BRANDING.name}`,
      );
      await expect(home.hero, 'the hero shows the branding description').toContainText(MOCK_BRANDING.description);
      // The hero renders the logo as its inline CSS background image, which the browser loads once the
      // visible hero is rendered; polled, because that request can follow the heading assertion.
      await expect
        .poll(() => logo.fulfilled, { message: 'the hero requested the branding logo and the mock answered it' })
        .toBeGreaterThanOrEqual(1);
    });

    await test.step('Verify: the location section shows the branding contact details', async () => {
      // Scoped to the location section: the footer repeats some of the contact details.
      for (const value of [
        MOCK_BRANDING.contact.phone,
        MOCK_BRANDING.contact.email,
        MOCK_BRANDING.address.postCode,
        MOCK_BRANDING.directions,
      ]) {
        await expect(home.location, `the location section shows "${value}" from the branding`).toContainText(value);
      }
    });

    await test.step('Verify: the page sent only the two mocked API requests', () => {
      // Every API request was one the mocks answer, so none reached the live API.
      expect([...new Set(apiRequests)].sort(), 'API requests sent by the page').toEqual([
        'GET /api/branding',
        'GET /api/room',
      ]);
    });

    // Not asserted: whether and how many map tiles load depends on the map's layout below the fold
    // and its own loading, so the count is recorded only. Any tile that is requested is answered.
    testInfo.annotations.push({ type: 'observed-requests', description: `map tiles answered: ${tiles.fulfilled}` });
  });
});
