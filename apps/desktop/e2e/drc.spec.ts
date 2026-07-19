import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-drc-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-030 end to end: draw a panel that breaks two rules (an unassigned piece and a dangling
// spur), open the Rules dock, run the checks, see the violations and the readiness pill, then waive
// one with a note and watch the counts update live.
test('runs checks, lists violations, and waives one with a note', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!

  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))
  const dblclick = (x: number, y: number) => window.mouse.dblclick(...at(x, y))

  // Closed rectangular border, then a divider → two pieces (both unassigned).
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(120, 120)
  await click(360, 300)

  await window.keyboard.press('l')
  await click(240, 120)
  await dblclick(240, 300)

  // A spur that dangles into empty space → a dangling-line error.
  await window.keyboard.press('l')
  await click(360, 300)
  await dblclick(440, 380)

  // Open the Rules dock and run the checks.
  await window.getByRole('button', { name: 'Design rules' }).click()
  await window.getByRole('button', { name: 'Run checks' }).click()

  // Both rules fire; the readiness pill counts them.
  await expect(window.getByText('Dangling line')).toBeVisible()
  await expect(window.getByText('Unassigned glass').first()).toBeVisible()
  await expect(window.getByTestId('checks-readiness')).toContainText('issues')

  // Waive the dangling line with a note; it leaves the active list for the excluded tab.
  await window.getByText('Dangling line').click()
  await window.getByPlaceholder('Why waive? (optional)').fill('spur is intentional')
  await window.getByRole('button', { name: 'Waive' }).click()

  await expect(window.getByText('1 waived')).toBeVisible()
  await window.getByRole('button', { name: 'View excluded' }).click()
  await expect(window.getByText('“spur is intentional”')).toBeVisible()
})
