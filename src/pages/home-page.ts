import type { Locator, Page } from '@playwright/test';

/** One room card as displayed: the room id from its "Book now" link, its title and nightly price. */
export type DisplayedRoom = {
  roomid: number;
  type: string;
  roomPrice: number;
};

/** One card's "Book now" link: the room id from its path and the dates from its query. */
export type ReservationLink = {
  roomid: number;
  checkin: string; // YYYY-MM-DD
  checkout: string;
};

/**
 * The public home page. Exposes locators and readers that return plain data; specs make the
 * assertions, as they do with the API clients.
 */
export class HomePage {
  readonly roomsSection: Locator;
  readonly roomsHeading: Locator;
  readonly bookNowLinks: Locator;
  readonly roomCards: Locator;

  constructor(private readonly page: Page) {
    // Scoped to `#rooms` (the navbar's own anchor): the hero banner also has a "Book Now" link, and
    // role-name matching is case-insensitive.
    this.roomsSection = page.locator('#rooms');
    this.roomsHeading = this.roomsSection.getByRole('heading', { name: 'Our Rooms' });
    this.bookNowLinks = this.roomsSection.getByRole('link', { name: 'Book now' });
    // The site has no test ids; `room-card` is the only class specific to a card.
    this.roomCards = this.roomsSection.locator('.room-card');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  /**
   * Reads every rendered room card as it is now; it does not wait, so call it once the cards have
   * rendered (for example after asserting their count). Throws a `[page]` error for a card without
   * exactly one "Book now" link and one title, or whose link path or price cannot be parsed, so a
   * test never compares partial values.
   */
  async readRoomCards(): Promise<DisplayedRoom[]> {
    return this.readCards(readRoomCard);
  }

  /**
   * Reads every rendered card's "Book now" link, with the same rules as readRoomCards(). Throws a
   * `[page]` error for a link without a `/reservation/<id>` path or without `checkin` and `checkout`
   * query dates in `YYYY-MM-DD` form.
   */
  async readReservationLinks(): Promise<ReservationLink[]> {
    return this.readCards(readReservationLink);
  }

  private async readCards<T>(read: (card: Locator, where: string) => Promise<T>): Promise<T[]> {
    const cards = await this.roomCards.all();
    return Promise.all(cards.map((card, index) => read(card, `room card ${index + 1} of ${cards.length}`)));
  }
}

async function readRoomCard(card: Locator, where: string): Promise<DisplayedRoom> {
  const { roomid } = await readBookNowLink(card, where);
  const title = await exactlyOne(card.getByRole('heading', { level: 5 }), `${where}: title (h5 heading)`);

  const type = (await title.innerText()).trim();

  const text = await card.innerText();
  const price = /£(\d+(?:\.\d+)?)\s*per night/.exec(text);
  if (!price) {
    throw new Error(`[page] ${where}: no "£<amount> per night" price in ${JSON.stringify(text.slice(0, 200))}`);
  }

  return { roomid, type, roomPrice: Number(price[1]) };
}

async function readReservationLink(card: Locator, where: string): Promise<ReservationLink> {
  const { roomid, url } = await readBookNowLink(card, where);
  return { roomid, checkin: queryDate(url, 'checkin', where), checkout: queryDate(url, 'checkout', where) };
}

// The card's single "Book now" link. It carries the default dates as a query
// (`/reservation/1?checkin=…`), so the id is read from the path only. The base URL is irrelevant:
// only the path and query are used.
async function readBookNowLink(card: Locator, where: string): Promise<{ roomid: number; url: URL }> {
  const link = await exactlyOne(card.getByRole('link', { name: 'Book now' }), `${where}: "Book now" link`);
  const href = await link.getAttribute('href');
  const url = href === null ? null : new URL(href, 'https://base.invalid');
  const id = url === null ? null : /^\/reservation\/(\d+)$/.exec(url.pathname);
  if (!url || !id) {
    throw new Error(`[page] ${where}: "Book now" link ${JSON.stringify(href)} has no /reservation/<id> path`);
  }
  return { roomid: Number(id[1]), url };
}

function queryDate(url: URL, name: 'checkin' | 'checkout', where: string): string {
  const value = url.searchParams.get(name);
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`[page] ${where}: "Book now" link has no YYYY-MM-DD "${name}" (got ${JSON.stringify(value)})`);
  }
  return value;
}

// Counts without waiting, so a missing or duplicated element fails at once with a `[page]` error
// instead of a locator timeout or a strict-mode violation.
async function exactlyOne(locator: Locator, what: string): Promise<Locator> {
  const count = await locator.count();
  if (count !== 1) throw new Error(`[page] ${what}: expected exactly 1, found ${count}`);
  return locator;
}
