import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0

/**
 * A stand-in cartoon "scan": a near-black marker rectangle split by a bar (two regions), plus a
 * mid-grey pencil construction line that must not become geometry (F-059 FR-8). Small and hard-edged
 * so the trace is instant and the counts are stable; the real photographed cartoon lives in
 * `packages/core/src/trace/fixtures/` where the pipeline's own tests can grind on it.
 */
const FIXTURE = fileURLToPath(new URL('./fixtures/cartoon-scan.png', import.meta.url))

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-autotrace-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    // VITRUM_IMPORT_IMAGE_PATH routes the image open dialog to the committed fixture (no prompt).
    env: {
      ...process.env,
      ...isolatedAppData(),
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_IMPORT_IMAGE_PATH: FIXTURE,
    },
  })
  // F-058: the app now opens on the launch screen; step into the editor.
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

/**
 * Drives F-059 end to end through the packaged `file://` build (FR-3, FR-4, FR-5, FR-7): place a
 * reference image, calibrate it, autotrace it, confirm the traced regions land in the document, then
 * undo — one step restores the prior document.
 *
 * This is also the only test that exercises the trace **worker** for real. A `{ type: 'module' }`
 * worker is silently blocked under `file://` in the packaged renderer (the F-030 lesson), so a preview
 * that never arrives here — while passing in jsdom and in `dev:ui` — is exactly the failure mode this
 * run exists to catch.
 */
test('autotraces a calibrated reference image into the document and undoes it in one step', async () => {
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
  await closePalette()

  // Place the reference image: the Draw dock section owns tracing aids (Cockpit v2).
  await window.getByRole('button', { name: 'Draw' }).click()
  await window.getByRole('button', { name: /add image/i }).click()
  await expect(window.getByText('cartoon-scan')).toBeVisible()

  // The layer is selected on import, so the inspector shows its controls — including the refusal to
  // trace an uncalibrated image (FR-3): there is no trace button until its size has been measured.
  await expect(window.getByText(/Calibrate the image first/)).toBeVisible()
  await expect(window.getByRole('button', { name: 'Trace to lead lines…' })).toHaveCount(0)

  // Calibrate: two clicks on the reference editing surface, then the real distance between them.
  await window.getByRole('button', { name: 'Calibrate scale…' }).click()
  const surface = window.getByRole('application', { name: 'Reference image editing surface' })
  await surface.click({ position: { x: 300, y: 300 } })
  await surface.click({ position: { x: 500, y: 300 } })
  await window.getByLabel('Real distance (mm)').fill('200')
  await window.getByRole('button', { name: 'Apply scale' }).click()

  // Now it traces.
  await window.getByRole('button', { name: 'Trace to lead lines…' }).click()
  const dialog = window.getByRole('dialog', { name: 'Autotrace reference image' })
  await expect(dialog).toBeVisible()

  // The live preview — computed on the worker — reports the two regions the marker linework closes.
  await expect(dialog.getByTestId('trace-piece-count')).toHaveText('2', { timeout: 15000 })
  await expect(dialog.getByLabel('Ink threshold')).toBeVisible()

  await dialog.getByRole('button', { name: 'Add lead lines' }).click()
  await expect(dialog).toBeHidden()

  // The traced network merged into the document as welded segments → the same two pieces (FR-4).
  await openPalette()
  await expect(pieceCount).toHaveText('Pieces: 2')
  await expect(segmentCount).not.toHaveText('Segments: 0')

  // One undo removes the whole trace (FR-5). The reference layer itself stays — it was placed and
  // calibrated by earlier, separate commands.
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(segmentCount).toHaveText('Segments: 0')
  await expect(pieceCount).toHaveText('Pieces: 0')
  await closePalette()
  await expect(window.getByText('cartoon-scan')).toBeVisible()
})
