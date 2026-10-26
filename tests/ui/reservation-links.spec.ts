import { HomePage } from '../../src/pages/home-page';
import { MOCK_ROOMS, isRoomsListResponse, mockRoomsList } from '../../src/ui/rooms';
import { test, expect } from '../../src/ui/ui-test';

// Default reservation dates with mocked room data and a fixed browser clock. The page itself (HTML,
// scripts, styles, branding, analytics beacon) still comes from the live site, so this needs it to be
// up and is not offline. Read-only: links are read, never clicked; the shared UI fixture fails the test
// on any blocked API write or uncaught page error.

// UTC makes the fixed instant below one unambiguous calendar date.
test.use({ timezoneId: 'UTC' });

// Noon UTC, far from a day boundary. Local-versus-UTC handling near midnight is not asserted.
const FIXED_NOW = new Date('2030-03-15T12:00:00Z');
const TODAY = '2030-03-15';
const TOMORROW = '2030-03-16';

test.describe('Reservation links (mocked rooms API, fixed clock)', { tag: '@mock' }, () => {
  test('links each mocked room to its reservation page with today and tomorrow as default dates', async ({ page }) => {
    const home = new HomePage(page);

    const mock = await test.step('Arrange: fix the clock and mock the rooms list', async () => {
      // Before navigation, so the page sees the fixed date from its first script.
      await page.clock.setFixedTime(FIXED_NOW);
      return mockRoomsList(page, MOCK_ROOMS);
    });

    await test.step('Act: open the home page', async () => {
      const roomsResponse = page.waitForResponse(isRoomsListResponse);
      await home.goto();
      await roomsResponse;
    });

    await test.step("Verify: each card links to its own room's reservation page", async () => {
      expect(mock.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);
      await expect(home.roomCards, 'one card per mocked room').toHaveCount(MOCK_ROOMS.length);

      // Each card, found by the room type it displays (unique in MOCK_ROOMS), links to exactly that
      // room's reservation page on this site, with today and tomorrow as the default dates. The href is
      // the relative path the page builds, so a link to another host, another room, other dates or extra
      // query parameters fails here.
      for (const room of MOCK_ROOMS) {
        await expect(
          home.bookNowLinkForRoom(room.type),
          `the "${room.type}" card links to room ${room.roomid}'s reservation page`,
        ).toHaveAttribute('href', `/reservation/${room.roomid}?checkin=${TODAY}&checkout=${TOMORROW}`);
      }
    });
  });
});
