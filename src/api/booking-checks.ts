import { expect, type APIResponse } from '@playwright/test';
import type { Booking, CreatedBooking } from '../data/booking-data';
import type { BookingApi } from './booking-api';
import { expectStatus } from './http';

// Booking helpers for API specs that combine a request with its expected outcome. Unlike the API
// clients, these assert. The create function is typed structurally (it matches the `createBooking`
// fixture) so this module does not import src/fixtures, which already imports src/api.

/** Creates a booking that the test needs as a precondition, and fails unless it was created (201). */
export async function createValidBooking(
  createBooking: (booking: Partial<Booking>) => Promise<APIResponse>,
  booking: Booking,
): Promise<CreatedBooking> {
  const response = await createBooking(booking);
  await expectStatus(response, 201, 'arrange: create booking');
  return response.json();
}

// In-test writes use the id from this test's own create response. Re-read it first: if an
// environment reset reused the id for someone else's booking, fail instead of writing to it.
export async function expectStillOwned(bookingApi: BookingApi, bookingid: number, marker: string): Promise<void> {
  const response = await bookingApi.get(bookingid);
  await expectStatus(response, 200, 'ownership check before write');
  const { lastname } = await response.json();
  expect(lastname, `[ownership] booking #${bookingid} must still carry this test's marker before it is changed`).toBe(
    marker,
  );
}
