import eslint from '@eslint/js';
import functional from 'eslint-plugin-functional';
import {defineConfig} from 'eslint/config';
import tseslint from 'typescript-eslint';

const pureFiles = [
  'apps/**/pure/**/*.ts',
  'apps/**/game/state/gameSelectors.ts',
  'apps/worker/src/durable/sessionState.ts',
];

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      'tests/**',
      'scripts/**',
      'sandbox/**',
    ],
  },
  {
    files: pureFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    plugins: functional.configs.noMutations.plugins,
    rules: {
      ...functional.configs.noMutations.rules,
      'functional/prefer-immutable-types': 'off',
      'functional/readonly-type': 'off',
      'functional/type-declaration-immutability': 'off',
      'functional/no-throw-statements': 'off',
      'functional/no-let': 'off',
      'functional/immutable-data': 'off',
      'functional/no-loop-statements': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
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
  }
);
