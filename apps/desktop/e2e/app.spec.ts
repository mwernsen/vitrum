import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'] })
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

test('renders the four-region app shell', async () => {
  const window = await app.firstWindow()
  await expect(window.getByRole('banner')).toBeVisible()
  await expect(window.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expect(window.getByRole('main', { name: 'Design canvas' })).toBeVisible()
  await expect(window.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
  await expect(window.getByRole('region', { name: 'Status bar' })).toBeVisible()
})

test('shows the sample panel in the inspector', async () => {
  const window = await app.firstWindow()
  await expect(window.getByRole('heading', { level: 2, name: 'Sample panel' })).toBeVisible()
  await expect(window.getByRole('listitem')).toHaveCount(3)
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
