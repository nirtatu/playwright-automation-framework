// Defaults are the public demo credentials published by the application under test.
// Set ADMIN_USERNAME / ADMIN_PASSWORD to run against an environment with private credentials.
export const adminCredentials = {
  username: process.env.ADMIN_USERNAME ?? 'admin',
  password: process.env.ADMIN_PASSWORD ?? 'password',
};

// Tests that create, update or delete bookings on BASE_URL run only with ALLOW_LIVE_WRITES=true
// (exactly). Decided by src/config/live-writes.ts, enforced by the API fixtures in
// src/fixtures/api.ts.
export const allowLiveWritesFlag = process.env.ALLOW_LIVE_WRITES;
