import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { Booking } from '../data/booking-data';
import { send } from './http';

/**
 * Thin client for /api/booking. Every method sends its request exactly once and returns the
 * raw response; assertions belong in the tests. All calls except create need the admin token.
 */
export class BookingApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  private get headers() {
    return { Cookie: `token=${this.token}` };
  }

  // Partial: negative tests deliberately send incomplete bookings (e.g. without a first name).
  // timeoutMs overrides the request context's default timeout (actionTimeout in the config).
  create(booking: Partial<Booking>, timeoutMs?: number): Promise<APIResponse> {
    return send('POST /api/booking', () => this.request.post('/api/booking', { data: booking, timeout: timeoutMs }));
  }

  get(id: number): Promise<APIResponse> {
    return send(`GET /api/booking/${id}`, () => this.request.get(`/api/booking/${id}`, { headers: this.headers }));
  }

  listForRoom(roomid: number): Promise<APIResponse> {
    return send(`GET /api/booking?roomid=${roomid}`, () =>
      this.request.get('/api/booking', { params: { roomid }, headers: this.headers }),
    );
  }

  update(id: number, booking: Booking): Promise<APIResponse> {
    return send(`PUT /api/booking/${id}`, () =>
      this.request.put(`/api/booking/${id}`, { data: booking, headers: this.headers }),
    );
  }

  delete(id: number): Promise<APIResponse> {
    return send(`DELETE /api/booking/${id}`, () =>
      this.request.delete(`/api/booking/${id}`, { headers: this.headers }),
    );
  }
}
