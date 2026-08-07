import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0

const FIXTURE = fileURLToPath(new URL('./fixtures/inkscape-square.svg', import.meta.url))

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-import-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    // VITRUM_IMPORT_SVG_PATH routes the import open dialog to the committed fixture (no prompt).
    env: {
      ...process.env,
      ...isolatedAppData(),
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_IMPORT_SVG_PATH: FIXTURE,
    },
  })
  // F-058: the app now opens on the launch screen; step into the editor.
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-050 end to end through the packaged file:// build (FR-1 + FR-3): import an Inkscape
// fixture (a square + diagonal → two pieces), confirm pieces are detected, then undo — one step
// restores the empty document. Piece/segment counts are read from the debug palette, the same dev
// signal the F-011/F-020 E2Es use.
test('imports an SVG into the document and undoes it in one step', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()

  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  const segmentCount = palette.getByTestId('segment-count')
  const pieceCount = palette.getByTestId('piece-count')

  async function openPalette() {
    await window.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
  }
  async function closePalette() {
    await window.keyboard.press('Control+k')
    await expect(palette).toBeHidden()
    await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }

  // Empty to start.
  await openPalette()
  await expect(segmentCount).toHaveText('Segments: 0')
  await expect(pieceCount).toHaveText('Pieces: 0')
  await closePalette()

  // Open the import dialog from the top bar, then confirm the import.
  await window.getByRole('button', { name: 'Import SVG' }).click()
  const dialog = window.getByRole('dialog', { name: 'Import SVG' })
  await expect(dialog).toBeVisible()
  // The live preview reports the two detected regions.
  await expect(dialog.getByText(/Pieces detected:/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Import' }).click()
  await expect(dialog).toBeHidden()

  // The healed network merged into the document: five welded edges → two pieces.
  await openPalette()
  await expect(pieceCount).toHaveText('Pieces: 2')
  await expect(segmentCount).not.toHaveText('Segments: 0')

  // One undo removes the whole import (FR-3): back to an empty document.
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(segmentCount).toHaveText('Segments: 0')
  await expect(pieceCount).toHaveText('Pieces: 0')
})
