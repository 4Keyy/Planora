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
      exclude: [
        'src/test/**',
        'src/**/*.test.*',
        'src/app/**',
        // Complex interactive UI — pointer/canvas/animation-heavy; requires E2E coverage instead
        'src/components/todos/edit-todo-modal/**',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
