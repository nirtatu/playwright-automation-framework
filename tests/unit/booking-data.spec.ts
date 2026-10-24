import { test, expect } from '@playwright/test';
import { addDays, findFreeWindow, type Booking, type CreatedBooking } from '../../src/data/booking-data';

// Offline unit tests for src/data/booking-data.ts. `today` and `random` are injected, so the
// free-window search is deterministic. ESLint keeps tests/unit free of HTTP clients and fixtures.

// Filler for the CreatedBooking fields that stay() does not set; stay() replaces the booking id and the
// dates, which are the only fields the free-window search reads.
const BOOKING: Booking = {
  roomid: 2,
  firstname: 'Playwright',
  lastname: 'Auto-unit-marker',
  depositpaid: false,
  bookingdates: { checkin: '2031-06-14', checkout: '2031-06-16' },
};

test.describe('free-window selection', () => {
  const TODAY = '2026-01-01';
  const START = addDays(TODAY, 730); // random() = 0 gives the earliest start
  const END = addDays(START, 30);
  const stay = (checkin: string, checkout: string): CreatedBooking => ({
    ...BOOKING,
    bookingid: 1,
    bookingdates: { checkin, checkout },
  });
  const first = (bookings: CreatedBooking[]) => findFreeWindow(bookings, { today: TODAY, random: () => 0 });

  test('returns the start when the room has no bookings', () => {
    expect(first([])).toBe(START);
  });

  test('treats a stay ending the day before the window as a clash (one-day margin)', () => {
    expect(first([stay(addDays(START, -3), addDays(START, -1))])).toBeUndefined();
  });

  test('accepts a stay ending two days before the window', () => {
    expect(first([stay(addDays(START, -4), addDays(START, -2))])).toBe(START);
  });

  test('treats a stay starting on the last day of the window as a clash', () => {
    expect(first([stay(END, addDays(END, 2))])).toBeUndefined();
  });

  test('accepts a stay starting the day after the window', () => {
    expect(first([stay(addDays(END, 1), addDays(END, 3))])).toBe(START);
  });

  test('treats a stay spanning the whole window as a clash', () => {
    expect(first([stay(addDays(START, -10), addDays(END, 10))])).toBeUndefined();
  });

  test('tries other windows before giving up', () => {
    const picks = [0, 0.5];
    const second = addDays(TODAY, 730 + Math.floor(0.5 * 3650));
    const result = findFreeWindow([stay(START, addDays(START, 2))], { today: TODAY, random: () => picks.shift()! });

    expect(result).toBe(second);
  });

  test('gives up after exactly 20 failed attempts', () => {
    let attempts = 0;
    const random = () => {
      attempts++;
      return 0; // every attempt picks the same, occupied window
    };

    const result = findFreeWindow([stay(START, addDays(START, 2))], { today: TODAY, random });

    expect(result).toBeUndefined();
    expect(attempts).toBe(20);
  });
});
