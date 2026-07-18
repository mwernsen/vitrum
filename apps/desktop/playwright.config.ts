import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Electron E2E tests launch one app instance per test; keep them serial.
  workers: 1,
  reporter: process.env['CI'] ? 'github' : 'list',
})
