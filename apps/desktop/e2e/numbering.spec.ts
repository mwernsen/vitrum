import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let documentPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  autosavePath = join(tmpdir(), `vitrum-e2e-numbering-auto-${id}.vitrum`)
  documentPath = join(tmpdir(), `vitrum-e2e-numbering-doc-${id}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
  // Stub native dialogs so save + open run headless (repo E2E convention).
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

// Drives F-040 end to end: draw a piece (unnumbered), renumber it (outputs readiness turns
// complete), switch to the cartoon view (a live view mode with the tool palette hidden and a
// legend shown), then save + reopen — the numbers survive the round-trip.
test('numbers a piece, shows the cartoon view, and persists across reload', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  const outputs = window.getByTestId('outputs-readiness')

  // Closed rectangular border → one (unnumbered) piece.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))
  await expect(outputs).toContainText('0/1 numbered')

  // Open the Manufacturing dock and renumber.
  await window.getByRole('button', { name: 'Manufacturing' }).click()
  await window.getByRole('button', { name: 'Renumber' }).click()
  await expect(outputs).toContainText('numbered')
  await expect(outputs).not.toContainText('0/1')

  // Switch to the cartoon view: the drawing tool palette is gone and the legend appears.
  await window.getByRole('tab', { name: 'Cartoon' }).click()
  await expect(window.getByRole('complementary', { name: 'Cartoon legend' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Panel border' })).toBeHidden()

  // Back to design, save and reopen: the numbering survives the serialize/deserialize round-trip.
  await window.getByRole('tab', { name: 'Design' }).click()
  await window.keyboard.press('Control+s')
  await window.keyboard.press('Control+o')
  await expect(outputs).toContainText('numbered')
  await expect(outputs).not.toContainText('0/1')
})
