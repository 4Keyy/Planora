import nextPlugin from '@next/eslint-plugin-next'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

const typescript = {
  parser: tsParser,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
}

/** jsx-a11y's recommended set as warnings (`npm run lint` allows none); the rules it switches off stay off. */
const accessibility = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([rule, setting]) => {
    const [level, ...options] = Array.isArray(setting) ? setting : [setting]
    return [rule, level === 'off' || level === 0 ? 'off' : ['warn', ...options]]
  }),
)

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: typescript,
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11y,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Next.js core rules (without react-compiler enforcement)
      '@next/next/no-html-link-for-pages': 'error',
      '@next/next/no-img-element': 'warn',
      '@next/next/no-sync-scripts': 'error',
      '@next/next/no-duplicate-head': 'error',
      '@next/next/google-font-display': 'warn',
      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TypeScript
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Accessibility
      ...accessibility,
    },
  },
  {
    // The light profile for tests: hooks and unused code still count; a test double may be
    // typed `any`, and markup written to exercise a component is not product markup.
    files: ['src/test/**/*.ts', 'src/test/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      ...Object.fromEntries(Object.keys(accessibility).map((rule) => [rule, 'off'])),
    },
  },
  {
    ignores: [
      '.next/**',
      // Side builds made with NEXT_DIST_DIR (docs/development.md) — generated chunks, never source.
      '.next-*/**',
      'node_modules/**',
      'coverage/**',
      'vitest.config.ts',
    ],
  },
]

export default config
