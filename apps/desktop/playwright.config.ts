import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig } from '@playwright/test'

// Per-test isolation is `e2e/appdata.ts`'s `isolatedAppData()`, which every spec spreads into its
// `electron.launch` env. This is only a **backstop** for the one failure mode that is easy to
// reintroduce and invisible when it happens: a newly added spec that forgets, and so reads and writes
// the developer's real `userData/library`. A run-wide throwaway directory makes that harmless (though
// still order-dependent, which is why it is not a substitute).
process.env['VITRUM_LIBRARY_PATH'] ??= join(
  mkdtempSync(join(tmpdir(), 'vitrum-e2e-appdata-')),
  'library',
)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Electron E2E tests launch one app instance per test; keep them serial.
  workers: 1,
  reporter: process.env['CI'] ? 'github' : 'list',
})
