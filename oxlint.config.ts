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
    'playwright.config.ts',
    'packages/scenarios/data/**',
  ],
});
