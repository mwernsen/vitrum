import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-technique-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-021 end to end: draw a closed panel (one piece), then exercise the technique model
// from the Layers dock — switch lead⇄foil (line weights change and the foil parameters appear) and
// toggle the cut-contour overlay. The overlay pixels themselves are a manual/gallery check; here
// we assert the DOM state that governs them.
test('switches technique and toggles the cut-contour overlay', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))

  // A closed rectangular border → one piece to cut.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(120, 120)
  await click(360, 300)

  // Technique and overlay toggles live in the Layers dock (turn-3 IA); open it from the rail.
  await window.getByRole('button', { name: 'Layers' }).click()
  const dock = window.getByRole('complementary', { name: 'Panel dock' })
  // The project-level technique panel is present, defaulting to lead came.
  await expect(dock.getByRole('heading', { name: 'Technique' })).toBeVisible()
  const leadTab = dock.getByRole('tab', { name: 'Lead came' })
  const foilTab = dock.getByRole('tab', { name: 'Copper foil' })
  await expect(leadTab).toHaveAttribute('aria-selected', 'true')
  await expect(dock.getByRole('heading', { name: 'Came library' })).toBeVisible()

  // Switch to copper foil: the foil parameters replace the came library.
  await foilTab.click()
  await expect(foilTab).toHaveAttribute('aria-selected', 'true')
  await expect(dock.getByLabel('Foil width (mm)')).toBeVisible()
  await expect(dock.getByLabel('Solder finish')).toBeVisible()

  // Undo returns to lead came (one undo step, FR-4).
  await window.keyboard.press('Control+z')
  await expect(dock.getByRole('tab', { name: 'Lead came' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Toggle the cut-contour overlay from the Layers panel.
  const cutsChip = dock.getByRole('button', { name: /Cut contours/ })
  await expect(cutsChip).toHaveAttribute('aria-pressed', 'false')
  await cutsChip.click()
  await expect(cutsChip).toHaveAttribute('aria-pressed', 'true')
})
