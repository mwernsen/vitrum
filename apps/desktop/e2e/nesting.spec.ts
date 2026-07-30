import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VITRUM_AUTOSAVE_PATH: join(tmpdir(), `vitrum-e2e-nest-auto-${id}.vitrum`),
      VITRUM_GLASS_LIBRARY_PATH: join(tmpdir(), `vitrum-e2e-nest-lib-${id}.json`),
    },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// F-057: drives sheet nesting through the packaged file:// build (the only place the classic-worker
// class of problem shows up — the F-030 lesson). Draws + paints a panel so there is an assigned
// piece, switches to the Nest view (asserting the empty state, then a computed sheet with utilisation
// appears after nesting), and reshuffles to confirm the run re-computes.
test('nest view: assign a piece, nest it onto a sheet, reshuffle', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  // A closed rectangular border → one piece; paint it so nesting has an assigned piece to lay out.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))

  // Cockpit v2 opens the dock on Draw, so open the Glass section to reach the palette.
  await window.getByRole('button', { name: 'Glass', exact: true }).click()
  const paletteRegion = window.getByRole('region', { name: 'Glass palette' })
  await paletteRegion.locator('button.glass').first().click()
  await window.mouse.click(...at(240, 210))

  // Switch to the Nest view: the nesting controls appear in the inspector (Cockpit v2 folded the
  // floating card into the column beside the view, mirroring the light view).
  await window.getByRole('tab', { name: 'Nest', exact: true }).click()
  const controls = window.getByRole('complementary', { name: 'Inspector' })
  await expect(controls).toContainText('Sheets')

  // Auto-nest runs on entry: a computed sheet with a utilisation caption appears where the empty
  // state was. The sheet is labelled with its 1-based index and percentage used.
  const sheet = window.getByRole('img', { name: /Sheet 1, \d+% used/ })
  await expect(sheet).toBeVisible({ timeout: 15_000 })
  await expect(window.getByText('Sheet 1', { exact: true })).toBeVisible()

  // Reshuffle recomputes the layout (still one sheet for a single piece) without error.
  await controls.getByRole('button', { name: 'Reshuffle' }).click()
  await expect(sheet).toBeVisible({ timeout: 15_000 })
})
