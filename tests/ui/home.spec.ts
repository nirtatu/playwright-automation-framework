import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test('shows the rooms section with at least one bookable room', async ({ page }) => {
    await page.goto('/');

    // Scope to the rooms section: the hero banner also has a "Book Now" link, and
    // role-name matching is case-insensitive. `#rooms` is the navbar's own anchor.
    const roomsSection = page.locator('#rooms');
    await expect(roomsSection.getByRole('heading', { name: 'Our Rooms' })).toBeVisible();

    // Room names and branding are editable on the shared site, so assert on
    // structure: at least one room card with a "Book now" link to a reservation.
    const bookNowLinks = roomsSection.getByRole('link', { name: 'Book now' });
    await expect(bookNowLinks.first()).toBeVisible();
    await expect(bookNowLinks.first()).toHaveAttribute('href', /\/reservation\/\d+/);
  });
});
