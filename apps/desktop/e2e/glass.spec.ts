import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let glassLibraryPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  autosavePath = join(tmpdir(), `vitrum-e2e-glass-auto-${id}.vitrum`)
  glassLibraryPath = join(tmpdir(), `vitrum-e2e-glass-lib-${id}.json`)
  app = await launch()
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_GLASS_LIBRARY_PATH: glassLibraryPath,
    },
  })
}

// Drives F-022 end to end from the glass palette in the inspector: the starter catalog loads on
// first run, search/filter narrows it, and a newly-created glass persists to the global library
// (userData) across an app relaunch — the copy-on-write + self-contained-persistence mechanism.
test('glass catalog: starter loads, search filters, new glass persists across relaunch', async () => {
  let window = await app.firstWindow()
  const inspector = window.getByRole('complementary', { name: 'Inspector' })
  const palette = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette).toBeVisible()

  // Starter catalog loaded (60 shipped glasses).
  await expect(inspector.getByTestId('glass-count')).toHaveText('60 of 60')
  await expect(palette.getByText('Ruby cathedral')).toBeVisible()

  // Free-text search narrows the list (FR-3).
  await palette.getByPlaceholder('Search glass…').fill('emerald')
  await expect(inspector.getByTestId('glass-count')).toHaveText('1 of 60')
  await expect(palette.getByText('Emerald cathedral')).toBeVisible()
  await palette.getByPlaceholder('Search glass…').fill('')

  // Create a new glass through the editor dialog.
  await palette.getByRole('button', { name: 'New glass' }).click()
  const dialog = window.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name').fill('My studio blue')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(inspector.getByTestId('glass-count')).toHaveText('61 of 61')
  await expect(palette.getByText('My studio blue')).toBeVisible()

  // Relaunch the app against the same library file: the new glass persists (FR-2 copy-on-write,
  // global library persisted in userData).
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  app = await launch()
  window = await app.firstWindow()
  const palette2 = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette2.getByText('My studio blue')).toBeVisible()
  await expect(
    window.getByRole('complementary', { name: 'Inspector' }).getByTestId('glass-count'),
  ).toHaveText('61 of 61')
})
