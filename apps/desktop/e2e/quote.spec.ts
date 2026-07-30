import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let autosavePath: string
let glassLibraryPath: string
let priceBookPath: string
let pdfPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  autosavePath = join(tmpdir(), `vitrum-e2e-quote-auto-${id}.vitrum`)
  glassLibraryPath = join(tmpdir(), `vitrum-e2e-quote-lib-${id}.json`)
  priceBookPath = join(tmpdir(), `vitrum-e2e-quote-pb-${id}.json`)
  pdfPath = join(tmpdir(), `vitrum-e2e-quote-${id}.pdf`)
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: autosavePath,
      VITRUM_GLASS_LIBRARY_PATH: glassLibraryPath,
      VITRUM_PRICE_BOOK_PATH: priceBookPath,
      VITRUM_EXPORT_PATH: pdfPath,
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

// Drives F-056 end to end: draw a border (one piece), paint a glass, open the Cost dock, confirm the
// live quote total, then export the client quote PDF via the single Export dialog (real `file://`
// build — proves buildQuoteDocument + pdf-lib work bundled, the F-030 file:// caveat class of bug).
test('builds a cost estimate and exports the client quote PDF', async () => {
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

  // Pick a glass and paint the piece so it is priced.
  await palette.locator('button.glass').first().click()
  await window.mouse.click(...at(240, 210))

  // Open the Cost dock; the live total is shown.
  await window.getByRole('button', { name: 'Cost' }).click()
  const dock = window.getByRole('complementary', { name: 'Panel dock' })
  await expect(dock.getByText('Total', { exact: true })).toBeVisible()

  // Cockpit v2: the full breakdown opens as a wide table in the bench-outputs drawer.
  await dock.getByRole('button', { name: /Full breakdown/ }).click()
  const drawer = window.getByRole('region', { name: 'Bench outputs' })
  await expect(drawer.getByRole('table', { name: 'Quote line items' })).toBeVisible()
  await drawer.getByRole('button', { name: 'Close bench outputs' }).click()

  // Export the client quote PDF via the single Export dialog.
  const dialog = window.getByRole('dialog', { name: 'Export' })
  await window.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('What to export').selectOption('quote')
  // Drop the rendered panel image so the export doesn't depend on a canvas snapshot (deterministic).
  await dialog.getByText('Rendered panel image').click()
  await dialog.getByRole('button', { name: 'Export' }).click()
  await expect(dialog).toBeHidden()

  await expect.poll(() => fileSize(pdfPath), { timeout: 10_000 }).toBeGreaterThan(500)
  expect((await readFile(pdfPath)).subarray(0, 5).toString('latin1')).toBe('%PDF-')
})
