import { test, expect } from '@playwright/test';
import {
  createBookingTracker,
  type BookingTrackerOptions,
  type CleanupClient,
  type CleanupResponse,
} from '../../src/cleanup/booking-cleanup';
import type { Booking, CreatedBooking } from '../../src/data/booking-data';

// Offline unit tests: every dependency is an in-memory fake. No Playwright fixtures (request,
// page) and no HTTP client are used anywhere in this file; ESLint enforces that for tests/unit.

const MARKER = 'Auto-unit-marker';
const BOOKING: Booking = {
  roomid: 2,
  firstname: 'Playwright',
  lastname: MARKER,
  depositpaid: false,
  bookingdates: { checkin: '2031-06-14', checkout: '2031-06-16' },
};

function res(status: number, body?: unknown): CleanupResponse {
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    json: () => (body === undefined ? Promise.reject(new Error('no JSON body')) : Promise.resolve(body)),
  };
}

type Handler = (...args: never[]) => CleanupResponse;

/** Returns the scripted responses in order; fails the test if called more often than scripted. */
function seq(...responses: CleanupResponse[]): Handler {
  let index = 0;
  return () => {
    const response = responses[index++];
    if (!response) throw new Error(`unscripted call #${index}`);
    return response;
  };
}

/** In-memory CleanupClient that records every call, including the token it was made with. */
class FakeClient implements CleanupClient {
  readonly calls: string[] = [];

  constructor(
    private readonly handlers: {
      get?: Handler;
      delete?: Handler;
      list?: Handler;
      validate?: Handler;
      login?: Handler;
    },
  ) {}

  bookingsFor(token: string) {
    return {
      get: async (id: number) => this.record(`GET ${id} [${token}]`, this.handlers.get),
      delete: async (id: number) => this.record(`DELETE ${id} [${token}]`, this.handlers.delete),
      listForRoom: async (roomid: number) => this.record(`LIST room ${roomid} [${token}]`, this.handlers.list),
    };
  }

  async validateToken(token: string) {
    return this.record(`VALIDATE [${token}]`, this.handlers.validate);
  }

  async login() {
    return this.record('LOGIN', this.handlers.login);
  }

  private record(call: string, handler?: Handler): CleanupResponse {
    this.calls.push(call);
    if (!handler) throw new Error(`unexpected call: ${call}`);
    return handler();
  }
}

function setUp(
  client: FakeClient,
  create: BookingTrackerOptions<CleanupResponse>['create'] = async () => res(201, { bookingid: 7 }),
) {
  const warnings: string[] = [];
  const createCalls: Partial<Booking>[] = [];
  const tracker = createBookingTracker({
    create: (booking) => {
      createCalls.push(booking);
      return create(booking);
    },
    client,
    token: 'T1',
    warn: (message) => warnings.push(message),
    inFlightWaitMs: 20,
  });
  return { tracker, warnings, createCalls };
}

const owned = (id = 7) => res(200, { ...BOOKING, bookingid: id });
const NOT_FOUND = res(404);

test.describe('ownership-checked delete', () => {
  test('deletes a booking whose marker matches and confirms it is gone', async () => {
    const client = new FakeClient({ get: seq(owned(), NOT_FOUND), delete: seq(res(202)) });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]', 'DELETE 7 [T1]', 'GET 7 [T1]']);
    expect(warnings).toEqual([]);
  });

  test('never deletes a booking whose marker does not match', async () => {
    const client = new FakeClient({ get: seq(res(200, { ...BOOKING, bookingid: 7, lastname: 'Someone-Else' })) });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]']);
    expect(warnings).toEqual([
      `#7: marker mismatch (expected ${MARKER}, found Someone-Else); not deleted, id likely reused after a reset`,
    ]);
  });

  test('stays silent when the booking is already gone', async () => {
    const client = new FakeClient({ get: seq(NOT_FOUND) });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]']);
    expect(warnings).toEqual([]);
  });

  test('warns when DELETE fails but the booking is no longer found', async () => {
    const client = new FakeClient({
      get: seq(owned(), NOT_FOUND),
      delete: seq(res(500)),
      validate: seq(res(200)), // token still valid, so no re-login
    });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]', 'DELETE 7 [T1]', 'VALIDATE [T1]', 'GET 7 [T1]']);
    expect(warnings).toEqual([
      `#7 (${MARKER}): DELETE returned 500, booking now not found; deletion by this test unconfirmed`,
    ]);
  });

  test('warns when the booking is still present after DELETE', async () => {
    const client = new FakeClient({ get: seq(owned(), owned()), delete: seq(res(202)) });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(warnings).toEqual([`#7 (${MARKER}): DELETE returned 202, follow-up GET 200; deletion unconfirmed`]);
  });

  test('reports an exception during cleanup as a warning instead of throwing', async () => {
    const client = new FakeClient({
      get: () => {
        throw new Error('[transport] GET /api/booking/7: socket hang up');
      },
    });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await expect(tracker.cleanUp()).resolves.toBeUndefined();

    expect(warnings).toEqual([`#7 (${MARKER}): [transport] GET /api/booking/7: socket hang up; deletion unconfirmed`]);
  });
});

test.describe('bounded re-login', () => {
  test('re-logs in once when the token is dead, then retries from the ownership check', async () => {
    const client = new FakeClient({
      get: seq(res(500), owned(), NOT_FOUND),
      validate: seq(res(403)),
      login: seq(res(200, { token: 'T2' })),
      delete: seq(res(202)),
    });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]', 'VALIDATE [T1]', 'LOGIN', 'GET 7 [T2]', 'DELETE 7 [T2]', 'GET 7 [T2]']);
    expect(warnings).toEqual([]);
  });

  test('after a failed DELETE and re-login, restarts with a fresh ownership check (no blind DELETE)', async () => {
    const client = new FakeClient({
      get: seq(owned(), NOT_FOUND),
      delete: seq(res(403)),
      validate: seq(res(403)),
      login: seq(res(200, { token: 'T2' })),
    });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]', 'DELETE 7 [T1]', 'VALIDATE [T1]', 'LOGIN', 'GET 7 [T2]']);
    expect(warnings).toEqual([
      `#7 (${MARKER}): DELETE returned 403, booking now not found; deletion by this test unconfirmed`,
    ]);
  });

  test('re-logs in at most once per cleanup', async () => {
    const client = new FakeClient({
      get: seq(res(500), res(500), res(500)),
      validate: seq(res(403)),
      login: seq(res(200, { token: 'T2' })),
    });
    const nextCreate = seq(res(201, { bookingid: 7 }), res(201, { bookingid: 8 }));
    const { tracker, warnings } = setUp(client, async () => nextCreate());

    await tracker.create(BOOKING);
    await tracker.create({ ...BOOKING, lastname: `${MARKER}-2` });
    await tracker.cleanUp();

    expect(client.calls.filter((call) => call === 'LOGIN')).toHaveLength(1);
    expect(client.calls.filter((call) => call.startsWith('VALIDATE'))).toHaveLength(1);
    expect(client.calls.filter((call) => call.startsWith('DELETE'))).toEqual([]);
    expect(warnings).toEqual([
      `#7 (${MARKER}): ownership check returned 500; not deleted`,
      `#8 (${MARKER}-2): ownership check returned 500; not deleted`,
    ]);
  });

  test('does not re-log in when the token is still valid', async () => {
    const client = new FakeClient({ get: seq(res(500)), validate: seq(res(200)) });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]', 'VALIDATE [T1]']);
    expect(warnings).toEqual([`#7 (${MARKER}): ownership check returned 500; not deleted`]);
  });

  test('does not check the token for statuses that are not auth-like', async () => {
    const client = new FakeClient({ get: seq(res(502)) });
    const { tracker, warnings } = setUp(client);

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]']);
    expect(warnings).toEqual([`#7 (${MARKER}): ownership check returned 502; not deleted`]);
  });
});

test.describe('create tracking', () => {
  test('sends each create exactly once and tracks the returned id', async () => {
    const client = new FakeClient({ get: seq(NOT_FOUND) });
    const { tracker, createCalls } = setUp(client);

    const response = await tracker.create(BOOKING);

    expect(response.status()).toBe(201);
    expect(createCalls).toEqual([BOOKING]);
    await tracker.cleanUp();
    expect(client.calls).toEqual(['GET 7 [T1]']);
  });

  test('ignores a definitive 4xx rejection without an id', async () => {
    const client = new FakeClient({});
    const { tracker, warnings } = setUp(client, async () => res(409, { error: 'Failed to create booking' }));

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('cleans up an unexpected id even when the status is an error', async () => {
    const client = new FakeClient({ get: seq(owned(9), NOT_FOUND), delete: seq(res(202)) });
    const { tracker, warnings } = setUp(client, async () => res(400, { bookingid: 9 }));

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 9 [T1]', 'DELETE 9 [T1]', 'GET 9 [T1]']);
    expect(warnings).toEqual([]);
  });

  test('does not retry a create that failed without a response', async () => {
    const client = new FakeClient({ list: seq(res(200, { bookings: [] })) });
    const { tracker, createCalls } = setUp(client, async () => {
      throw new Error('[transport] POST /api/booking: ECONNRESET');
    });

    await expect(tracker.create(BOOKING)).rejects.toThrow('ECONNRESET');
    await tracker.cleanUp();

    expect(createCalls).toHaveLength(1);
  });
});

test.describe('ambiguous-create recovery', () => {
  const match = (id: number, lastname = MARKER): CreatedBooking => ({ ...BOOKING, lastname, bookingid: id });

  test('adopts exactly one exact marker match and deletes it through the ownership check', async () => {
    const client = new FakeClient({
      list: seq(res(200, { bookings: [match(3, 'Other'), match(11)] })),
      get: seq(owned(11), NOT_FOUND),
      delete: seq(res(202)),
    });
    const { tracker, warnings } = setUp(client, async () => {
      throw new Error('[transport] POST /api/booking: timeout');
    });

    await tracker.create(BOOKING).catch(() => undefined);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]', 'GET 11 [T1]', 'DELETE 11 [T1]', 'GET 11 [T1]']);
    expect(warnings).toEqual([]);
  });

  test('searches for a create that failed without a response only after its window has passed', async () => {
    let failedAt = 0;
    // An early failure without a response (connection reset); the server completes the create
    // 10ms later, within the 20ms window.
    const client = new FakeClient({
      list: () => res(200, { bookings: Date.now() - failedAt >= 10 ? [match(11)] : [] }),
      get: seq(owned(11), NOT_FOUND),
      delete: seq(res(202)),
    });
    const { tracker, warnings } = setUp(client, async () => {
      failedAt = Date.now();
      throw new Error('[transport] POST /api/booking: read ECONNRESET');
    });

    await tracker.create(BOOKING).catch(() => undefined);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]', 'GET 11 [T1]', 'DELETE 11 [T1]', 'GET 11 [T1]']);
    expect(warnings).toEqual([]);
  });

  test('deletes nothing and warns when no booking matches the marker', async () => {
    const client = new FakeClient({ list: seq(res(200, { bookings: [match(3, 'Other')] })) });
    const { tracker, warnings } = setUp(client, async () => res(201, {}));

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]']);
    expect(warnings).toEqual([
      `ambiguous create ${MARKER} (room 2, check-in 2031-06-14) [status 201 without a booking id]: 0 exact matches; nothing deleted, cleanup not guaranteed`,
    ]);
  });

  test('deletes nothing and warns when several bookings match the marker', async () => {
    const client = new FakeClient({ list: seq(res(200, { bookings: [match(11), match(12)] })) });
    const { tracker, warnings } = setUp(client, async () => res(500));

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]']);
    expect(warnings).toEqual([
      `ambiguous create ${MARKER} (room 2, check-in 2031-06-14) [status 500 without a booking id]: 2 exact matches; nothing deleted, cleanup not guaranteed`,
    ]);
  });

  test('treats a 500 lookup with [] as unusable, not as "no match"', async () => {
    const client = new FakeClient({ list: seq(res(500, [])), validate: seq(res(200)) });
    const { tracker, warnings } = setUp(client, async () => res(503));

    await tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]', 'VALIDATE [T1]']);
    expect(warnings).toEqual([
      `ambiguous create ${MARKER} (room 2, check-in 2031-06-14) [status 503 without a booking id]: booking lookup returned 500; cleanup not guaranteed`,
    ]);
  });

  test('warns without searching when the create has no marker', async () => {
    const client = new FakeClient({});
    const { tracker, warnings } = setUp(client, async () => res(201, {}));

    await tracker.create({ roomid: 2 });
    await tracker.cleanUp();

    expect(client.calls).toEqual([]);
    expect(warnings).toEqual([
      'ambiguous create <no marker> (room 2, check-in unknown) [status 201 without a booking id]: no marker or room to search by; cleanup not guaranteed',
    ]);
  });

  test('adds the late-create note for a create still in flight after the wait', async () => {
    const client = new FakeClient({ list: seq(res(200, { bookings: [] })) });
    const { tracker, warnings } = setUp(client, () => new Promise<CleanupResponse>(() => {}));

    void tracker.create(BOOKING); // never settles, like a create interrupted by a test timeout
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]']);
    expect(warnings).toEqual([
      `ambiguous create ${MARKER} (room 2, check-in 2031-06-14) [create still in flight after waiting 0.02s in teardown]: 0 exact matches; nothing deleted, cleanup not guaranteed; the booking may still be created after this lookup and could remain on the site`,
    ]);
  });

  // Late answers: the create is still unanswered when the wait ends, then answers while cleanup is
  // searching for it. The LIST response is held back until that answer has been handled, so the
  // order is fixed without relying on timing.
  test('records a create that fails after the wait only once, as in flight', async () => {
    let failCreate: (error: Error) => void = () => {};
    let lateCreate: Promise<unknown> = Promise.resolve();
    const noBookings = () => ({ bookings: [] });
    const client = new FakeClient({
      list: () => {
        failCreate(new Error('[transport] POST /api/booking: Timeout 35000ms exceeded'));
        return { status: () => 200, ok: () => true, json: () => lateCreate.then(noBookings, noBookings) };
      },
    });
    const { tracker, warnings } = setUp(
      client,
      () =>
        new Promise<CleanupResponse>((_, reject) => {
          failCreate = reject;
        }),
    );

    lateCreate = tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]']);
    expect(warnings).toEqual([
      `ambiguous create ${MARKER} (room 2, check-in 2031-06-14) [create still in flight after waiting 0.02s in teardown]: 0 exact matches; nothing deleted, cleanup not guaranteed; the booking may still be created after this lookup and could remain on the site`,
    ]);
  });

  test('does not search again for a create answered 500 without an id after the wait', async () => {
    let answerCreate: (response: CleanupResponse) => void = () => {};
    let lateCreate: Promise<unknown> = Promise.resolve();
    const client = new FakeClient({
      list: () => {
        answerCreate(res(500));
        return { status: () => 200, ok: () => true, json: () => lateCreate.then(() => ({ bookings: [] })) };
      },
    });
    const { tracker, warnings } = setUp(
      client,
      () =>
        new Promise<CleanupResponse>((resolve) => {
          answerCreate = resolve;
        }),
    );

    lateCreate = tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]']);
    expect(warnings).toEqual([
      `ambiguous create ${MARKER} (room 2, check-in 2031-06-14) [create still in flight after waiting 0.02s in teardown]: 0 exact matches; nothing deleted, cleanup not guaranteed; the booking may still be created after this lookup and could remain on the site`,
    ]);
  });

  test('still deletes by id a create that succeeds after the wait', async () => {
    let answerCreate: (response: CleanupResponse) => void = () => {};
    let lateCreate: Promise<unknown> = Promise.resolve();
    const client = new FakeClient({
      list: () => {
        answerCreate(res(201, { bookingid: 7 }));
        return { status: () => 200, ok: () => true, json: () => lateCreate.then(() => ({ bookings: [] })) };
      },
      get: seq(owned(), NOT_FOUND),
      delete: seq(res(202)),
    });
    const { tracker, warnings } = setUp(
      client,
      () =>
        new Promise<CleanupResponse>((resolve) => {
          answerCreate = resolve;
        }),
    );

    lateCreate = tracker.create(BOOKING);
    await tracker.cleanUp();

    expect(client.calls).toEqual(['LIST room 2 [T1]', 'GET 7 [T1]', 'DELETE 7 [T1]', 'GET 7 [T1]']);
    expect(warnings).toEqual([
      `ambiguous create ${MARKER} (room 2, check-in 2031-06-14) [create still in flight after waiting 0.02s in teardown]: 0 exact matches; nothing deleted, cleanup not guaranteed; the booking may still be created after this lookup and could remain on the site`,
    ]);
  });

  test('cleans up by id a create that finishes during the wait', async () => {
    const client = new FakeClient({ get: seq(owned(), NOT_FOUND), delete: seq(res(202)) });
    const { tracker, warnings } = setUp(
      client,
      () => new Promise<CleanupResponse>((resolve) => setTimeout(() => resolve(res(201, { bookingid: 7 })), 5)),
    );

    void tracker.create(BOOKING); // still pending when cleanup starts
    await tracker.cleanUp();

    expect(client.calls).toEqual(['GET 7 [T1]', 'DELETE 7 [T1]', 'GET 7 [T1]']);
    expect(warnings).toEqual([]);
  });
});
