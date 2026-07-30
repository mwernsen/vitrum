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

  // Closed rectangular border → one piece.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))

  // Cockpit v2 opens the dock on Draw, so open the Glass section to reach the palette.
  await window.getByRole('button', { name: 'Glass', exact: true }).click()
  const palette = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette).toBeVisible()

  // Pick a glass and paint the piece.
  await palette.locator('button.glass').first().click()
  await window.mouse.click(...at(240, 210))

  // Open the Make dock and number the pieces.
  await window.getByRole('button', { name: 'Make' }).click()
  await window.getByRole('button', { name: 'Renumber' }).click()

  // Cockpit v2: the cutting list opens in the bench-outputs drawer under the stage, where the table
  // columns fit. Still a working view — the export buttons live in the Export dialog.
  await window.getByRole('button', { name: 'Cutting list & BOM' }).click()
  const drawer = window.getByRole('region', { name: 'Bench outputs' })
  await expect(drawer.getByRole('table', { name: 'Cutting list' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'PDF…' })).toHaveCount(0)

  // The materials tab carries the BOM the drawer's cutting list does not.
  await drawer.getByRole('tab', { name: 'Bill of materials' }).click()
  await expect(drawer.getByText('Panel weight')).toBeVisible()
  await drawer.getByRole('button', { name: 'Close bench outputs' }).click()

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
