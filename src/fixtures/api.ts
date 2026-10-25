import { test as base, expect, type APIResponse, type TestInfo } from '@playwright/test';
import { login, validateToken } from '../api/auth-api';
import { BookingApi } from '../api/booking-api';
import { expectStatus } from '../api/http';
import { listRooms, type Room } from '../api/room-api';
import { createBookingTracker, CREATE_REQUEST_TIMEOUT_MS, type BookingTracker } from '../cleanup/booking-cleanup';
import { cleanupWarningLine } from '../cleanup/warning-output';
import { adminCredentials, allowLiveWritesFlag } from '../config/env';
import { liveWriteDecision } from '../config/live-writes';
import { findFreeWindow, SLOT_WINDOW_DAYS, type Booking } from '../data/booking-data';

/** A room plus the first day of a window with no existing bookings in that room. */
export interface BookingSlot {
  roomid: number;
  checkin: string;
}

/** Sends one create request (never retried) and registers any created booking for cleanup. */
export type CreateBooking = (booking: Partial<Booking>) => Promise<APIResponse>;

const GITHUB_ACTIONS = !!process.env.GITHUB_ACTIONS;
const CI = !!process.env.CI;

/**
 * Budget for the bookingTracker fixture, which covers its setup and teardown together
 * (test.slow() does not extend it). Exceeding it ends teardown and replaces the worker, which
 * kills a cleanup still in progress. Worst case for the current specs, which create at most two
 * bookings per test:
 * - waiting for creates: at most IN_FLIGHT_WAIT_MS (40s) in total;
 * - 14 cleanup requests, each bounded by the request context's default timeout, actionTimeout
 *   (10s) in playwright.config.ts: 140s. Usually at most 13 (8 for one booking, including the
 *   single re-login, and 5 for the other); a create answered with an id after the in-flight wait
 *   can cost 9 instead of 8 (its marker search, then its deletion by id).
 * That is a 180s workload; the 190s budget adds 10s of margin. Both are bounds under these
 * assumptions, not an absolute guarantee. Setup sends no requests, and a healthy cleanup takes
 * about a second. If these numbers change, update this and timeout-minutes in
 * .github/workflows/api-live.yml.
 */
const CLEANUP_TEARDOWN_TIMEOUT_MS = 190_000;

/**
 * Opt-in for tests that write to BASE_URL. Without ALLOW_LIVE_WRITES=true the test is skipped
 * locally, and fails on CI so that a workflow missing the flag cannot pass with its write tests
 * silently skipped. Runs before any request is sent. The decision is in src/config/live-writes.ts
 * (unit-tested).
 */
function requireLiveWrites(testInfo: TestInfo): void {
  const decision = liveWriteDecision(allowLiveWritesFlag, CI);
  if (decision === 'allow') return;
  const reason = 'writes to BASE_URL require ALLOW_LIVE_WRITES=true';
  if (decision === 'fail') throw new Error(`[setup] ${reason}`);
  testInfo.skip(true, reason);
}

type ApiFixtures = {
  adminToken: string;
  bookingApi: BookingApi;
  slot: BookingSlot;
  bookingTracker: BookingTracker<APIResponse>;
  createBooking: CreateBooking;
};

export const test = base.extend<ApiFixtures>({
  // Test-scoped: a fresh token per test survives environment resets between tests.
  // Every write-capable fixture (bookingApi, slot, createBooking) depends on this one, so the
  // live-write guard here runs before any of them sends a request.
  adminToken: async ({ request }, use, testInfo) => {
    requireLiveWrites(testInfo);
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

  // Tracks this test's bookings and deletes them. Tracking and cleanup rules live in
  // src/cleanup/booking-cleanup.ts (unit-tested offline). The engine's cleanUp() runs at most
  // once: when a test calls it, or otherwise in teardown. Teardown always
  // awaits that single run, also after a test timeout, within CLEANUP_TEARDOWN_TIMEOUT_MS.
  bookingTracker: [
    async ({ request, adminToken, bookingApi }, use, testInfo) => {
      const tracker = createBookingTracker({
        // Shorter than the engine's in-flight wait, so a create that times out is answered within it.
        create: (booking) => bookingApi.create(booking, CREATE_REQUEST_TIMEOUT_MS),
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
      let cleanup: Promise<void> | undefined;
      const cleanUp = () => (cleanup ??= tracker.cleanUp());
      await use({
        create: async (booking) => {
          // A booking created after cleanup started would never be deleted: refuse before sending.
          if (cleanup) throw new Error('[setup] create after cleanUp(): the booking would not be cleaned up');
          return tracker.create(booking);
        },
        cleanUp,
      });
      await cleanUp();
    },
    { timeout: CLEANUP_TEARDOWN_TIMEOUT_MS },
  ],

  createBooking: async ({ bookingTracker }, use) => {
    await use((booking) => bookingTracker.create(booking));
  },
});

export { expect };
