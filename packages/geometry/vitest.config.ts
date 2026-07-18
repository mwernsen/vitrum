import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'geometry',
    environment: 'node',
    coverage: {
      // The kernel is the highest test-bar package in the repo (F-010 acceptance):
      // ≥95% line coverage, enforced so a regression fails CI rather than drifting.
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/rand.ts'],
      thresholds: { lines: 95, functions: 95, statements: 95 },
      reporter: ['text-summary'],
    },
  },
})
