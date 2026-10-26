import { expectStatus } from '../../src/api/http';
import { HomePage } from '../../src/pages/home-page';
import { MOCK_BRANDING, mockBranding } from '../../src/ui/branding';
import { isRoomsListResponse, mockExternalImages, mockRoomsListResponse } from '../../src/ui/rooms';
import { test, expect } from '../../src/ui/ui-test';

// Room-list states with mocked GET /api/room responses: an empty list, and the site's failure shape
// (500 with `[]`, which the site's proxy returns when it fails). The page reads `rooms` from the body
// and falls back to an empty list, so in both cases the rooms section renders without cards. Branding
// and its logo are mocked too, so the page renders without the live API. The page itself (HTML,
// scripts, styles, analytics beacon) still comes from the live site, so these tests need it to be up
// and are not offline. Read-only; the shared UI fixture fails the test on any blocked API write or
// uncaught page error, so these tests also show the page does not crash.

test.describe('Home page room-list states (mocked rooms API)', { tag: '@mock' }, () => {
  test('shows the rooms section without cards when the rooms API returns an empty list', async ({ page, baseURL }) => {
    const home = new HomePage(page);

    const { branding, rooms } = await test.step('Arrange: mock branding and an empty rooms list', async () => ({
      branding: await mockBranding(page, MOCK_BRANDING, baseURL),
      // MOCK_BRANDING's logo is on the reserved image host.
      logo: await mockExternalImages(page),
      rooms: await mockRoomsListResponse(page, { status: 200, json: { rooms: [] } }),
    }));

    const response = await test.step('Act: open the home page', async () => {
      // Registered before navigation: the page fetches the rooms itself once it has loaded.
      const roomsResponse = page.waitForResponse(isRoomsListResponse);
      await home.goto();
      return roomsResponse;
    });

    await test.step('Verify: the rooms section is shown with no cards and no "Book now" links', async () => {
      expect(
        branding.fulfilled,
        'the page requested GET /api/branding and the mock answered it',
      ).toBeGreaterThanOrEqual(1);
      expect(rooms.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);
      await expectStatus(response, 200, 'mocked GET /api/room');
      await expect(home.roomsHeading).toBeVisible();
      await expect(home.roomCards, 'no room cards for an empty list').toHaveCount(0);
      await expect(home.bookNowLinks, 'no "Book now" links for an empty list').toHaveCount(0);
    });
  });

  test('shows the rooms section without cards when the rooms API fails', async ({ page, baseURL }) => {
    const home = new HomePage(page);

    const { branding, rooms } =
      await test.step('Arrange: mock branding and the failed rooms response (500 with [])', async () => ({
        branding: await mockBranding(page, MOCK_BRANDING, baseURL),
        logo: await mockExternalImages(page),
        rooms: await mockRoomsListResponse(page, { status: 500, json: [] }),
      }));

    const response = await test.step('Act: open the home page', async () => {
      const roomsResponse = page.waitForResponse(isRoomsListResponse);
      await home.goto();
      return roomsResponse;
    });

    await test.step('Verify: the rooms section is shown with no cards and no "Book now" links', async () => {
      expect(
        branding.fulfilled,
        'the page requested GET /api/branding and the mock answered it',
      ).toBeGreaterThanOrEqual(1);
      expect(rooms.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);
      await expectStatus(response, 500, 'mocked GET /api/room');
      await expect(home.roomsHeading).toBeVisible();
      await expect(home.roomCards, 'no room cards when the rooms API fails').toHaveCount(0);
      await expect(home.bookNowLinks, 'no "Book now" links when the rooms API fails').toHaveCount(0);
    });
  });
});
