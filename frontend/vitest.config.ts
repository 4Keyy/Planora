import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Whole editors, panels and pages render in jsdom here. Under v8 coverage, with every worker
    // busy, the heaviest of them run past Vitest's default 5 s on an ordinary laptop — not because
    // anything hangs, but because each is a second or two of real rendering slowed several times.
    testTimeout: 15_000,
    // After-hooks run in the order they were declared, so Testing Library's cleanup — registered
    // when a test file imports it, before the file's own hooks — unmounts the tree before a file's
    // afterEach restores what the tree used (stubbed globals, mocks, timers). React 19 defers
    // passive effects, and the default reverse order let a component's last effect run during
    // unmount against globals that had already been put back.
    sequence: { hooks: 'list' },
    exclude: ['e2e/**', 'playwright-report/**', 'test-results/**', 'node_modules/**', 'dist/**', '.next/**', '.next-*/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.*'],
      // The pages and the task editor count too (audit FE-26). They were left out of the report,
      // so nothing noticed when their coverage fell. Everything else keeps the 85% gate it always
      // had; the pages and the editor are held where tests have brought them — a ratchet: raise a
      // number when tests raise the coverage, never lower one. Each is the measured level less half
      // a point for run-to-run variance, rounded down. Vitest also checks the global numbers against
      // every file, so they are the measured level of the whole frontend.
      // Globs are matched against paths relative to frontend/; `*` stands for the `(app)` group,
      // because picomatch reads parentheses as a pattern group.
      thresholds: {
        lines: 88,
        functions: 81,
        branches: 78,
        statements: 85,
        '!src/{app,components/todos/edit-todo-modal}/**': { lines: 85, functions: 85, branches: 85, statements: 85 },
        'src/components/todos/edit-todo-modal/**': { lines: 78, functions: 63, branches: 67, statements: 72 },
        // The root layout and landing composition are framework entry points (next/font, the
        // landing's blocks); the build and the E2E landing specs exercise them.
        'src/app/*.{ts,tsx}': { lines: 18, functions: 16, branches: 9, statements: 16 },
        'src/app/_landing/**': { lines: 74, functions: 70, branches: 68, statements: 74 },
        'src/app/auth/**': { lines: 89, functions: 84, branches: 85, statements: 88 },
        'src/app/*/categories/**': { lines: 69, functions: 73, branches: 69, statements: 68 },
        'src/app/*/profile/**': { lines: 74, functions: 67, branches: 65, statements: 71 },
        'src/app/*/tasks/**': { lines: 72, functions: 60, branches: 50, statements: 67 },
        'src/app/*/dashboard/**': { lines: 77, functions: 64, branches: 56, statements: 73 },
        'src/app/*/branch/**': { lines: 87, functions: 83, branches: 74, statements: 81 },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
