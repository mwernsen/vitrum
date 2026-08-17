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

// F-063 end to end from the launch screen's glass library home: the starter catalog renders in the
// full-page grid, a glass created there persists across an app relaunch, and — the point of one shared
// controller (FR-4) — a glass added on this surface is visible in the editor's palette. This extends
// F-022's persistence proof across the new cross-document surface.
test('glass library home: create on the launch screen, persist, and see it in the editor palette', async () => {
  // The beforeEach stepped into the editor; go back to the launch screen to reach the portal rail.
  let window = await app.firstWindow()
  await window.getByRole('button', { name: 'Back to panel library' }).click()
  const rail = window.getByRole('navigation', { name: 'Library sections' })
  await expect(rail).toBeVisible()

  // The "Glass library" destination is live now (not a disabled placeholder), and carries the count.
  const glassNav = rail.getByRole('button', { name: /Glass library/ })
  await expect(glassNav).toBeEnabled()
  await glassNav.click()

  const home = window.getByRole('region', { name: 'Glass library' })
  await expect(home).toBeVisible()
  // The starter catalog renders full-page (60 shipped glasses), searchable via the header field (FR-6).
  await expect(home.getByTestId('glass-home-count')).toHaveText('60 of 60')
  await window.getByLabel('Search glass').fill('emerald')
  await expect(home.getByTestId('glass-home-count')).toHaveText('1 of 60')
  await window.getByLabel('Search glass').fill('')

  // Create a glass through the shared editor dialog on this surface.
  await home.getByRole('button', { name: 'New glass' }).click()
  const dialog = window.getByRole('dialog', { name: 'New glass' })
  await dialog.getByLabel('Name').fill('Launch-screen amber')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(home.getByTestId('glass-home-count')).toHaveText('61 of 61')
  await expect(home.getByRole('button', { name: 'Launch-screen amber' })).toBeVisible()

  // Relaunch against the same library file: the glass persists (userData-backed, FR-4/F-022).
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  app = await launch()
  window = await app.firstWindow()
  await window.getByRole('button', { name: /Glass library/ }).click()
  const home2 = window.getByRole('region', { name: 'Glass library' })
  await expect(home2.getByRole('button', { name: 'Launch-screen amber' })).toBeVisible()
  await expect(home2.getByTestId('glass-home-count')).toHaveText('61 of 61')

  // One controller, no cache to invalidate: the editor palette lists the same glass (FR-4). Return to
  // the panels view first so `editorWindow` can step in through the new-panel dialog.
  await window.getByRole('button', { name: /Panels/ }).click()
  window = await editorWindow(app)
  await window.getByRole('button', { name: 'Glass', exact: true }).click()
  const palette = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette.getByText('Launch-screen amber')).toBeVisible()
})

// Reported on the glass name field, but it was every text input in the app (run 2026-08-16-b):
// Chromium routes Cmd/Ctrl+X, C, V through the *application menu*, so an Edit menu built by hand
// without the clipboard roles left the whole app unable to paste. `pnpm dev:ui` cannot show it —
// browser Chromium owns those shortcuts itself and needs no menu.
//
// This asserts the **menu registration**, not a keystroke, and that is deliberate: a
// `keyboard.press('ControlOrMeta+V')` test was written first and passed with the fix reverted.
// Playwright drives keys over CDP, which reaches Chromium's editing commands directly and never
// consults the menu — so the keystroke version proves nothing about the bug. The menu's contents are
// the thing that was wrong, so they are the thing to assert. Pasting itself stays a manual check.
test('registers the clipboard roles on the Edit menu (paste in any text field)', async () => {
  const editRoles = await app.evaluate(({ Menu }) => {
    const edit = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Edit')
    return edit?.submenu?.items.map((item) => item.role ?? null) ?? []
  })

  // Electron lower-cases a role when it is read back off a built menu, so `selectAll` returns as
  // `selectall`.
  expect(editRoles).toContain('cut')
  expect(editRoles).toContain('copy')
  expect(editRoles).toContain('paste')
  expect(editRoles).toContain('selectall')
})
