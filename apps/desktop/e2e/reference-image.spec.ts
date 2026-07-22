import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath = ''

const FIXTURE = fileURLToPath(new URL('./fixtures/reference-window.png', import.meta.url))

test.beforeEach(async () => {
  autosavePath = join(tmpdir(), `vitrum-e2e-reference-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    // VITRUM_IMPORT_IMAGE_PATH routes the image open dialog to the committed fixture (no prompt).
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_IMPORT_IMAGE_PATH: FIXTURE,
    },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

/** Poll for the autosave file to appear and return its bytes. */
async function waitForAutosave(): Promise<Buffer> {
  for (let i = 0; i < 40; i++) {
    try {
      return await readFile(autosavePath)
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  throw new Error('autosave snapshot was never written')
}

// Drives F-051 end to end through the packaged file:// build (FR-3 + FR-4): add a reference image
// underlay, confirm the layer row and the WebGL underlay canvas appear, then confirm the crash
// snapshot is a zip container with the embedded image (proving the `.vitrum` zip round-trips
// embedded bytes). WebGL runs for real here — the underlay canvas is present in the DOM.
test('adds a reference image underlay and embeds it in the zip container', async () => {
  const window = await app.firstWindow()
  await expect(window.getByRole('main', { name: 'Design canvas' })).toBeVisible()

  // Open the Layers dock section from the activity rail (the sole panel switcher).
  await window.getByRole('button', { name: 'Layers' }).click()

  // Add the reference image; the layer row appears once decode/downscale/embed completes.
  await window.getByRole('button', { name: /add image/i }).click()
  await expect(window.getByText('reference-window')).toBeVisible()

  // The WebGL underlay canvas is mounted beneath the content canvas.
  await expect(window.locator('canvas.reference-underlay')).toHaveCount(1)

  // The document is dirty, so a crash snapshot is written. It must be a zip (PK magic) that carries
  // both the JSON envelope and the embedded image asset (FR-3).
  const bytes = await waitForAutosave()
  expect(bytes[0]).toBe(0x50) // 'P'
  expect(bytes[1]).toBe(0x4b) // 'K'
  const text = bytes.toString('latin1')
  expect(text).toContain('document.json')
  expect(text).toContain('assets/')
})
