import { HomePage } from '../../src/pages/home-page';
import {
  EXTERNAL_IMAGE_ROOM_ID,
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

const SUPPLIED_IDS = MANY_MOCK_ROOMS.map((room) => room.roomid);

/**
 * The `observed-rendering` annotation. Always inconclusive: the page has no render-complete signal,
 * so the cards are read once the first is visible and a partial render cannot be ruled out. It names
 * the candidate rule the read ids are consistent with, if any, without claiming that rule is the
 * page's behaviour.
 */
function observedRendering(displayedIds: number[], externalImagesAnswered: number): string {
  const candidates: [string, number[]][] = [
    ['all supplied rooms, in order', SUPPLIED_IDS],
    ['the first three supplied rooms', SUPPLIED_IDS.slice(0, 3)],
    ['every supplied room except the external-image room', SUPPLIED_IDS.filter((id) => id !== EXTERNAL_IMAGE_ROOM_ID)],
  ];
  const match = candidates.find(([, ids]) => JSON.stringify(ids) === JSON.stringify(displayedIds));
  const consistency = match ? `consistent with "${match[0]}"` : 'consistent with no candidate rule';
  return (
    `inconclusive (no render-complete signal; read once the first card was visible): rendered ` +
    `${JSON.stringify(displayedIds)} of ${JSON.stringify(SUPPLIED_IDS)}, ${consistency} ` +
    `(external-image room ${EXTERNAL_IMAGE_ROOM_ID}; external image requests answered: ${externalImagesAnswered})`
  );
}

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

  // More than three rooms, one with an external image (answered by the test, so the external host does
  // not matter). Asserts only what holds whatever the rendering rule is: at least one card, and each
  // card is a mocked room with its type and price. The rule itself (all rooms, the first three, or all
  // but the external-image room) is not established, and the page has no render-complete signal to
  // read it reliably, so it is recorded as an inconclusive `observed-rendering` annotation, not asserted.
  test('renders only supplied rooms when more than three are mocked, one with an external image', async ({
    page,
  }, testInfo) => {
    const mock = await mockRoomsList(page, MANY_MOCK_ROOMS);
    const images = await mockExternalImages(page);
    const home = new HomePage(page);
    const roomsResponse = page.waitForResponse(isRoomsListResponse);
    await home.goto();
    await roomsResponse;
    expect(mock.fulfilled, 'the page requested GET /api/room and the mock answered it').toBeGreaterThanOrEqual(1);

    await expect(home.roomCards.first(), 'at least one room card is rendered').toBeVisible();
    const displayed = await home.readRoomCards();
    const displayedIds = displayed.map((card) => card.roomid);
    expect(new Set(displayedIds).size, `each room has at most one card, got ${JSON.stringify(displayedIds)}`).toBe(
      displayedIds.length,
    );
    const supplied = new Map(
      MANY_MOCK_ROOMS.map(({ roomid, type, roomPrice }) => [roomid, { roomid, type, roomPrice }]),
    );
    for (const card of displayed) {
      expect(card, `the card for room ${card.roomid} shows a mocked room's type and price`).toEqual(
        supplied.get(card.roomid),
      );
    }

    testInfo.annotations.push({
      type: 'observed-rendering',
      description: observedRendering(displayedIds, images.fulfilled),
    });
  });
});
