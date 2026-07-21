import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let glassLibraryPath: string
let pdfPath: string
let csvPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  autosavePath = join(tmpdir(), `vitrum-e2e-bom-auto-${id}.vitrum`)
  glassLibraryPath = join(tmpdir(), `vitrum-e2e-bom-lib-${id}.json`)
  pdfPath = join(tmpdir(), `vitrum-e2e-bom-${id}.pdf`)
  csvPath = join(tmpdir(), `vitrum-e2e-bom-${id}.csv`)
  app = await electron.launch({
    args: ['.'],
    // The export env vars make PDF/CSV export write to temp files instead of native dialogs.
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_GLASS_LIBRARY_PATH: glassLibraryPath,
      VITRUM_EXPORT_PATH: pdfPath,
      VITRUM_EXPORT_TEXT_PATH: csvPath,
    },
  })
  await app.evaluate(({ dialog }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dialog.showMessageBox = (async () => ({ response: 0 })) as any
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

async function fileSize(path: string): Promise<number> {
  try {
    return (await readFile(path)).byteLength
  } catch {
    return 0
  }
}

// Drives F-042 end to end: draw a border (one piece), paint a glass, number it, confirm the live
// cutting list in the Manufacturing dock, then export the PDF and CSV via the single Export dialog.
test('exports the cutting list & BOM as PDF and CSV via the Export dialog', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  const palette = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette).toBeVisible()

  // Closed rectangular border → one piece.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))

  // Pick a glass and paint the piece.
  await palette.locator('button.glass').first().click()
  await window.mouse.click(...at(240, 210))

  // Open the Manufacturing dock and number the pieces.
  await window.getByRole('button', { name: 'Manufacturing' }).click()
  await window.getByRole('button', { name: 'Renumber' }).click()

  // The cutting list is live in the panel (a working view — no export buttons here any more).
  await expect(window.getByText('Cutting list')).toBeVisible()
  await expect(window.getByRole('button', { name: 'PDF…' })).toHaveCount(0)

  // Export routes through the single Export dialog opened from the top bar.
  const openExport = window.getByRole('button', { name: 'Export' })
  const dialog = window.getByRole('dialog', { name: 'Export' })

  // Cutting list & BOM → PDF.
  await openExport.click()
  await dialog.getByLabel('What to export').selectOption('bom')
  await dialog.getByLabel('Format').selectOption('pdf')
  await dialog.getByRole('button', { name: 'Export' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => fileSize(pdfPath), { timeout: 10_000 }).toBeGreaterThan(500)
  expect((await readFile(pdfPath)).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // Cutting list & BOM → CSV.
  await openExport.click()
  await dialog.getByLabel('What to export').selectOption('bom')
  await dialog.getByLabel('Format').selectOption('csv')
  await dialog.getByRole('button', { name: 'Export' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => fileSize(csvPath), { timeout: 10_000 }).toBeGreaterThan(0)
  const csv = (await readFile(csvPath)).toString('utf8')
  expect(csv).toContain('Cutting list')
  expect(csv).toContain('Width (mm)')
  expect(csv).toContain('Panel weight')
})
