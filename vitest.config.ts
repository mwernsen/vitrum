import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // apps/desktop is Playwright-only (`pnpm test:e2e`); apps/website carries the
    // download-resolution unit tests.
    projects: ['packages/*', 'apps/website'],
  },
})
