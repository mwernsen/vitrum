import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let exportPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  autosavePath = join(tmpdir(), `vitrum-e2e-print-auto-${id}.vitrum`)
  exportPath = join(tmpdir(), `vitrum-e2e-print-${id}.pdf`)
  app = await electron.launch({
    args: ['.'],
    // VITRUM_EXPORT_PATH makes the PDF export write to a temp file instead of a native dialog.
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath, VITRUM_EXPORT_PATH: exportPath },
  })
  await app.evaluate(({ dialog }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dialog.showMessageBox = (async () => ({ response: 0 })) as any
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-041 end to end: draw + number a piece, open the print dialog from the Manufacturing dock,
// export, and confirm a real multi-page vector PDF lands on disk (overview page + at least one tile).
test('exports a 1:1 tiled PDF from the print dialog', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  // A closed rectangular border → one piece, then number it.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))

  await window.getByRole('button', { name: 'Manufacturing' }).click()
  await window.getByRole('button', { name: 'Renumber' }).click()

  // Open the print dialog and export.
  await window.getByRole('button', { name: /Print cartoon 1:1/ }).click()
  const dialog = window.getByRole('dialog', { name: 'Print cartoon 1:1' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('tiles')
  await dialog.getByRole('button', { name: 'Export PDF' }).click()

  // The dialog closes on a successful export, and a valid PDF is written to the export path.
  await expect(dialog).toBeHidden()
  await expect
    .poll(
      async () => {
        try {
          return (await readFile(exportPath)).byteLength
        } catch {
          return 0
        }
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(1000)

  const bytes = await readFile(exportPath)
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // Parse it back: overview page + at least one tile, at A4 portrait dimensions.
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2)
  const first = pdf.getPage(0)
  expect(first.getWidth()).toBeCloseTo((210 * 72) / 25.4, 0)
  expect(first.getHeight()).toBeCloseTo((297 * 72) / 25.4, 0)
})
