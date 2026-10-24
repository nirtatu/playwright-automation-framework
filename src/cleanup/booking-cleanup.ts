import type { Booking, CreatedBooking } from '../data/booking-data';

// Best-effort tracking and cleanup of bookings created by a test. Dependencies are injected so
// the safety rules can be unit-tested offline; Playwright's APIResponse and BookingApi satisfy
// these interfaces as they are.
// Cleanup never throws: a cleanup problem must not fail a passing test or hide the original
// failure. Every problem is reported through `warn`.

/** The parts of an HTTP response that tracking and cleanup read. */
export interface CleanupResponse {
  status(): number;
  ok(): boolean;
  json(): Promise<unknown>;
}

/** Booking calls authenticated with one token. */
export interface BookingEndpoints {
  get(id: number): Promise<CleanupResponse>;
  delete(id: number): Promise<CleanupResponse>;
  listForRoom(roomid: number): Promise<CleanupResponse>;
}

export interface CleanupClient {
  bookingsFor(token: string): BookingEndpoints;
  validateToken(token: string): Promise<CleanupResponse>;
  /** Logs in with the admin credentials. */
  login(): Promise<CleanupResponse>;
}

export interface BookingTrackerOptions<R extends CleanupResponse> {
  /** Sends one create request. Called exactly once per tracked create, never retried. */
  create: (booking: Partial<Booking>) => Promise<R>;
  client: CleanupClient;
  token: string;
  warn: (message: string) => void;
  /** How long cleanup waits for in-flight creates. */
  inFlightWaitMs?: number;
}

export interface BookingTracker<R extends CleanupResponse> {
  create: (booking: Partial<Booking>) => Promise<R>;
  /** Waits (bounded) for in-flight creates, then deletes everything this tracker created. */
  cleanUp: () => Promise<void>;
}

// Request timeout for creates, set by the API fixture: covers the proxy's backend retries (about
// 31s, observed on the demo site).
export const CREATE_REQUEST_TIMEOUT_MS = 35_000;

// How long after a create is sent its booking may still appear, and the most cleanup waits for
// creates in total. Longer than the create timeout, so a create that times out just before
// cleanup starts is still answered within the wait.
export const IN_FLIGHT_WAIT_MS = CREATE_REQUEST_TIMEOUT_MS + 5_000;

interface AmbiguousCreate {
  booking: Partial<Booking>;
  reason: string;
  inFlight?: boolean; // still unanswered after the teardown wait; used only for warning text
  // Failed without a response: the server may still complete it until this time (ms since epoch).
  mayAppearUntil?: number;
}

interface PendingCreate extends AmbiguousCreate {
  settled: Promise<void>; // resolves when the create has been fully handled; never rejects
}

export function createBookingTracker<R extends CleanupResponse>({
  create,
  client,
  token,
  warn,
  inFlightWaitMs = IN_FLIGHT_WAIT_MS,
}: BookingTrackerOptions<R>): BookingTracker<R> {
  const tracked = new Map<number, string>(); // bookingid -> marker (last name)
  const ambiguous: AmbiguousCreate[] = [];
  // Creates sent but not yet handled. A test timeout can interrupt a create without any
  // exception reaching this code, so cleanup waits for these and then treats any still
  // unresolved as ambiguous.
  const pending = new Set<PendingCreate>();

  return {
    create(booking) {
      const attempt: PendingCreate = {
        booking,
        reason: `create still in flight after waiting ${inFlightWaitMs / 1000}s in teardown`,
        inFlight: true,
        settled: Promise.resolve(),
      };
      pending.add(attempt); // recorded before sending; never retried
      const sentAt = Date.now();
      const work = (async () => {
        let response: R;
        try {
          response = await create(booking);
        } catch (error) {
          // No response: the booking may or may not exist, and may still be created (e.g. after a
          // client timeout or reset). Recovered by marker in cleanup, once that window has passed.
          // Not recorded again if cleanup already recorded it as in flight.
          if (pending.delete(attempt)) {
            ambiguous.push({ booking, reason: errorMessage(error), mayAppearUntil: sentAt + inFlightWaitMs });
          }
          throw error;
        }
        const body = (await response.json().catch(() => undefined)) as { bookingid?: unknown } | undefined;
        const id = body?.bookingid;
        const stillPending = pending.delete(attempt); // false once cleanup recorded it as in flight
        if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
          // Tracked whatever the status, so an unexpected success in a negative test is cleaned up.
          // Also after cleanup started: deleted if cleanup has not passed that point yet.
          tracked.set(id, booking.lastname ?? '');
        } else if (stillPending && (response.ok() || response.status() >= 500)) {
          // Searched for at once. Residual risk: if a gateway answered 5xx while the backend was
          // still creating the booking, it can appear after the search (reported as 0 matches).
          ambiguous.push({ booking, reason: `status ${response.status()} without a booking id` });
        }
        return response;
      })();
      // Never rejects, so cleanup can wait on it; also gives `work` a rejection handler even if
      // the test stops awaiting it (e.g. after a timeout).
      attempt.settled = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    },

    async cleanUp() {
      // Let in-flight creates finish, so they are cleaned up by id rather than by marker lookup.
      await waitForSettled(
        [...pending].map((attempt) => attempt.settled),
        inFlightWaitMs,
      );
      // Still unanswered: recorded once, as in flight. Clearing `pending` stops a late answer from
      // recording the same create again while cleanup is running.
      ambiguous.push(...pending);
      pending.clear();
      // A marker search before a failed create's window has passed could miss a booking that
      // appears later. If no create is sent after cleanUp() starts (the API fixture refuses them),
      // every window ends within inFlightWaitMs of cleanup starting, so both waits together stay
      // within inFlightWaitMs.
      await waitUntil(Math.max(0, ...ambiguous.map((create) => create.mayAppearUntil ?? 0)));
      await cleanUpAll(new CleanupSession(client, token), tracked, ambiguous, warn);
    },
  };
}

// Marker, room and check-in, so a booking left behind can be found later.
function describeCreate({ booking }: AmbiguousCreate): string {
  return `${booking.lastname ?? '<no marker>'} (room ${booking.roomid ?? 'unknown'}, check-in ${booking.bookingdates?.checkin ?? 'unknown'})`;
}

function lateCreateNote({ inFlight }: AmbiguousCreate): string {
  return inFlight ? '; the booking may still be created after this lookup and could remain on the site' : '';
}

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

async function waitUntil(time: number): Promise<void> {
  const ms = time - Date.now();
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

class CleanupSession {
  private reloginUsed = false;

  constructor(
    private readonly client: CleanupClient,
    private token: string,
  ) {}

  get api(): BookingEndpoints {
    return this.client.bookingsFor(this.token);
  }

  // Missing or invalid tokens have shown up as 401, 403 or 500 on booking routes, so the status
  // alone is not proof: check the token before logging in again.
  // At most one re-login per cleanup.
  async recoverAuth(status: number): Promise<boolean> {
    if (this.reloginUsed || ![401, 403, 500].includes(status)) return false;
    const check = await this.client.validateToken(this.token);
    if (check.status() !== 401 && check.status() !== 403) return false;
    this.reloginUsed = true;
    const response = await this.client.login();
    const token = response.ok() ? ((await response.json()) as { token?: unknown }).token : undefined;
    if (typeof token !== 'string' || token === '') return false;
    this.token = token;
    return true;
  }
}

async function cleanUpAll(
  session: CleanupSession,
  tracked: Map<number, string>,
  ambiguous: AmbiguousCreate[],
  warn: (message: string) => void,
): Promise<void> {
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
  const isUsable = async (response: CleanupResponse) =>
    response.status() === 200 &&
    Array.isArray(((await response.json().catch(() => undefined)) as { bookings?: unknown } | undefined)?.bookings);

  let response = await session.api.listForRoom(booking.roomid);
  if (!(await isUsable(response)) && (await session.recoverAuth(response.status()))) {
    response = await session.api.listForRoom(booking.roomid);
  }
  // The proxy answers 500 with [] when it fails, so only a 200 with a list counts as an answer.
  if (!(await isUsable(response))) {
    warn(`${what}: booking lookup returned ${response.status()}; cleanup not guaranteed${lateCreateNote(create)}`);
    return undefined;
  }
  const bookings = ((await response.json()) as { bookings: CreatedBooking[] }).bookings;
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
  const who = `#${id} (${marker})`;
  const check = await session.api.get(id);
  if (check.status() === 404) {
    if (retry.priorDeleteStatus !== undefined) {
      warn(
        `${who}: DELETE returned ${retry.priorDeleteStatus}, booking now not found; deletion by this test unconfirmed`,
      );
    }
    return; // Already gone: deleted by the test itself or by an environment reset.
  }
  if (check.status() !== 200) {
    if (!retry.done && (await session.recoverAuth(check.status()))) {
      return deleteOwned(session, id, marker, warn, { done: true });
    }
    warn(`${who}: ownership check returned ${check.status()}; not deleted`);
    return;
  }
  const found = ((await check.json()) as { lastname?: unknown }).lastname;
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
    warn(`${who}: DELETE returned ${deletion.status()}, follow-up GET ${after.status()}; deletion unconfirmed`);
  } else if (!deletion.ok()) {
    warn(`${who}: DELETE returned ${deletion.status()}, booking now not found; deletion by this test unconfirmed`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
