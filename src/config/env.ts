// Defaults are the public demo credentials published by the application under test.
// Set ADMIN_USERNAME / ADMIN_PASSWORD to run against an environment with private credentials.
export const adminCredentials = {
  username: process.env.ADMIN_USERNAME ?? 'admin',
  password: process.env.ADMIN_PASSWORD ?? 'password',
};
