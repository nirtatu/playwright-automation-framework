import type { Page, Response } from '@playwright/test';

// Rooms list helpers for UI tests: the endpoint matcher (live and mocked specs) and the deterministic
// mock (`@mock` specs).

// Deterministic rooms for `@mock` UI tests. Ids and prices differ from the live data, so a pass shows
// the cards were rendered from this mock. The extra fields follow the rooms API shape, so the page has
// everything a real room provides.
export const MOCK_ROOMS = [
  {
    roomid: 901,
    roomName: '901',
    type: 'Single',
    accessible: true,
    image: '/images/room1.jpg',
    description: 'Mocked single room.',
    features: ['WiFi'],
    roomPrice: 111,
  },
  {
    roomid: 902,
    roomName: '902',
    type: 'Double',
    accessible: true,
    image: '/images/room2.jpg',
    description: 'Mocked double room.',
    features: ['TV', 'Safe'],
    roomPrice: 222,
  },
  {
    roomid: 903,
    roomName: '903',
    type: 'Suite',
    accessible: false,
    image: '/images/room3.jpg',
    description: 'Mocked suite.',
    features: ['Radio', 'WiFi', 'Safe'],
    roomPrice: 333,
  },
];

/** True for the rooms list endpoint, whatever the query string. */
export const isRoomsList = (url: URL) => url.pathname === '/api/room';

/** True for the page's GET /api/room response, mocked or live. For `page.waitForResponse`. */
export const isRoomsListResponse = (response: Response) =>
  response.request().method() === 'GET' && isRoomsList(new URL(response.url()));

/**
 * Answers the page's GET /api/room with `rooms`, before it reaches the network. Other methods fall
 * through to the write guard. Returns a counter of answered requests, so a test can prove the mock
 * was used rather than silently rendering live data.
 */
export async function mockRoomsList(page: Page, rooms: unknown[]): Promise<{ fulfilled: number }> {
  const counter = { fulfilled: 0 };
  // A page route takes precedence over the write guard's context route.
  await page.route(isRoomsList, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    counter.fulfilled += 1;
    await route.fulfill({ json: { rooms } });
  });
  return counter;
}
