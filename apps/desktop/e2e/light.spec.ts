import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0
let pngPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  pngPath = join(tmpdir(), `vitrum-e2e-light-${id}.png`)
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: join(tmpdir(), `vitrum-e2e-light-auto-${id}.vitrum`),
      VITRUM_GLASS_LIBRARY_PATH: join(tmpdir(), `vitrum-e2e-light-lib-${id}.json`),
      VITRUM_EXPORT_PNG_PATH: pngPath,
    },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// F-054: drives the sunlight simulation through the packaged file:// build (the only place the
// WebGL / FBO god-ray class of problem shows up — the F-030 lesson). Draws + paints a panel,
// switches to the Light view (asserting the volumetric WebGL layer goes live and the floating light
// controls card appears), scrubs the moment via a season preset (365-days mode), and captures a PNG
// photo of the lit stage to disk (F-054 FR-6), asserting a real image lands.
test('light view: switch live, scrub a season, capture a photo', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  // A closed rectangular border → one piece; paint it so the lit stage has coloured glass.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))
  const paletteRegion = window.getByRole('region', { name: 'Glass palette' })
  await paletteRegion.locator('button.glass').first().click()
  await window.mouse.click(...at(240, 210))

  // Switch to the Light view: the volumetric WebGL layer goes live and the floating light controls
  // card appears (F-054 controls float over the canvas in the light view, not in the dock).
  await window.getByRole('tab', { name: 'Light', exact: true }).click()
  const lightLayer = window.locator('canvas.light-render')
  await expect(lightLayer).toBeVisible()
  await expect(window.getByRole('complementary', { name: 'Light controls' })).toBeVisible()
  await expect(window.getByRole('tab', { name: '365 days' })).toBeVisible()

  // Scrub the moment via a season preset (365-days / astronomical mode).
  await window.getByRole('button', { name: 'Winter solstice' }).click()

  // Capture a photo of the lit stage (FR-6) — a real PNG must land on disk.
  await rm(pngPath, { force: true })
  await window.getByRole('button', { name: 'Capture photo' }).click()

  await expect
    .poll(
      async () => {
        try {
          return (await readFile(pngPath)).byteLength
        } catch {
          return 0
        }
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0)
  const png = await readFile(pngPath)
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
})
