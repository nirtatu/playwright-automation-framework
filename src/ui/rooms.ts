import { expect, type Page, type Response } from '@playwright/test';
import type { Room } from '../api/room-api';
import { redact } from '../security/redaction';

// Rooms list helpers for UI tests: the endpoint matcher and response reader (live and mocked specs)
// and the deterministic mock (`@mock` specs).

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

// More than three rooms, with the external-image room second. The page renders only the first three
// rooms of the response (the shipped code renders `rooms.slice(0, 3)`), so 921, 922 and 923 are shown,
// 922 with its external image.
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
 * Answers image requests to `host` (EXTERNAL_IMAGE_HOST by default) with a valid image, so tests do
 * not depend on an external host being reachable; also used for map tiles. Returns a counter of
 * answered requests (the page may load images lazily, so it can stay 0).
 */
export async function mockExternalImages(page: Page, host = EXTERNAL_IMAGE_HOST): Promise<{ fulfilled: number }> {
  const counter = { fulfilled: 0 };
  await page.route(
    (url) => url.hostname === host,
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

/** How failure messages name the rooms list endpoint. */
export const ROOMS_LIST_ENDPOINT = 'GET /api/room';

/** The `rooms` array of a GET /api/room response the page received, with failures that name the endpoint. */
export async function readRoomsList(response: Response): Promise<Room[]> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    // The read error is not kept: the message names the endpoint.
    throw new Error(`[contract] ${ROOMS_LIST_ENDPOINT}: response body could not be read`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // The parse error is not kept: it can quote the raw body. A redacted excerpt replaces it, truncated
    // before redaction as in expectStatus.
    const excerpt = text === '' ? '<empty body>' : redact(text.slice(0, 200));
    throw new Error(`[contract] ${ROOMS_LIST_ENDPOINT}: response body is not valid JSON. Body: ${excerpt}`);
  }
  const rooms = (body as { rooms?: unknown } | null)?.rooms;
  expect(Array.isArray(rooms), `[contract] ${ROOMS_LIST_ENDPOINT}: response body has a "rooms" array`).toBe(true);
  return rooms as Room[];
}

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
