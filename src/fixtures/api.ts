import { test as base, expect, type APIResponse } from '@playwright/test';
import { login, validateToken } from '../api/auth-api';
import { BookingApi } from '../api/booking-api';
import { expectStatus } from '../api/http';
import { listRooms, type Room } from '../api/room-api';
import { createBookingTracker } from '../cleanup/booking-cleanup';
import { cleanupWarningLine } from '../cleanup/warning-output';
import { adminCredentials } from '../config/env';
import { findFreeWindow, SLOT_WINDOW_DAYS, type Booking } from '../data/booking-data';

/** A room plus the first day of a window with no existing bookings in that room. */
export interface BookingSlot {
  roomid: number;
  checkin: string;
}

/** Sends one create request (never retried) and registers any created booking for cleanup. */
export type CreateBooking = (booking: Partial<Booking>) => Promise<APIResponse>;

const GITHUB_ACTIONS = !!process.env.GITHUB_ACTIONS;

type ApiFixtures = {
  adminToken: string;
  bookingApi: BookingApi;
  slot: BookingSlot;
  createBooking: CreateBooking;
};

export const test = base.extend<ApiFixtures>({
  // Test-scoped: a fresh token per test survives environment resets between tests.
  adminToken: async ({ request }, use) => {
    const response = await login(request, adminCredentials);
    await expectStatus(response, 200, 'setup: admin login');
    const { token } = await response.json();
    expect(token, '[setup] admin login returned a token').toBeTruthy();
    await use(token);
  },

  bookingApi: async ({ request, adminToken }, use) => {
    await use(new BookingApi(request, adminToken));
  },

  slot: async ({ request, bookingApi }, use) => {
    const response = await listRooms(request);
    await expectStatus(response, 200, 'setup: list rooms');
    const { rooms }: { rooms: Room[] } = await response.json();
    const roomIds = rooms.map((room) => room.roomid);
    expect(roomIds.length, '[setup] at least one room exists').toBeGreaterThan(0);
    const roomid = roomIds[Math.floor(Math.random() * roomIds.length)]!;

    const existing = await bookingApi.listForRoom(roomid);
    await expectStatus(existing, 200, 'setup: list bookings for room');
    const checkin = findFreeWindow((await existing.json()).bookings);
    expect(checkin, `[setup] found a ${SLOT_WINDOW_DAYS}-day window without bookings in room ${roomid}`).toBeDefined();
    await use({ roomid, checkin: checkin! });
  },

  // Own 60s budget for setup and teardown, so cleanup is not squeezed by a slow test.
  // Tracking and cleanup rules live in src/cleanup/booking-cleanup.ts (unit-tested offline).
  createBooking: [
    async ({ request, adminToken, bookingApi }, use, testInfo) => {
      const tracker = createBookingTracker({
        create: (booking) => bookingApi.create(booking),
        client: {
          bookingsFor: (token) => new BookingApi(request, token),
          validateToken: (token) => validateToken(request, token),
          login: () => login(request, adminCredentials),
        },
        token: adminToken,
        // Cleanup problems never fail a test: they become report annotations and log lines.
        warn: (message) => {
          testInfo.annotations.push({ type: 'cleanup-warning', description: message });
          const line = cleanupWarningLine(testInfo.title, message, GITHUB_ACTIONS);
          // The runner reads workflow commands from stdout; locally keep the original stderr warning.
          if (GITHUB_ACTIONS) console.log(line);
          else console.warn(line);
        },
      });
      await use((booking) => tracker.create(booking));
      await tracker.cleanUp();
    },
    { timeout: 60_000 },
  ],
});

export { expect };
