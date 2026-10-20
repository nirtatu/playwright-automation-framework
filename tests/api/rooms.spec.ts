import { test, expect } from '@playwright/test';
import { expectStatus } from '../../src/api/http';
import { listRooms } from '../../src/api/room-api';

test.describe('Rooms API', () => {
  test('GET /api/room returns a list of rooms', async ({ request }) => {
    const response = await listRooms(request);

    await expectStatus(response, 200);

    const body = await response.json();
    // The public data resets periodically, so assert on shape, not on specific rooms.
    expect(Array.isArray(body.rooms)).toBe(true);
    expect(body.rooms.length).toBeGreaterThan(0);

    for (const room of body.rooms) {
      expect(room).toEqual(
        expect.objectContaining({
          roomid: expect.any(Number),
          roomName: expect.any(String),
          type: expect.any(String),
          roomPrice: expect.any(Number),
        }),
      );
    }
  });
});
