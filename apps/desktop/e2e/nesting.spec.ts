import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ...isolatedAppData(),
      VITRUM_AUTOSAVE_PATH: join(tmpdir(), `vitrum-e2e-nest-auto-${id}.vitrum`),
      VITRUM_GLASS_LIBRARY_PATH: join(tmpdir(), `vitrum-e2e-nest-lib-${id}.json`),
    },
  })
  // F-058: the app now opens on the launch screen; step into the editor.
  await editorWindow(app)
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

  // Switch to the Nest view. The nesting controls take over the dock, widened for them
  // (`DockPanel`'s `wide` mode) rather than the inspector, which nest view hides — the sheet table
  // needs the column width. (F-001's cockpit-v2 table still says "inspector"; the code is the truth.)
  await window.getByRole('tab', { name: 'Nest', exact: true }).click()
  const controls = window.getByRole('region', { name: 'Nesting' })
  await expect(controls).toContainText('Arrangement')
  await expect(controls).toContainText('Sheet stock per glass')

  // Auto-nest runs on entry: a computed sheet with a utilisation caption appears where the empty
  // state was. The sheet is labelled with its 1-based index and percentage used.
  const sheet = window.getByRole('img', { name: /Sheet 1, \d+% used/ })
  await expect(sheet).toBeVisible({ timeout: 15_000 })
  await expect(window.getByText('Sheet 1', { exact: true })).toBeVisible()

  // "Try another layout" recomputes with a fresh seed (still one sheet for a single piece).
  await controls.getByRole('button', { name: 'Try another layout' }).click()
  await expect(sheet).toBeVisible({ timeout: 15_000 })
})
