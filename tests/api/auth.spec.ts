import { test, expect } from '../../src/fixtures/api';
import { login } from '../../src/api/auth-api';
import { expectStatus } from '../../src/api/http';
import { adminCredentials } from '../../src/config/env';

test.describe('Auth API', { tag: '@live' }, () => {
  test('login with valid credentials returns a token', async ({ request }) => {
    const response = await login(request, adminCredentials);

    await expectStatus(response, 200);
    const body = await response.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
  });

  test('login with a wrong password is rejected', async ({ request }) => {
    const response = await login(request, { ...adminCredentials, password: 'wrong-password' });

    await expectStatus(response, 401);
    const body = await response.json();
    // Assert on the field and on the keys, not the whole body: if a token were ever returned here,
    // a failure message must not print its value.
    expect(body.error).toBe('Invalid credentials');
    expect(Object.keys(body), 'a rejected login must not return a token').not.toContain('token');
  });
});
