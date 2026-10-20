// Type aliases rather than interfaces so they satisfy expect().toMatchObject().
export type BookingDates = {
  checkin: string; // YYYY-MM-DD
  checkout: string;
};

export type Booking = {
  roomid: number;
  firstname: string;
  lastname: string;
  depositpaid: boolean;
  bookingdates: BookingDates;
};

export type CreatedBooking = Booking & {
  bookingid: number;
};

/** Unique per booking. The last name doubles as the ownership marker checked before cleanup. */
export function uniqueMarker(): string {
  // The API accepts last names of 3–30 characters; this is about 19.
  return `Auto-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Tests place every booking inside this window, so they never collide with existing data.
export const SLOT_WINDOW_DAYS = 30;

/**
 * First day of a SLOT_WINDOW_DAYS window, 2–12 years ahead, that overlaps none of `bookings`,
 * or undefined after 20 random tries. `today` and `random` are injectable for unit tests.
 */
export function findFreeWindow(
  bookings: CreatedBooking[],
  {
    today = new Date().toISOString().slice(0, 10),
    random = Math.random,
  }: { today?: string; random?: () => number } = {},
): string | undefined {
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = addDays(today, 730 + Math.floor(random() * 3650)); // 2–12 years ahead
    const end = addDays(start, SLOT_WINDOW_DAYS);
    // ISO dates compare correctly as strings. Back-to-back stays do not clash under the API's
    // overlap rule; the spare day before the window is a deliberate extra margin.
    const clash = bookings.some((b) => b.bookingdates.checkin <= end && b.bookingdates.checkout >= addDays(start, -1));
    if (!clash) return start;
  }
  return undefined;
}

/**
 * A valid two-night booking with a fresh marker. Never add email and phone: when both are
 * present the application also posts a message to the shared admin inbox.
 */
export function buildBooking(roomid: number, checkin: string, overrides: Partial<Booking> = {}): Booking {
  return {
    roomid,
    firstname: 'Playwright',
    lastname: uniqueMarker(),
    depositpaid: false,
    bookingdates: { checkin, checkout: addDays(checkin, 2) },
    ...overrides,
  };
}
