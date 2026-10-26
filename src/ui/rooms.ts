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

/** Host of the external image in MANY_MOCK_ROOMS. Reserved (`.example`), and answered by mockExternalImages. */
export const EXTERNAL_IMAGE_HOST = 'external-images.example';

/** The room in MANY_MOCK_ROOMS whose image is on EXTERNAL_IMAGE_HOST. */
export const EXTERNAL_IMAGE_ROOM_ID = 922;

// More than three rooms, with the external-image room second. On the live site a fourth room with an
// external image was not rendered; this order tells the possible rules apart: all five rendered, only
// the first three (922 included), or every room except 922.
export const MANY_MOCK_ROOMS = [
  { ...MOCK_ROOMS[0], roomid: 921, roomName: '921', type: 'Single', roomPrice: 121 },
  {
    ...MOCK_ROOMS[1],
    roomid: EXTERNAL_IMAGE_ROOM_ID,
    roomName: '922',
    type: 'Double',
    roomPrice: 122,
    image: `https://${EXTERNAL_IMAGE_HOST}/room2.jpg`,
  },
  { ...MOCK_ROOMS[2], roomid: 923, roomName: '923', type: 'Suite', roomPrice: 123 },
  { ...MOCK_ROOMS[0], roomid: 924, roomName: '924', type: 'Family', roomPrice: 124 },
  { ...MOCK_ROOMS[1], roomid: 925, roomName: '925', type: 'Twin', roomPrice: 125 },
];

// A 1x1 transparent PNG.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Answers image requests to EXTERNAL_IMAGE_HOST with a valid image, so tests do not depend on an
 * external host being reachable. Returns a counter of answered requests (the page may load images
 * lazily, so it can stay 0).
 */
export async function mockExternalImages(page: Page): Promise<{ fulfilled: number }> {
  const counter = { fulfilled: 0 };
  await page.route(
    (url) => url.hostname === EXTERNAL_IMAGE_HOST,
    async (route) => {
      counter.fulfilled += 1;
      await route.fulfill({ contentType: 'image/png', body: PIXEL_PNG });
    },
  );
  return counter;
}

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
