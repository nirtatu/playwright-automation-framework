import { expectStatus } from '../../src/api/http';
import { HomePage } from '../../src/pages/home-page';
import { ROOMS_LIST_ENDPOINT, isRoomsListResponse, readRoomsList } from '../../src/ui/rooms';
import { test, expect } from '../../src/ui/ui-test';

// Both tests use live data from the shared demo site: the page and the rooms it renders come from the
// real backend. They are read-only; the shared UI fixture aborts any API write a page attempts and
// fails the test, as it does for uncaught page errors.

test.describe('Home page', { tag: '@live' }, () => {
  test('shows the rooms section with at least one bookable room', async ({ page }) => {
    const home = new HomePage(page);

    await test.step('Act: open the home page', () => home.goto());

    await test.step('Verify: the rooms section shows a bookable room', async () => {
      await expect(home.roomsHeading).toBeVisible();
      // Room names and branding are editable on the shared site, so assert on
      // structure: at least one room card with a "Book now" link to a reservation.
      await expect(home.bookNowLinks.first()).toBeVisible();
      await expect(home.bookNowLinks.first()).toHaveAttribute('href', /\/reservation\/\d+/);
    });
  });

  test('renders only rooms from its rooms API response, each with matching type, price and reservation link', async ({
    page,
  }, testInfo) => {
    const home = new HomePage(page);

    const response = await test.step('Act: open the home page and capture its rooms response', async () => {
      // Registered before navigation: the page fetches the rooms itself once it has loaded.
      const roomsResponse = page.waitForResponse(isRoomsListResponse);
      await home.goto();
      return roomsResponse;
    });

    // Compared with the response this page rendered, not a second request: the shared data can change
    // between two requests.
    const rooms = await test.step('Verify: the rooms response lists rooms with unique ids', async () => {
      await expectStatus(response, 200, `page load: ${ROOMS_LIST_ENDPOINT}`);
      const list = await readRoomsList(response);
      expect(list.length, `${ROOMS_LIST_ENDPOINT}: the response lists at least one room`).toBeGreaterThan(0);
      const listIds = list.map((room) => room.roomid);
      expect(new Set(listIds).size, `${ROOMS_LIST_ENDPOINT}: room ids are unique, got ${JSON.stringify(listIds)}`).toBe(
        listIds.length,
      );
      return list;
    });

    const ids = rooms.map((room) => room.roomid);
    const byId = new Map(rooms.map((room) => [room.roomid, room]));

    // The page need not render every room in the response (on 2026-10-26 it rendered 3 of 4), and
    // anyone can add rooms to the shared site, so each rendered card is checked against the response
    // instead of the card count. The rendering rule itself is covered with mocked rooms.
    const displayed = await test.step('Verify: every card is a room from the response', async () => {
      await expect(home.roomCards.first(), 'at least one room card is rendered').toBeVisible();
      // readRoomCards() also checks each card's structure: one title, one "Book now" link to
      // /reservation/<id>, and a nightly price.
      const cards = await home.readRoomCards();
      const cardIds = cards.map((card) => card.roomid);
      expect(new Set(cardIds).size, `each room has at most one card, got ${JSON.stringify(cardIds)}`).toBe(
        cardIds.length,
      );
      for (const card of cards) {
        const room = byId.get(card.roomid);
        expect(room, `the card for room ${card.roomid} is a room in the ${ROOMS_LIST_ENDPOINT} response`).toBeDefined();
        expect(card, `the card for room ${card.roomid} shows the response's type and nightly price`).toEqual({
          roomid: room!.roomid,
          type: room!.type,
          roomPrice: room!.roomPrice,
        });
      }
      return cards;
    });

    const displayedIds = displayed.map((card) => card.roomid);

    // Each card's "Book now" link is for a room in the response and has YYYY-MM-DD check-in and
    // check-out dates (validated by readReservationLinks()). Checked against the response, not against
    // the cards read above: the two reads are separate DOM snapshots. (Each card's room id above is
    // already read from its own link.)
    await test.step('Verify: every "Book now" link is for a room in the response', async () => {
      for (const link of await home.readReservationLinks()) {
        expect(
          byId.has(link.roomid),
          `the "Book now" link to room ${link.roomid} is for a room in the ${ROOMS_LIST_ENDPOINT} response`,
        ).toBe(true);
      }
    });

    testInfo.annotations.push({
      type: 'observed-rendering',
      description:
        `read once the first card was visible (the page has no render-complete signal, so this may not be ` +
        `the complete result): ${displayed.length} of ${rooms.length} rooms from ${ROOMS_LIST_ENDPOINT} rendered, ` +
        `ids ${JSON.stringify(displayedIds)} of ${JSON.stringify(ids)}`,
    });
  });
});
