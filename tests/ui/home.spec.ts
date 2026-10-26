import type { Response } from '@playwright/test';
import { expectStatus } from '../../src/api/http';
import type { Room } from '../../src/api/room-api';
import { HomePage } from '../../src/pages/home-page';
import { redact } from '../../src/security/redaction';
import { isRoomsListResponse } from '../../src/ui/rooms';
import { test, expect } from '../../src/ui/ui-test';

// Both tests use live data from the shared demo site: the page and the rooms it renders come from the
// real backend. They are read-only; the shared UI fixture aborts any API write a page attempts and
// fails the test, as it does for uncaught page errors.

const ROOMS_ENDPOINT = 'GET /api/room';

/** The `rooms` array of the response, with failures that name the endpoint. */
async function roomsIn(response: Response): Promise<Room[]> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    // The read error is not kept: the message names the endpoint.
    throw new Error(`[contract] ${ROOMS_ENDPOINT}: response body could not be read`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // The parse error is not kept: it can quote the raw body. A redacted excerpt replaces it, truncated
    // before redaction as in expectStatus.
    const excerpt = text === '' ? '<empty body>' : redact(text.slice(0, 200));
    throw new Error(`[contract] ${ROOMS_ENDPOINT}: response body is not valid JSON. Body: ${excerpt}`);
  }
  const rooms = (body as { rooms?: unknown } | null)?.rooms;
  expect(Array.isArray(rooms), `[contract] ${ROOMS_ENDPOINT}: response body has a "rooms" array`).toBe(true);
  return rooms as Room[];
}

test.describe('Home page', { tag: '@live' }, () => {
  test('shows the rooms section with at least one bookable room', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    await expect(home.roomsHeading).toBeVisible();

    // Room names and branding are editable on the shared site, so assert on
    // structure: at least one room card with a "Book now" link to a reservation.
    await expect(home.bookNowLinks.first()).toBeVisible();
    await expect(home.bookNowLinks.first()).toHaveAttribute('href', /\/reservation\/\d+/);
  });

  test('renders only rooms from its rooms API response, each with matching type, price and reservation link', async ({
    page,
  }, testInfo) => {
    const home = new HomePage(page);
    // Registered before navigation: the page fetches the rooms itself once it has loaded.
    const roomsResponse = page.waitForResponse(isRoomsListResponse);
    await home.goto();
    const response = await roomsResponse;
    await expectStatus(response, 200, `page load: ${ROOMS_ENDPOINT}`);

    // Compared with the response this page rendered, not a second request: the shared data can change
    // between two requests.
    const rooms = await roomsIn(response);
    expect(rooms.length, `${ROOMS_ENDPOINT}: the response lists at least one room`).toBeGreaterThan(0);
    const ids = rooms.map((room) => room.roomid);
    expect(new Set(ids).size, `${ROOMS_ENDPOINT}: room ids are unique, got ${JSON.stringify(ids)}`).toBe(ids.length);
    const byId = new Map(rooms.map((room) => [room.roomid, room]));

    // The page need not render every room in the response (on 2026-10-26 it rendered 3 of 4), and
    // anyone can add rooms to the shared site, so each rendered card is checked against the response
    // instead of the card count. The rendering rule itself is covered with mocked rooms.
    await expect(home.roomCards.first(), 'at least one room card is rendered').toBeVisible();
    // readRoomCards() also checks each card's structure: one title, one "Book now" link to
    // /reservation/<id>, and a nightly price.
    const displayed = await home.readRoomCards();
    const displayedIds = displayed.map((card) => card.roomid);
    expect(new Set(displayedIds).size, `each room has at most one card, got ${JSON.stringify(displayedIds)}`).toBe(
      displayedIds.length,
    );
    for (const card of displayed) {
      const room = byId.get(card.roomid);
      expect(room, `the card for room ${card.roomid} is a room in the ${ROOMS_ENDPOINT} response`).toBeDefined();
      expect(card, `the card for room ${card.roomid} shows the response's type and nightly price`).toEqual({
        roomid: room!.roomid,
        type: room!.type,
        roomPrice: room!.roomPrice,
      });
    }

    // Each card's link has YYYY-MM-DD check-in and check-out dates (validated by readReservationLinks()).
    const links = await home.readReservationLinks();
    expect(
      links.map((link) => link.roomid),
      'each card links to its own room',
    ).toEqual(displayedIds);

    testInfo.annotations.push({
      type: 'observed-rendering',
      description: `rendered ${displayed.length} of ${rooms.length} rooms from ${ROOMS_ENDPOINT}: ids ${JSON.stringify(displayedIds)} of ${JSON.stringify(ids)}`,
    });
  });
});
