import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  // Isolate autosave and version history per run (repo E2E convention).
  const autosavePath = join(tmpdir(), `vitrum-e2e-versions-auto-${id}.vitrum`)
  const versionsPath = mkdtempSync(join(tmpdir(), `vitrum-e2e-versions-${id}-`))
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ...isolatedAppData(),
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_VERSIONS_PATH: versionsPath,
    },
  })
  // F-058: the app now opens on the launch screen; step into the editor.
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-055 end to end: save a named version at a known state, edit the document, then restore
// the version and confirm the document returns to exactly the saved state — and that the restore is
// a single undoable step.
test('saves a named version and restores the document to it', async () => {
  const window = await app.firstWindow()
  await expect(window.getByRole('banner')).toBeVisible()

  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  const count = palette.getByTestId('segment-count')

  // One segment, then save a named version capturing that state.
  await window.keyboard.press('Control+k')
  await palette.getByRole('button', { name: 'Add segment' }).click()
  await expect(count).toHaveText('Segments: 1')
  await window.keyboard.press('Escape')

  await window.getByRole('button', { name: 'History' }).click()
  await window.getByRole('button', { name: 'Save version…' }).click()
  const saveDialog = window.getByRole('dialog', { name: 'Save version' })
  await saveDialog.getByLabel('Name').fill('client draft 1')
  await saveDialog.getByRole('button', { name: 'Save version', exact: true }).click()

  // The version is listed by name.
  await expect(window.getByText('client draft 1')).toBeVisible()

  // Diverge: add another segment (now two).
  await window.keyboard.press('Control+k')
  await palette.getByRole('button', { name: 'Add segment' }).click()
  await expect(count).toHaveText('Segments: 2')
  await window.keyboard.press('Escape')

  // Restore the saved version — back to one segment.
  await window.getByRole('button', { name: 'Restore this version' }).click()
  await window.keyboard.press('Control+k')
  await expect(count).toHaveText('Segments: 1')

  // The restore is a single undo step back to the diverged (two-segment) state.
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText('Segments: 2')
})
