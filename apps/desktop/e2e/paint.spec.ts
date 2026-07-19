import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let glassLibraryPath: string
let documentPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  autosavePath = join(tmpdir(), `vitrum-e2e-paint-auto-${id}.vitrum`)
  glassLibraryPath = join(tmpdir(), `vitrum-e2e-paint-lib-${id}.json`)
  documentPath = join(tmpdir(), `vitrum-e2e-paint-doc-${id}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_GLASS_LIBRARY_PATH: glassLibraryPath,
    },
  })
  // Stub the native file/confirm dialogs so save + open can run headless (they are otherwise
  // manual per the repo's E2E convention). Save-as returns a fixed temp path; open returns it back.
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dialog.showMessageBox = (async () => ({ response: 0 })) as any
  }, documentPath)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-023 end to end: draw a closed border (one piece), pick a glass from the palette dock
// (auto-imported into the project by value), paint the piece, then save and reopen the file — the
// colour survives the round-trip (FR-5), read from the readiness strip's glass indicator.
test('paint a piece, then reload the file with the colour intact', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  const glassReadiness = window.getByTestId('glass-readiness')
  const palette = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette).toBeVisible()

  // Closed rectangular border → one (unassigned) piece.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))
  await expect(glassReadiness).toContainText('1 left')

  // Pick a glass: selecting a library swatch imports a project copy and enters paint mode.
  await palette.locator('button.glass').first().click()

  // Paint the piece: click inside the border.
  await window.mouse.click(...at(240, 210))
  await expect(glassReadiness).toContainText('100%')

  // Save to a file, then reopen it: the assignment survives the serialize/deserialize round-trip.
  await window.keyboard.press('Control+s')
  await expect(glassReadiness).toContainText('100%')
  await window.keyboard.press('Control+o')
  await expect(glassReadiness).toContainText('100%')
})
