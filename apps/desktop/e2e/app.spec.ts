import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'] })
})

test.afterEach(async () => {
  await app.close()
})

test('opens a window titled Vitrum', async () => {
  const window = await app.firstWindow()
  await expect(window).toHaveTitle('Vitrum')
})

test('renders the four-region app shell', async () => {
  const window = await app.firstWindow()
  await expect(window.getByRole('menubar', { name: 'Main menu' })).toBeVisible()
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
