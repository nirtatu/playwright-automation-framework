import { HomePage } from '../../src/pages/home-page';
import { MOCK_ROOMS, isRoomsListResponse, mockRoomsList } from '../../src/ui/rooms';
import { test, expect } from '../../src/ui/ui-test';

// Rendering with mocked room data: the test answers the browser's GET /api/room, so these tests do
// not depend on the shared site's rooms. The page itself (HTML, scripts, styles, branding, analytics
// beacon) still comes from the live site, so they need it to be up and are not offline. Read-only;
// the shared UI fixture fails the test on any blocked API write or uncaught page error.

test.describe('Home page rendering (mocked rooms API)', { tag: '@mock' }, () => {
  test('renders exactly the mocked rooms with their type, price and reservation link', async ({ page }) => {
    const mock = await mockRoomsList(page, MOCK_ROOMS);
    const home = new HomePage(page);
    // Registered before navigation: the page fetches the rooms itself once it has loaded.
    const roomsResponse = page.waitForResponse(isRoomsListResponse);
    await home.goto();
    await roomsResponse;
    expect(mock.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);

    const expected = MOCK_ROOMS.map(({ roomid, type, roomPrice }) => ({ roomid, type, roomPrice }));
    await expect(home.roomCards, 'one card per mocked room').toHaveCount(expected.length);
    const displayed = (await home.readRoomCards()).sort((a, b) => a.roomid - b.roomid);
    expect(displayed, 'each card shows the mocked type and price, linked by the mocked room id').toEqual(expected);
  });
});
