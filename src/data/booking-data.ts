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
