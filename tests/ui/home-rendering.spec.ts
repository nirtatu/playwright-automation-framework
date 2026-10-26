import { HomePage } from '../../src/pages/home-page';
import {
  MANY_MOCK_ROOMS,
  MOCK_ROOMS,
  isRoomsListResponse,
  mockExternalImages,
  mockRoomsList,
} from '../../src/ui/rooms';
import { test, expect } from '../../src/ui/ui-test';

// Rendering with mocked room data: the test answers the browser's GET /api/room, so these tests do
// not depend on the shared site's rooms. The page itself (HTML, scripts, styles, branding, analytics
// beacon) still comes from the live site, so they need it to be up and are not offline. Read-only;
// the shared UI fixture fails the test on any blocked API write or uncaught page error.

test.describe('Home page rendering (mocked rooms API)', { tag: '@mock' }, () => {
  test('renders exactly the mocked rooms with their type, price and reservation link', async ({ page }) => {
    const home = new HomePage(page);

    const mock = await test.step('Arrange: mock the rooms list with three rooms', () =>
      mockRoomsList(page, MOCK_ROOMS));

    await test.step('Act: open the home page', async () => {
      // Registered before navigation: the page fetches the rooms itself once it has loaded.
      const roomsResponse = page.waitForResponse(isRoomsListResponse);
      await home.goto();
      await roomsResponse;
    });

    await test.step('Verify: one card per mocked room, with its type and price', async () => {
      expect(mock.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);
      const expected = MOCK_ROOMS.map(({ roomid, type, roomPrice }) => ({ roomid, type, roomPrice }));
      await expect(home.roomCards, 'one card per mocked room').toHaveCount(expected.length);
      const displayed = (await home.readRoomCards()).sort((a, b) => a.roomid - b.roomid);
      expect(displayed, 'each card shows the mocked type and price, linked by the mocked room id').toEqual(expected);
    });
  });

  // More than three rooms, the second with an external image (answered by the test, so the external
  // host does not matter). The page renders only the first three rooms of the response (the shipped
  // code renders `rooms.slice(0, 3)`); toHaveCount waits for that final count.
  test('renders only the first three rooms when more than three are supplied', async ({ page }) => {
    const home = new HomePage(page);

    const mock = await test.step('Arrange: mock five rooms, one with an external image', async () => {
      const roomsMock = await mockRoomsList(page, MANY_MOCK_ROOMS);
      await mockExternalImages(page);
      return roomsMock;
    });

    await test.step('Act: open the home page', async () => {
      const roomsResponse = page.waitForResponse(isRoomsListResponse);
      await home.goto();
      await roomsResponse;
    });

    await test.step('Verify: exactly the first three supplied rooms are shown, in order', async () => {
      expect(mock.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);
      await expect(home.roomCards, 'exactly three cards for five supplied rooms').toHaveCount(3);
      const displayed = await home.readRoomCards();
      expect(
        displayed.map((card) => card.roomid),
        'the cards are the first three supplied rooms, in page order',
      ).toEqual([921, 922, 923]);
      const supplied = new Map(
        MANY_MOCK_ROOMS.map(({ roomid, type, roomPrice }) => [roomid, { roomid, type, roomPrice }]),
      );
      for (const card of displayed) {
        expect(card, `the card for room ${card.roomid} shows a mocked room's type and price`).toEqual(
          supplied.get(card.roomid),
        );
      }
    });
  });
});
