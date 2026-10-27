import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

const OFFLINE_MESSAGE = 'Unit-tested code must not depend on HTTP clients, fixtures or environment config.';

// A page-level route handler runs before the UI write guard's context route. route.continue()
// marks the request handled and sends it to the network, so the guard never sees it; route.fetch()
// sends it through Playwright's Node-side request client, which browser routing never sees.
// Reported by the object's type (Playwright's Route), so renamed variables are covered and
// unrelated .continue() / .fetch() calls are not. Needs the type information enabled below.
const noRouteGuardBypass = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      bypass:
        'route.{{name}}() bypasses the UI write guard (the request is sent without the guard seeing it): use route.fallback() or route.fulfill().',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error('local/no-route-guard-bypass needs type information (parserOptions.projectService)');
    }
    const checker = services.program.getTypeChecker();
    const isPlaywrightRoute = (node) => {
      const symbol = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node)).getSymbol();
      return (
        symbol?.getName() === 'Route' &&
        (symbol.getDeclarations() ?? []).some((d) =>
          /[\\/]playwright-core[\\/]types[\\/]/.test(d.getSourceFile().fileName),
        )
      );
    };
    return {
      MemberExpression(node) {
        const name = node.computed
          ? node.property.type === 'Literal'
            ? node.property.value
            : undefined
          : node.property.name;
        if ((name === 'continue' || name === 'fetch') && isPlaywrightRoute(node.object)) {
          context.report({ node, messageId: 'bypass', data: { name } });
        }
      },
    };
  },
};

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
  // UI specs are read-only only through the shared UI fixture (src/ui/ui-test.ts), whose write guard
  // routes the browser's requests. Its `test` must be used, and nothing may send requests the guard
  // does not see (a request context) or reach the API fixtures and environment config.
  {
    files: ['tests/ui/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              importNames: ['test', 'request', 'chromium', 'firefox', 'webkit'],
              allowTypeImports: true,
              message:
                'Import test from src/ui/ui-test (it installs the UI write guard); request contexts and self-launched browsers bypass the guard.',
            },
          ],
          patterns: [
            {
              group: ['**/fixtures/*', '**/config/*'],
              message: 'UI specs must not use the API fixtures or environment config.',
            },
            {
              // Types (e.g. Room) and src/api/http.ts (expectStatus) are fine; API clients send requests
              // the UI write guard does not see.
              group: ['**/api/*', '!**/api/http'],
              allowTypeImports: true,
              message: 'UI specs must not call the API clients: their requests bypass the UI write guard.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: ':function > ObjectPattern > Property[key.name=/^(request|browser|playwright)$/]',
          message:
            'UI specs must not use the request, browser or playwright fixtures: their requests and new contexts bypass the UI write guard.',
        },
        {
          selector:
            "MemberExpression[property.name='request']:matches([object.name=/^(page|context)$/], [object.callee.property.name='context'])",
          message: 'page.request and context.request send requests the UI write guard does not see.',
        },
      ],
    },
  },
  // UI code (specs, UI helpers, page objects) must not let a route handler send a request past the
  // UI write guard.
  {
    files: ['tests/ui/**/*.ts', 'src/ui/**/*.ts', 'src/pages/**/*.ts'],
    plugins: { local: { rules: { 'no-route-guard-bypass': noRouteGuardBypass } } },
    rules: { 'local/no-route-guard-bypass': 'error' },
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
          // Any function, so hooks (test.beforeEach etc.) are covered too, not only test bodies.
          selector: ':function > ObjectPattern > Property[key.name=/^(request|page|context|browser|playwright)$/]',
          message: 'Unit tests must not use network- or browser-backed Playwright fixtures.',
        },
      ],
    },
  },
);
