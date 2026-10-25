import { test as base, expect } from '../../src/fixtures/api';
import { expectStatus } from '../../src/api/http';
import { buildBooking, type CreatedBooking } from '../../src/data/booking-data';

// Verifies the cleanup every write test relies on, end to end against the live API: a booking
// created through the createBooking fixture and removed by the bookingTracker fixture's automatic
// after-test cleanup. Like the other write tests, it runs only with ALLOW_LIVE_WRITES=true.
//
// That cleanup runs in fixture teardown, after the test body, so its result is checked in the
// teardown of this spec's bookingApi override: bookingTracker depends on bookingApi, so Playwright
// tears the override down only after cleanup has finished.
//
// Limitation: a pass shows the booking existed with this test's marker, cleanup raised no warning,
// and the booking is gone. If a site reset removes the booking between the precondition read and
// cleanup's own ownership check, cleanup finds it already gone and stays silent, so this test
// cannot tell "cleanup deleted it" from "a reset deleted it" in that window.

interface CreatedForCleanup {
  bookingid?: number;
  where?: string;
}

const test = base.extend<{ created: CreatedForCleanup }>({
  created: async ({}, use) => {
    await use({});
  },

  bookingApi: async ({ bookingApi, created }, use, testInfo) => {
    await use(bookingApi);
    // Runs after the automatic cleanup. Checked only after a passing test body: a failed test
    // already reports the real problem, and any cleanup warnings are in the report.
    if (testInfo.status !== 'passed') return;

    await base.step('Verify after automatic cleanup: no warnings and the booking is gone', async () => {
      const { bookingid, where } = created;
      expect(bookingid, '[setup] the test recorded the booking it created').toBeDefined();
      const warnings = testInfo.annotations
        .filter((annotation) => annotation.type === 'cleanup-warning')
        .map((annotation) => annotation.description);
      expect(warnings, `cleanup of ${where} reported no warnings`).toEqual([]);
      const after = await bookingApi.get(bookingid!);
      await expectStatus(after, 404, `booking #${bookingid} ${where} is gone after cleanup`);
    });
  },
});

test.describe('Booking cleanup', { tag: ['@live', '@writes'] }, () => {
  test('deletes the booking it created and reports no warnings', async ({
    slot,
    createBooking,
    bookingApi,
    created,
  }) => {
    const booking = buildBooking(slot.roomid, slot.checkin);
    created.where = `${booking.lastname} (room ${slot.roomid}, check-in ${slot.checkin})`;

    created.bookingid = await test.step('Arrange: create a booking through createBooking', async () => {
      const createResponse = await createBooking(booking);
      await expectStatus(createResponse, 201, 'arrange: create booking');
      const body: CreatedBooking = await createResponse.json();
      return body.bookingid;
    });
    const bookingid = created.bookingid;

    // Precondition: the booking exists and carries this test's marker, so the 404 after cleanup
    // means something.
    await test.step('Verify: booking exists and carries the test marker', async () => {
      const before = await bookingApi.get(bookingid);
      await expectStatus(before, 200, `precondition: booking #${bookingid} exists before cleanup`);
      const { lastname } = await before.json();
      expect(lastname, `[precondition] booking #${bookingid} carries this test's marker`).toBe(booking.lastname);
    });

    // Act and the final check happen after this body: the fixture's automatic cleanup, then the
    // check in the bookingApi override above.
  });
});
