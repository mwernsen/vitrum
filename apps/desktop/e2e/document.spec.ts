import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  // Point autosave at a fresh, non-existent temp file so no crash-recovery prompt pops
  // at startup and runs stay isolated from each other and from the real app-data dir.
  const autosavePath = join(tmpdir(), `vitrum-e2e-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  // Force-exit rather than close: a dirty document would otherwise raise the native
  // unsaved-changes guard, which has no automatable answer and would hang teardown.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// The debug command palette drives the F-002 document model end to end: create segments,
// then undo/redo through the store. Native file dialogs are covered by manual verification.
test('creates segments and undoes/redoes them via the debug palette', async () => {
  const window = await app.firstWindow()
  await expect(window.getByRole('banner')).toBeVisible()

  // Ctrl+K opens the palette (the renderer accepts Ctrl or Cmd on every platform).
  await window.keyboard.press('Control+k')

  // Scope to the palette: the top bar also has Undo/Redo controls with the same names.
  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  const count = palette.getByTestId('segment-count')
  await expect(count).toHaveText('Segments: 0')

  await palette.getByRole('button', { name: 'Add segment' }).click()
  await expect(count).toHaveText('Segments: 1')

  await palette.getByRole('button', { name: 'Add segment' }).click()
  await expect(count).toHaveText('Segments: 2')

  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText('Segments: 1')

  await palette.getByRole('button', { name: 'Redo' }).click()
  await expect(count).toHaveText('Segments: 2')
})

test('marks the document unsaved once it is edited', async () => {
  const window = await app.firstWindow()
  await expect(window.getByText('Saved')).toBeVisible()

  await window.keyboard.press('Control+k')
  await window.getByRole('button', { name: 'Add segment' }).click()

  await expect(window.getByText('Unsaved')).toBeVisible()
})
