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
// from the top-bar technique chip — switch lead⇄foil (line weights change, foil parameters appear) and
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

  // Cockpit v2: technique is a document-level decision, so it reads out in the top bar and opens
  // its panel there. The chip states the technique in force plus the came it draws at.
  const chip = window.getByRole('button', { name: /^Technique:/ })
  await expect(chip).toContainText('Lead came')
  await chip.click()
  const sheet = window.getByRole('dialog', { name: 'Technique' })
  const leadTab = sheet.getByRole('tab', { name: 'Lead came' })
  const foilTab = sheet.getByRole('tab', { name: 'Copper foil' })
  await expect(leadTab).toHaveAttribute('aria-selected', 'true')
  await expect(sheet.getByRole('heading', { name: 'Came library' })).toBeVisible()

  // Switch to copper foil: the foil parameters replace the came library.
  await foilTab.click()
  await expect(foilTab).toHaveAttribute('aria-selected', 'true')
  await expect(sheet.getByLabel('Foil width (mm)')).toBeVisible()
  await expect(sheet.getByLabel('Solder finish')).toBeVisible()
  await expect(chip).toContainText('Copper foil')

  // Undo returns to lead came (one undo step, FR-4).
  await window.keyboard.press('Control+z')
  await expect(sheet.getByRole('tab', { name: 'Lead came' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await window.keyboard.press('Escape')

  // The cut-contour overlay moved onto the canvas Overlays chip, with the rest of the overlays.
  await window.getByRole('button', { name: /^Overlays,/ }).click()
  const overlays = window.getByRole('group', { name: 'Overlay visibility' })
  const cutsRow = overlays.getByRole('button', { name: /Cut contours/ })
  await expect(cutsRow).toHaveAttribute('aria-pressed', 'false')
  await cutsRow.click()
  await expect(cutsRow).toHaveAttribute('aria-pressed', 'true')
})
