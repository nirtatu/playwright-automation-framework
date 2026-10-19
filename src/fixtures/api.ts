import { test as base, expect, type APIRequestContext, type APIResponse, type TestInfo } from '@playwright/test';
import { login, validateToken } from '../api/auth-api';
import { BookingApi } from '../api/booking-api';
import { expectStatus, send } from '../api/http';
import { adminCredentials } from '../config/env';
import { addDays, type Booking, type CreatedBooking } from '../data/booking-data';

/** A room plus the first day of a window with no existing bookings in that room. */
export interface BookingSlot {
  roomid: number;
  checkin: string;
}

/** Sends one create request (never retried) and registers any created booking for cleanup. */
export type CreateBooking = (booking: Partial<Booking>) => Promise<APIResponse>;

type ApiFixtures = {
  adminToken: string;
  bookingApi: BookingApi;
  slot: BookingSlot;
  createBooking: CreateBooking;
};

// Tests place every booking inside this window, so they never collide with existing data.
export const SLOT_WINDOW_DAYS = 30;

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
    const rooms = await send('GET /api/room', () => request.get('/api/room'));
    await expectStatus(rooms, 200, 'setup: list rooms');
    const roomIds: number[] = (await rooms.json()).rooms.map((room: { roomid: number }) => room.roomid);
    expect(roomIds.length, '[setup] at least one room exists').toBeGreaterThan(0);
    const roomid = roomIds[Math.floor(Math.random() * roomIds.length)]!;

    const existing = await bookingApi.listForRoom(roomid);
    await expectStatus(existing, 200, 'setup: list bookings for room');
    const checkin = findFreeWindow((await existing.json()).bookings);
    expect(checkin, `[setup] found a ${SLOT_WINDOW_DAYS}-day window without bookings in room ${roomid}`).toBeDefined();
    await use({ roomid, checkin: checkin! });
  },

  // Own 60s budget for setup and teardown, so cleanup is not squeezed by a slow test.
  createBooking: [
    async ({ request, adminToken, bookingApi }, use, testInfo) => {
      const tracked = new Map<number, string>(); // bookingid -> marker (last name)
      const ambiguous: AmbiguousCreate[] = [];
      // Creates sent but not yet handled. A test timeout can interrupt a create without any
      // exception reaching this code, so teardown waits for these and then treats any still
      // unresolved as ambiguous.
      const pending = new Set<PendingCreate>();

      await use((booking) => {
        const attempt: PendingCreate = {
          booking,
          reason: `create still in flight after waiting ${IN_FLIGHT_WAIT_MS / 1000}s in teardown`,
          inFlight: true,
          settled: Promise.resolve(),
        };
        pending.add(attempt); // recorded before sending; never retried
        const work = (async () => {
          let response: APIResponse;
          try {
            response = await bookingApi.create(booking);
          } catch (error) {
            // No response: the booking may or may not exist. Recovered by marker in teardown.
            pending.delete(attempt);
            ambiguous.push({ booking, reason: error instanceof Error ? error.message : String(error) });
            throw error;
          }
          const id = (await response.json().catch(() => undefined))?.bookingid;
          if (Number.isInteger(id) && id > 0) {
            // Tracked whatever the status, so an unexpected success in a negative test is cleaned up.
            tracked.set(id, booking.lastname ?? '');
          } else if (response.ok() || response.status() >= 500) {
            ambiguous.push({ booking, reason: `status ${response.status()} without a booking id` });
          }
          pending.delete(attempt);
          return response;
        })();
        // Never rejects, so teardown can wait on it; also gives `work` a rejection handler even if
        // the test stops awaiting it (e.g. after a timeout).
        attempt.settled = work.then(
          () => undefined,
          () => undefined,
        );
        return work;
      });

      // Let in-flight creates finish (the request context stays open until this teardown ends),
      // so they are cleaned up by id rather than by marker lookup. Bounded by IN_FLIGHT_WAIT_MS.
      await waitForSettled([...pending].map((attempt) => attempt.settled), IN_FLIGHT_WAIT_MS);
      ambiguous.push(...pending);
      await cleanUp(new CleanupSession(request, adminToken), tracked, ambiguous, testInfo);
    },
    { timeout: 60_000 },
  ],
});

export { expect };

function findFreeWindow(bookings: CreatedBooking[]): string | undefined {
  const today = new Date().toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = addDays(today, 730 + Math.floor(Math.random() * 3650)); // 2–12 years ahead
    const end = addDays(start, SLOT_WINDOW_DAYS);
    // ISO dates compare correctly as strings. Back-to-back stays do not clash under the API's
    // overlap rule; the spare day before the window is a deliberate extra margin.
    const clash = bookings.some((b) => b.bookingdates.checkin <= end && b.bookingdates.checkout >= addDays(start, -1));
    if (!clash) return start;
  }
  return undefined;
}

// --- Best-effort cleanup -------------------------------------------------------------------
// Teardown never throws: a cleanup problem must not fail a passing test or hide the original
// failure. Every problem is recorded as a `cleanup-warning` annotation (HTML report) and logged.

interface AmbiguousCreate {
  booking: Partial<Booking>;
  reason: string;
  inFlight?: boolean; // still unanswered after the teardown wait; used only for warning text
}

// Marker, room and check-in, so a booking left behind can be found later.
function describeCreate({ booking }: AmbiguousCreate): string {
  return `${booking.lastname ?? '<no marker>'} (room ${booking.roomid ?? 'unknown'}, check-in ${booking.bookingdates?.checkin ?? 'unknown'})`;
}

function lateCreateNote({ inFlight }: AmbiguousCreate): string {
  return inFlight ? '; the booking may still be created after this lookup and could remain on the site' : '';
}

interface PendingCreate extends AmbiguousCreate {
  settled: Promise<void>; // resolves when the create has been fully handled; never rejects
}

// Covers the proxy's backend retries (about 31s) and fits the fixture's 60s budget.
const IN_FLIGHT_WAIT_MS = 35_000;

async function waitForSettled(promises: Promise<void>[], ms: number): Promise<void> {
  if (promises.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([Promise.all(promises), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

class CleanupSession {
  private reloginUsed = false;

  constructor(
    private readonly request: APIRequestContext,
    private token: string,
  ) {}

  get api(): BookingApi {
    return new BookingApi(this.request, this.token);
  }

  // Missing or invalid tokens have shown up as 401, 403 or 500 on booking routes, so the status
  // alone is not proof: check the token before logging in again.
  // At most one re-login per test.
  async recoverAuth(status: number): Promise<boolean> {
    if (this.reloginUsed || ![401, 403, 500].includes(status)) return false;
    const check = await validateToken(this.request, this.token);
    if (check.status() !== 401 && check.status() !== 403) return false;
    this.reloginUsed = true;
    const response = await login(this.request, adminCredentials);
    const token = response.ok() ? (await response.json()).token : undefined;
    if (typeof token !== 'string' || token === '') return false;
    this.token = token;
    return true;
  }
}

async function cleanUp(
  session: CleanupSession,
  tracked: Map<number, string>,
  ambiguous: AmbiguousCreate[],
  testInfo: TestInfo,
): Promise<void> {
  const warn = (message: string) => {
    testInfo.annotations.push({ type: 'cleanup-warning', description: message });
    console.warn(`[cleanup-warning] ${testInfo.title}: ${message}`);
  };

  for (const create of ambiguous) {
    try {
      const id = await recoverByMarker(session, create, warn);
      if (id !== undefined) tracked.set(id, create.booking.lastname!);
    } catch (error) {
      warn(
        `ambiguous create ${describeCreate(create)} [${create.reason}]: recovery failed (${errorMessage(error)}); cleanup not guaranteed${lateCreateNote(create)}`,
      );
    }
  }

  for (const [id, marker] of tracked) {
    try {
      await deleteOwned(session, id, marker, warn);
    } catch (error) {
      warn(`#${id} (${marker}): ${errorMessage(error)}; deletion unconfirmed`);
    }
  }
}

// Read-only lookup of the room's bookings by the exact, unique marker. Only a single exact
// match is adopted for cleanup; anything else is reported and nothing is deleted.
async function recoverByMarker(
  session: CleanupSession,
  create: AmbiguousCreate,
  warn: (message: string) => void,
): Promise<number | undefined> {
  const { booking, reason } = create;
  const what = `ambiguous create ${describeCreate(create)} [${reason}]`;
  const marker = booking.lastname;
  if (!marker || !booking.roomid) {
    warn(`${what}: no marker or room to search by; cleanup not guaranteed${lateCreateNote(create)}`);
    return undefined;
  }
  const isUsable = async (response: APIResponse) =>
    response.status() === 200 && Array.isArray((await response.json().catch(() => undefined))?.bookings);

  let response = await session.api.listForRoom(booking.roomid);
  if (!(await isUsable(response)) && (await session.recoverAuth(response.status()))) {
    response = await session.api.listForRoom(booking.roomid);
  }
  // The proxy answers 500 with [] when it fails, so only a 200 with a list counts as an answer.
  if (!(await isUsable(response))) {
    warn(`${what}: booking lookup returned ${response.status()}; cleanup not guaranteed${lateCreateNote(create)}`);
    return undefined;
  }
  const bookings: CreatedBooking[] = (await response.json()).bookings;
  const matches = bookings.filter((b) => b.lastname === marker && Number.isInteger(b.bookingid) && b.bookingid > 0);
  if (matches.length === 1) return matches[0]!.bookingid;
  warn(`${what}: ${matches.length} exact matches; nothing deleted, cleanup not guaranteed${lateCreateNote(create)}`);
  return undefined;
}

// Deletes a booking only after a fresh GET shows it still carries this test's marker. This
// narrows, but cannot eliminate, the race where an environment reset reuses the id in between.
async function deleteOwned(
  session: CleanupSession,
  id: number,
  marker: string,
  warn: (message: string) => void,
  retry: { done: boolean; priorDeleteStatus?: number } = { done: false },
): Promise<void> {
  const check = await session.api.get(id);
  if (check.status() === 404) {
    if (retry.priorDeleteStatus !== undefined) {
      warn(`#${id} (${marker}): DELETE returned ${retry.priorDeleteStatus}, booking now not found; deletion by this test unconfirmed`);
    }
    return; // Already gone: deleted by the test itself or by an environment reset.
  }
  if (check.status() !== 200) {
    if (!retry.done && (await session.recoverAuth(check.status()))) {
      return deleteOwned(session, id, marker, warn, { done: true });
    }
    warn(`#${id} (${marker}): ownership check returned ${check.status()}; not deleted`);
    return;
  }
  const found = (await check.json()).lastname;
  if (found !== marker) {
    warn(`#${id}: marker mismatch (expected ${marker}, found ${found}); not deleted, id likely reused after a reset`);
    return;
  }

  const deletion = await session.api.delete(id);
  if (!deletion.ok() && !retry.done && (await session.recoverAuth(deletion.status()))) {
    // Never re-send the DELETE blindly: start again from the ownership check.
    return deleteOwned(session, id, marker, warn, { done: true, priorDeleteStatus: deletion.status() });
  }
  const after = await session.api.get(id);
  if (after.status() !== 404) {
    warn(`#${id} (${marker}): DELETE returned ${deletion.status()}, follow-up GET ${after.status()}; deletion unconfirmed`);
  } else if (!deletion.ok()) {
    warn(`#${id} (${marker}): DELETE returned ${deletion.status()}, booking now not found; deletion by this test unconfirmed`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
