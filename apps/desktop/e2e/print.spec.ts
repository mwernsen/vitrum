import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

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
    env: {
      ...process.env,
      ...isolatedAppData(),
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_EXPORT_PATH: exportPath,
    },
  })
  await app.evaluate(({ dialog }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dialog.showMessageBox = (async () => ({ response: 0 })) as any
  })
  // F-058: the app now opens on the launch screen; step into the editor.
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-041 end to end: draw + number a piece, open the Export dialog, pick the 1:1 tiled
// cutting-template document type, export, and confirm a real multi-page vector PDF lands on disk
// (overview page + at least one tile). The tiling grid is previewed on the canvas while active.
test('exports a 1:1 tiled PDF via the Export dialog', async () => {
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

  await window.getByRole('button', { name: 'Make' }).click()
  await window.getByRole('button', { name: 'Renumber' }).click()

  // Open the Export dialog and pick the 1:1 tiled cutting template.
  await window.getByRole('button', { name: 'Export' }).click()
  const dialog = window.getByRole('dialog', { name: 'Export' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('What to export').selectOption('tiled')
  await expect(dialog).toContainText('tiles')
  await dialog.getByRole('button', { name: 'Export' }).click()

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
