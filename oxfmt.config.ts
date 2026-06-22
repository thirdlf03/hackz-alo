import {defineConfig} from 'oxfmt';

export default defineConfig({
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  jsxSingleQuote: true,
  bracketSpacing: false,
  trailingComma: 'es5',
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.wrangler/**',
    '**/.vite/**',
    '**/packages/scenarios/data/**',
    'scripts/**',
    'sandbox/**',
  ],
});
