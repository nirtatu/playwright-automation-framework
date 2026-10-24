import { test, expect } from '../../src/fixtures/api';
import { createValidBooking, expectStillOwned } from '../../src/api/booking-checks';
import { expectStatus, send } from '../../src/api/http';
import { addDays, buildBooking, type Booking, type CreatedBooking } from '../../src/data/booking-data';

// Every booking is created through the `createBooking` fixture, which cleans it up afterwards,
// and placed inside `slot`: a room and date window verified free of existing bookings.
// In-test writes are ownership-checked first (`expectStillOwned`, src/api/booking-checks.ts).

// Statuses of unauthenticated requests are recorded as observations, not asserted: the live
// service has answered both 500 and 403.
function recordObservedStatus(request: string, status: number): void {
  test.info().annotations.push({ type: 'observed-status', description: `${request} returned ${status}` });
}

test.describe('Booking API', { tag: ['@live', '@writes'] }, () => {
  test('creates a booking and reads it back', async ({ slot, createBooking, bookingApi }) => {
    const booking = buildBooking(slot.roomid, slot.checkin);

    const created = await test.step('Act: create booking', async () => {
      const createResponse = await createBooking(booking);
      await expectStatus(createResponse, 201);
      const createdBooking: CreatedBooking = await createResponse.json();
      expect(createdBooking).toMatchObject(booking);
      expect(Number.isInteger(createdBooking.bookingid) && createdBooking.bookingid > 0).toBe(true);
      return createdBooking;
    });

    await test.step('Verify: booking is read back unchanged', async () => {
      const readResponse = await bookingApi.get(created.bookingid);
      await expectStatus(readResponse, 200);
      expect(await readResponse.json()).toMatchObject({ ...booking, bookingid: created.bookingid });
    });
  });

  test('updates a booking', async ({ slot, createBooking, bookingApi }) => {
    const original = buildBooking(slot.roomid, slot.checkin);

    const { bookingid } = await test.step('Arrange: create booking', () => createValidBooking(createBooking, original));

    // The last name (ownership marker) is kept. New dates stay inside the free slot and do not
    // overlap the original stay, which the API could reject as a conflict with itself.
    const checkin = addDays(slot.checkin, 7);
    const changes: Booking = {
      ...original,
      firstname: 'Updated',
      depositpaid: true,
      bookingdates: { checkin, checkout: addDays(checkin, 2) },
    };

    await test.step('Verify: booking is still owned by this test', () =>
      expectStillOwned(bookingApi, bookingid, original.lastname));

    await test.step('Act: update booking', async () => {
      const updateResponse = await bookingApi.update(bookingid, changes);
      await expectStatus(updateResponse, 200);
      expect(await updateResponse.json()).toMatchObject({ bookingid, booking: changes });
    });

    await test.step('Verify: updated booking is read back', async () => {
      const readResponse = await bookingApi.get(bookingid);
      await expectStatus(readResponse, 200);
      expect(await readResponse.json()).toMatchObject({ ...changes, bookingid });
    });
  });

  test('deletes a booking', async ({ slot, createBooking, bookingApi }) => {
    const booking = buildBooking(slot.roomid, slot.checkin);

    const { bookingid } = await test.step('Arrange: create booking', () => createValidBooking(createBooking, booking));

    await test.step('Verify: booking is still owned by this test', () =>
      expectStillOwned(bookingApi, bookingid, booking.lastname));

    await test.step('Act: delete booking', async () => {
      const deleteResponse = await bookingApi.delete(bookingid);
      await expectStatus(deleteResponse, 202);
    });

    await test.step('Verify: booking is deleted', async () => {
      const readResponse = await bookingApi.get(bookingid);
      await expectStatus(readResponse, 404);
    });
  });

  test('rejects a booking without a first name', async ({ slot, createBooking }) => {
    const invalid: Partial<Booking> = buildBooking(slot.roomid, slot.checkin);
    delete invalid.firstname;

    const response = await createBooking(invalid);

    await expectStatus(response, 400);
    const body = await response.json();
    expect(body.errors).toContain('Firstname should not be blank');
    expect(body).not.toHaveProperty('bookingid');
  });

  test('rejects a check-out date before the check-in date', async ({ slot, createBooking }) => {
    const booking = buildBooking(slot.roomid, slot.checkin, {
      bookingdates: { checkin: addDays(slot.checkin, 4), checkout: addDays(slot.checkin, 2) },
    });

    const response = await createBooking(booking);

    await expectStatus(response, 409);
    expect(await response.json()).toMatchObject({ error: 'Failed to create booking' });
  });

  test('rejects a booking that overlaps an existing booking for the same room', async ({ slot, createBooking }) => {
    const first = buildBooking(slot.roomid, slot.checkin);

    await test.step('Arrange: create the first booking', () => createValidBooking(createBooking, first));

    await test.step('Act: create an overlapping booking and verify it is rejected', async () => {
      // Same room and dates, different marker. The only possible clash is with this test's booking.
      const response = await createBooking(buildBooking(slot.roomid, slot.checkin));

      await expectStatus(response, 409);
      expect(await response.json()).toMatchObject({ error: 'Failed to create booking' });
    });
  });

  test('does not expose a booking to an unauthenticated read', async ({ slot, createBooking, request }) => {
    const booking = buildBooking(slot.roomid, slot.checkin);

    const { bookingid } = await test.step('Arrange: create booking', () => createValidBooking(createBooking, booking));

    const response = await test.step('Act: read booking without a token', async () => {
      // Deliberately sent without the token cookie.
      const readResponse = await send(`GET /api/booking/${bookingid} without token`, () =>
        request.get(`/api/booking/${bookingid}`),
      );
      recordObservedStatus('unauthenticated GET', readResponse.status());
      return readResponse;
    });

    await test.step('Verify: booking data is not exposed', async () => {
      expect(response.ok(), 'unauthenticated read must not succeed').toBe(false);
      const body = await response.text();
      expect(body).not.toContain(booking.lastname);
      expect(body).not.toContain(booking.bookingdates.checkin);
    });
  });

  test('keeps a booking intact after an unauthenticated delete', async ({
    slot,
    createBooking,
    bookingApi,
    request,
  }) => {
    const booking = buildBooking(slot.roomid, slot.checkin);

    const { bookingid } = await test.step('Arrange: create booking', () => createValidBooking(createBooking, booking));

    // Ownership is checked with the token; the DELETE below is deliberately sent without it.
    await test.step('Verify: booking is still owned by this test', () =>
      expectStillOwned(bookingApi, bookingid, booking.lastname));

    await test.step('Act: delete booking without a token', async () => {
      const response = await send(`DELETE /api/booking/${bookingid} without token`, () =>
        request.delete(`/api/booking/${bookingid}`),
      );
      recordObservedStatus('unauthenticated DELETE', response.status());
    });

    await test.step('Verify: booking is still intact', async () => {
      const readResponse = await bookingApi.get(bookingid);
      await expectStatus(readResponse, 200);
      expect(await readResponse.json()).toMatchObject({ ...booking, bookingid });
    });
  });
});
