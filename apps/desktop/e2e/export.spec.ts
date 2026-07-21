import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let textPath: string
let pdfPath: string
let pngPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  autosavePath = join(tmpdir(), `vitrum-e2e-export-auto-${id}.vitrum`)
  textPath = join(tmpdir(), `vitrum-e2e-export-${id}.txt`)
  pdfPath = join(tmpdir(), `vitrum-e2e-export-${id}.pdf`)
  pngPath = join(tmpdir(), `vitrum-e2e-export-${id}.png`)
  app = await electron.launch({
    args: ['.'],
    // The VITRUM_EXPORT_* env vars route each save past the native dialog to a temp file for E2E.
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_EXPORT_TEXT_PATH: textPath,
      VITRUM_EXPORT_PATH: pdfPath,
      VITRUM_EXPORT_PNG_PATH: pngPath,
    },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

async function waitForFile(path: string): Promise<Buffer> {
  await expect
    .poll(
      async () => {
        try {
          return (await readFile(path)).byteLength
        } catch {
          return 0
        }
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0)
  return readFile(path)
}

// Drives F-043 end to end through the packaged file:// build: draw + number a piece, then export
// SVG, DXF, PDF and a PNG snapshot, asserting a real file of each format lands on disk.
test('exports SVG, DXF, PDF and a PNG snapshot from the export dialog', async () => {
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

  const openExport = window.getByRole('button', { name: /Export \(SVG, PDF, DXF\)/ })
  const dialog = window.getByRole('dialog', { name: 'Export' })

  // --- SVG (default: linework) ---
  await openExport.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Export' }).click()
  await expect(dialog).toBeHidden()
  const svg = (await waitForFile(textPath)).toString('utf8')
  expect(svg).toContain('<svg')
  expect(svg).toMatch(/width="[\d.]+mm"/)

  // --- DXF ---
  await openExport.click()
  await dialog.getByLabel('Format').selectOption('dxf')
  await dialog.getByRole('button', { name: 'Export' }).click()
  await expect(dialog).toBeHidden()
  const dxf = (await waitForFile(textPath)).toString('utf8')
  expect(dxf).toContain('AC1009')
  expect(dxf).toContain('CUT')

  // --- PDF ---
  await openExport.click()
  await dialog.getByLabel('Format').selectOption('pdf')
  await dialog.getByRole('button', { name: 'Export' }).click()
  await expect(dialog).toBeHidden()
  const pdf = await waitForFile(pdfPath)
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // --- PNG snapshot ---
  await window.getByRole('button', { name: 'PNG snapshot' }).click()
  const png = await waitForFile(pngPath)
  // PNG magic number.
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
})
