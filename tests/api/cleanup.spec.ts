import { test, expect } from '../../src/fixtures/api';
import { expectStatus } from '../../src/api/http';
import { buildBooking, type CreatedBooking } from '../../src/data/booking-data';

// Verifies the cleanup wiring end to end: the same tracker every write test uses, against the
// live API. Like the other write tests, it runs only with ALLOW_LIVE_WRITES=true.
//
// Limitation: a pass shows the booking existed with this test's marker, cleanup raised no warning,
// and the booking is gone. If a site reset removes the booking between the precondition read and
// cleanup's own ownership check, cleanup finds it already gone and stays silent, so this test
// cannot tell "cleanup deleted it" from "a reset deleted it" in that window.

test.describe('Booking cleanup', { tag: ['@live', '@writes'] }, () => {
  test('deletes the booking it created and reports no warnings', async ({ slot, bookingTracker, bookingApi }) => {
    // Cleanup runs inside the test, so allow more than the default 30s. If the test still times
    // out, the fixture's teardown awaits the same cleanup run.
    test.slow();

    const booking = buildBooking(slot.roomid, slot.checkin);
    const where = `${booking.lastname} (room ${slot.roomid}, check-in ${slot.checkin})`;

    const bookingid = await test.step('Arrange: create a tracked booking', async () => {
      const createResponse = await bookingTracker.create(booking);
      await expectStatus(createResponse, 201, 'arrange: create booking');
      const created: CreatedBooking = await createResponse.json();
      return created.bookingid;
    });

    // Precondition: the booking exists and carries this test's marker, so the 404 below means
    // something.
    await test.step('Verify: booking exists and carries the test marker', async () => {
      const before = await bookingApi.get(bookingid);
      await expectStatus(before, 200, `precondition: booking #${bookingid} exists before cleanup`);
      const { lastname } = await before.json();
      expect(lastname, `[precondition] booking #${bookingid} carries this test's marker`).toBe(booking.lastname);
    });

    await test.step('Act: run cleanup', () => bookingTracker.cleanUp());

    await test.step('Verify: cleanup reported no warnings and the booking is gone', async () => {
      const warnings = test
        .info()
        .annotations.filter((annotation) => annotation.type === 'cleanup-warning')
        .map((annotation) => annotation.description);
      expect(warnings, `cleanup of ${where} reported no warnings`).toEqual([]);
      const after = await bookingApi.get(bookingid);
      await expectStatus(after, 404, `booking #${bookingid} ${where} is gone after cleanup`);
    });
  });
});
