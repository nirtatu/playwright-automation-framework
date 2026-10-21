import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

const OFFLINE_MESSAGE = 'Unit-tested code must not depend on HTTP clients, fixtures or environment config.';

export default defineConfig(
  { ignores: ['node_modules/', 'playwright-report/', 'test-results/', 'blob-report/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Type-aware rules: a missing `await` on a request or assertion passes tsc but makes a
    // test pass or fail for the wrong reason.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      // Status assertions go through the shared helper, which wraps expect().
      'playwright/expect-expect': ['warn', { assertFunctionNames: ['expectStatus'] }],
      'playwright/no-wait-for-timeout': 'error',
    },
  },
  // Offline guarantee for the unit project: the code it covers and the unit tests themselves
  // must not reach an HTTP client, Playwright fixtures or environment config.
  {
    files: ['src/cleanup/**/*.ts', 'src/data/**/*.ts', 'src/security/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@playwright/test', message: 'Keep this module free of Playwright so it stays unit-testable.' },
          ],
          patterns: [{ group: ['**/api/*', '**/fixtures/*', '**/config/*'], message: OFFLINE_MESSAGE }],
        },
      ],
    },
  },
  {
    files: ['tests/unit/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              importNames: ['request', 'APIRequestContext', 'APIResponse', 'chromium', 'firefox', 'webkit'],
              message: 'Unit tests must stay offline: inject fakes instead.',
            },
          ],
          // One exception: src/api/http.ts (send, expectStatus, TransportError) has no network side
          // effects on import, so its redaction can be tested offline. Other API clients stay banned.
          patterns: [{ group: ['**/api/*', '!**/api/http', '**/fixtures/*', '**/config/*'], message: OFFLINE_MESSAGE }],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name="test"] > :function > ObjectPattern > Property[key.name=/^(request|page|context|browser|playwright)$/]',
          message: 'Unit tests must not use network- or browser-backed Playwright fixtures.',
        },
      ],
    },
  },
);
