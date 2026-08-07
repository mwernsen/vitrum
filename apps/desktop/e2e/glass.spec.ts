import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let glassLibraryPath: string
/**
 * One isolated app-data root for the whole test, not per `launch()`: this spec relaunches the app to
 * prove the glass library persists, and both launches must see the same app-data directory.
 */
let appData: Record<string, string>

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  appData = isolatedAppData()
  autosavePath = join(tmpdir(), `vitrum-e2e-glass-auto-${id}.vitrum`)
  glassLibraryPath = join(tmpdir(), `vitrum-e2e-glass-lib-${id}.json`)
  app = await launch()
  // F-058: the app now opens on the launch screen; step into the editor.
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ...appData,
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_GLASS_LIBRARY_PATH: glassLibraryPath,
    },
  })
}

// Drives F-022 end to end from the glass palette dock: the starter catalog loads on
// first run, search/filter narrows it, and a newly-created glass persists to the global library
// (userData) across an app relaunch — the copy-on-write + self-contained-persistence mechanism.
test('glass catalog: starter loads, search filters, new glass persists across relaunch', async () => {
  let window = await app.firstWindow()
  // Cockpit v2 opens the dock on Draw, so open the Glass section to reach the palette.
  await window.getByRole('button', { name: 'Glass', exact: true }).click()
  const palette = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette).toBeVisible()

  // Starter catalog loaded (60 shipped glasses).
  await expect(palette.getByTestId('glass-count')).toHaveText('60 of 60')
  await expect(palette.getByText('Ruby cathedral')).toBeVisible()

  // Free-text search narrows the list (FR-3).
  await palette.getByPlaceholder('Search glass…').fill('emerald')
  await expect(palette.getByTestId('glass-count')).toHaveText('1 of 60')
  await expect(palette.getByText('Emerald cathedral')).toBeVisible()
  await palette.getByPlaceholder('Search glass…').fill('')

  // Create a new glass through the editor dialog.
  await palette.getByRole('button', { name: 'New glass' }).click()
  const dialog = window.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name').fill('My studio blue')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(palette.getByTestId('glass-count')).toHaveText('61 of 61')
  await expect(palette.getByText('My studio blue')).toBeVisible()

  // Relaunch the app against the same library file: the new glass persists (FR-2 copy-on-write,
  // global library persisted in userData).
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  app = await launch()
  // F-058: the relaunched app opens on the launch screen too, so step into the editor again.
  window = await editorWindow(app)
  await window.getByRole('button', { name: 'Glass', exact: true }).click()
  const palette2 = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette2.getByText('My studio blue')).toBeVisible()
  await expect(palette2.getByTestId('glass-count')).toHaveText('61 of 61')
})
