import type { APIRequestContext, APIResponse } from '@playwright/test';
import { send } from './http';

/**
 * One entry of `GET /api/room`, limited to the field the framework reads. The full room shape is
 * asserted at runtime by tests/api/rooms.spec.ts, not declared here.
 */
export type Room = {
  roomid: number;
};

// Public, read-only endpoint; no token needed. Returns the raw response (`{ rooms: Room[] }`).
export function listRooms(request: APIRequestContext): Promise<APIResponse> {
  return send('GET /api/room', () => request.get('/api/room'));
}
