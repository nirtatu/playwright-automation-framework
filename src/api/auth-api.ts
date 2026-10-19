import type { APIRequestContext, APIResponse } from '@playwright/test';
import { send } from './http';

export interface Credentials {
  username: string;
  password: string;
}

// Returns the raw response so tests can assert on status. The token is in the JSON body;
// the endpoint sets no cookie, so callers pass it on explicitly.
export function login(request: APIRequestContext, credentials: Credentials): Promise<APIResponse> {
  return send('POST /api/auth/login', () => request.post('/api/auth/login', { data: credentials }));
}

// 200 for a valid token, 403 for an invalid one.
export function validateToken(request: APIRequestContext, token: string): Promise<APIResponse> {
  return send('POST /api/auth/validate', () => request.post('/api/auth/validate', { data: { token } }));
}
