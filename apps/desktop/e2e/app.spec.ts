import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  // Point autosave at a fresh, non-existent temp file so the real app-data autosave is
  // never read: otherwise a leftover snapshot raises the native crash-recovery dialog at
  // startup, which has no automatable answer and hangs the run until manually dismissed.
  const autosavePath = join(tmpdir(), `vitrum-e2e-app-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  // Force-exit rather than graceful close: on macOS the app deliberately stays alive
  // after its last window closes (see main's window-all-closed handler), which can make
  // `app.close()` hang under load. `app.exit(0)` terminates deterministically.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

test('opens a window titled Vitrum', async () => {
  const window = await app.firstWindow()
  await expect(window).toHaveTitle('Vitrum')
})

test('renders the cockpit shell regions', async () => {
  const window = await app.firstWindow()
  await expect(window.getByRole('banner')).toBeVisible()
  await expect(window.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expect(window.getByRole('main', { name: 'Design canvas' })).toBeVisible()
  await expect(window.getByRole('complementary', { name: 'Panel dock' })).toBeVisible()
  await expect(window.getByRole('region', { name: 'Status bar' })).toBeVisible()
  // The inspector is present but collapses with no selection (turn-3 IA), so assert it exists.
  await expect(window.getByRole('complementary', { name: 'Inspector' })).toBeAttached()
})

test('opens the sample panel on an empty document', async () => {
  const window = await app.firstWindow()
  // Panel name in the top bar; the readiness strip reflects real F-020 detection (no geometry yet).
  await expect(window.getByText('Sample panel')).toBeVisible()
  await expect(window.getByText('in progress')).toBeVisible()
})

test('toggles the measurement unit from the status bar', async () => {
  const window = await app.firstWindow()
  const unitButton = window.getByRole('button', { name: /Measurement unit/ })
  await expect(unitButton).toHaveText('mm')
  await unitButton.click()
  await expect(unitButton).toHaveText('in')
})

test('exposes the preload API with context isolation', async () => {
  const window = await app.firstWindow()
  const api = await window.evaluate(() => (globalThis as { vitrum?: unknown }).vitrum)
  expect(api).toMatchObject({ platform: expect.any(String) })
})

test('makes no external network requests (offline-first, F-004 FR-3)', async () => {
  const window = await app.firstWindow()
  // Fonts (Onest, Geist Mono), Lucide icons and styles are bundled; nothing
  // should be fetched from a CDN. Attach before reloading so we capture the
  // full asset load, then fail on any non-local http(s) request.
  const external: string[] = []
  window.on('request', (request) => {
    const url = request.url()
    if (/^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url)) {
      external.push(url)
    }
  })
  await window.reload()
  await window.waitForLoadState('networkidle')
  expect(external).toEqual([])
})
