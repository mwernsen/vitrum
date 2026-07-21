import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let glassLibraryPath: string
let textPath: string
let pdfPath: string
let pngPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  autosavePath = join(tmpdir(), `vitrum-e2e-export-auto-${id}.vitrum`)
  glassLibraryPath = join(tmpdir(), `vitrum-e2e-export-lib-${id}.json`)
  textPath = join(tmpdir(), `vitrum-e2e-export-${id}.txt`)
  pdfPath = join(tmpdir(), `vitrum-e2e-export-${id}.pdf`)
  pngPath = join(tmpdir(), `vitrum-e2e-export-${id}.png`)
  app = await electron.launch({
    args: ['.'],
    // The VITRUM_EXPORT_* env vars route each save past the native dialog to a temp file for E2E.
    // All PDF outputs share VITRUM_EXPORT_PATH and all text outputs share VITRUM_EXPORT_TEXT_PATH,
    // so each is read immediately after its export before the next overwrites it.
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_GLASS_LIBRARY_PATH: glassLibraryPath,
      VITRUM_EXPORT_TEXT_PATH: textPath,
      VITRUM_EXPORT_PATH: pdfPath,
      VITRUM_EXPORT_PNG_PATH: pngPath,
    },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

async function waitForFresh(path: string, minBytes: number): Promise<Buffer> {
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
    .toBeGreaterThan(minBytes)
  return readFile(path)
}

// Drives F-043's consolidated Export dialog end to end through the packaged file:// build: draw +
// paint + number a piece, then export every document type from the single dialog — design sheet
// (PDF), design files (SVG + DXF), 1:1 tiled template (PDF), cutting list & BOM (PDF + CSV) and a
// PNG snapshot — asserting a real file of each lands on disk.
test('exports every document type from the single Export dialog', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  // A closed rectangular border → one piece.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))

  // Paint a glass so the BOM has content, then number the pieces.
  const palette = window.getByRole('region', { name: 'Glass palette' })
  await palette.locator('button.glass').first().click()
  await window.mouse.click(...at(240, 210))
  await window.getByRole('button', { name: 'Manufacturing' }).click()
  await window.getByRole('button', { name: 'Renumber' }).click()

  // The sidebar export buttons are gone — everything routes through the dialog.
  await expect(window.getByRole('button', { name: /Export \(SVG/ })).toHaveCount(0)
  await expect(window.getByRole('button', { name: 'PNG snapshot' })).toHaveCount(0)

  const openExport = window.getByRole('button', { name: 'Export' })
  const dialog = window.getByRole('dialog', { name: 'Export' })
  const whatToExport = dialog.getByLabel('What to export')

  async function exportType(type: string, tune?: () => Promise<void>): Promise<void> {
    // Clear the shared output paths so each poll below waits for this export's fresh write.
    await Promise.all([
      rm(textPath, { force: true }),
      rm(pdfPath, { force: true }),
      rm(pngPath, { force: true }),
    ])
    await openExport.click()
    await expect(dialog).toBeVisible()
    await whatToExport.selectOption(type)
    if (tune) await tune()
    await dialog.getByRole('button', { name: 'Export' }).click()
    await expect(dialog).toBeHidden()
  }

  // --- Design sheet (single-sheet PDF) ---
  await exportType('design-sheet')
  expect((await waitForFresh(pdfPath, 500)).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // --- Design files: SVG ---
  await exportType('design-files', async () => {
    await dialog.getByLabel('Format').selectOption('svg')
  })
  const svg = (await waitForFresh(textPath, 0)).toString('utf8')
  expect(svg).toContain('<svg')
  expect(svg).toMatch(/width="[\d.]+mm"/)

  // --- Design files: DXF ---
  await exportType('design-files', async () => {
    await dialog.getByLabel('Format').selectOption('dxf')
  })
  const dxf = (await waitForFresh(textPath, 0)).toString('utf8')
  expect(dxf).toContain('AC1009')
  expect(dxf).toContain('CUT')

  // --- Cutting template: 1:1 tiled (PDF) ---
  await exportType('tiled')
  expect((await waitForFresh(pdfPath, 500)).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // --- Cutting list & BOM: CSV ---
  await exportType('bom', async () => {
    await dialog.getByLabel('Format').selectOption('csv')
  })
  const csv = (await waitForFresh(textPath, 0)).toString('utf8')
  expect(csv).toContain('Cutting list')

  // --- Image snapshot (PNG) ---
  await exportType('png')
  const png = await waitForFresh(pngPath, 0)
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
})
