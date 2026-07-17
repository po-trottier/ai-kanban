import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import playwright from 'eslint-plugin-playwright'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import security from 'eslint-plugin-security'
import testingLibrary from 'eslint-plugin-testing-library'
import vitest from '@vitest/eslint-plugin'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import local from './tools/eslint-plugin-local/index.js'

/**
 * Rules are the machine-enforced standards from docs/dev/standards.md and
 * docs/dev/testing.md. Layer/import rules live in .dependency-cruiser.cjs.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'data/**',
      'packages/db/migrations/**',
    ],
  },

  // Plain JS (config files, local tooling)
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.node } },
  },

  // TypeScript — strict, type-aware
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Config files are not part of a tsconfig program — lint without type info
  {
    files: ['**/*.config.ts', 'e2e/playwright.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Backend packages: security rules
  {
    files: ['packages/{core,db,server}/src/**/*.ts'],
    extends: [security.configs.recommended],
    rules: {
      // Covered structurally: blob keys are server-generated UUIDs, never user paths
      'security/detect-non-literal-fs-filename': 'off',
    },
  },

  // CLI entrypoints may write to the console
  {
    files: [
      'packages/server/src/cli.ts',
      'packages/db/src/seed-cli.ts',
      'packages/db/src/migrate-cli.ts',
    ],
    rules: { 'no-console': 'off' },
  },

  // All tests: hygiene
  {
    files: ['**/*.test.{ts,tsx}'],
    extends: [vitest.configs.recommended],
    rules: {
      'vitest/expect-expect': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-commented-out-tests': 'error',
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-tests': 'error',
      'vitest/max-expects': ['error', { max: 8 }],
      'vitest/valid-title': 'error',
      'vitest/prefer-hooks-on-top': 'error',
    },
  },

  // Unit tests: AAA comments are mandatory (docs/dev/testing.md)
  {
    files: ['**/*.unit.test.{ts,tsx}'],
    plugins: { local },
    rules: { 'local/require-aaa-comments': 'error' },
  },

  // Integration & e2e tests: NO mocking, ever (docs/dev/testing.md)
  {
    files: ['**/*.integration.test.ts', 'e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vitest',
              importNames: ['vi'],
              message:
                'No mocking in integration tests — use real servers, real DBs, and fixture HTTP servers.',
            },
          ],
          patterns: [
            {
              group: ['*mock*', 'sinon', 'testdouble'],
              message: 'Mock libraries are banned in integration/e2e tests.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        ...[
          'mock',
          'doMock',
          'unmock',
          'fn',
          'spyOn',
          'stubGlobal',
          'stubEnv',
          'useFakeTimers',
          'mocked',
        ].map((property) => ({
          object: 'vi',
          property,
          message: 'No mocking in integration/e2e tests (docs/dev/testing.md).',
        })),
      ],
    },
  },

  // Frontend
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    plugins: { 'react-refresh': reactRefresh },
    rules: { 'react-refresh/only-export-components': 'error' },
  },
  {
    files: ['packages/web/src/**/*.test.{ts,tsx}'],
    extends: [testingLibrary.configs['flat/react']],
  },

  // Playwright e2e
  {
    files: ['e2e/**/*.spec.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      'playwright/no-wait-for-timeout': 'error',
      'playwright/prefer-web-first-assertions': 'error',
    },
  },

  // Prettier owns formatting — disable conflicting stylistic rules. Keep last.
  prettier,
)
