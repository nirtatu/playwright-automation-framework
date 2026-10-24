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
    // Before navigation, so the page sees the fixed date from its first script.
    await page.clock.setFixedTime(FIXED_NOW);
    const mock = await mockRoomsList(page, MOCK_ROOMS);
    const home = new HomePage(page);
    const roomsResponse = page.waitForResponse(isRoomsListResponse);
    await home.goto();
    await roomsResponse;
    expect(mock.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);

    const expected = MOCK_ROOMS.map(({ roomid }) => ({ roomid, checkin: TODAY, checkout: TOMORROW }));
    await expect(home.roomCards, 'one card per mocked room').toHaveCount(expected.length);
    const links = (await home.readReservationLinks()).sort((a, b) => a.roomid - b.roomid);
    expect(links, `each card links to /reservation/<roomid> with checkin ${TODAY} and checkout ${TOMORROW}`).toEqual(
      expected,
    );
  });
});
