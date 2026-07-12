import google from 'oxlint-config-presets/google.json' with {type: 'json'};
import tsStrictTypeChecked from 'oxlint-config-presets/@typescript-eslint/strict-type-checked.json' with {type: 'json'};
import {defineConfig} from 'oxlint';

export default defineConfig({
  extends: [google, tsStrictTypeChecked],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    'typescript/no-namespace': 'error',
    'typescript/consistent-type-definitions': ['error', 'interface'],
    'typescript/consistent-type-assertions': [
      'error',
      {
        assertionStyle: 'as',
        objectLiteralTypeAssertions: 'never',
      },
    ],
    'typescript/ban-ts-comment': [
      'error',
      {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        minimumDescriptionLength: 10,
      },
    ],
    'typescript/no-explicit-any': 'error',
    'oxc/no-const-enum': 'error',
    'typescript/consistent-type-imports': ['error', {prefer: 'type-imports'}],
  },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.wrangler/**',
    'scripts/**',
    'sandbox/**',
    'tests/**',
    'apps/web/public/**',
    'playwright.config.ts',
    'playwright.perf.config.ts',
    'playwright.vrt.config.ts',
    'packages/scenarios/data/**',
    'Web*',
  ],
  overrides: [
    {
      files: [
        'apps/**/pure/**/*.ts',
        'apps/**/game/state/gameSelectors.ts',
        'apps/worker/src/durable/sessionState.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/effect/**', 'effect', 'effect/*'],
                message:
                  'Pure modules must not import Effect. Keep IO in effect/ or hooks.',
              },
              {
                group: ['**/game/state/gameState*'],
                message:
                  'Pure modules must not import reducers. Use gameSelectors instead.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['apps/**/effect/**/*.ts'],
      rules: {
        'eslint/new-cap': 'off',
      },
    },
  ],
});
