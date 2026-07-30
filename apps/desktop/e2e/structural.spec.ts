import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-struct-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-032's headline acceptance: draw an oversized panel that demands a reinforcement bar, run
// the checks and see the violation, then place a bar spanning the panel and watch it clear.
test('flags an oversized panel and clears it with a reinforcement bar', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!

  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))

  // Zoom well out so a pixel maps to several millimetres — the drawn border is then a metre-plus
  // panel, over the reinforcement thresholds regardless of the display's calibrated scale.
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let i = 0; i < 12; i++) await window.keyboard.press('-')

  // A big rectangular border → one large piece. The x extents stay inside the Cockpit v2 canvas,
  // which is narrower than before (the inspector no longer collapses); 12 zoom-outs still make this
  // a metre-plus panel.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(120, 120)
  await click(560, 500)

  // Run the checks and see the reinforcement violation.
  await window.getByRole('button', { name: 'Check' }).click()
  await window.getByRole('button', { name: 'Run checks' }).click()
  // Scope to the queue: Cockpit v2 also promotes the top violation into a "Fix next" card, so the
  // title appears twice.
  const queue = window.getByLabel('Violations')
  await expect(queue.getByText('Needs reinforcement')).toBeVisible()

  // Place a reinforcement bar spanning the panel's long (horizontal) dimension. Cockpit v2 keeps the
  // tools in the Draw section, so come back to it first. Exact match so this targets the tool, not
  // the violation row whose message mentions a "reinforcement bar".
  await window.getByRole('button', { name: 'Draw', exact: true }).click()
  await window.getByRole('button', { name: 'Reinforcement', exact: true }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(150, 320)
  await click(540, 320)

  // Re-run: the bar braces the span, so the violation clears.
  await window.getByRole('button', { name: 'Check' }).click()
  await window.getByRole('button', { name: 'Re-run' }).click()
  await expect(window.getByText('Needs reinforcement')).toHaveCount(0)
})
