import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { closeReadiness, readinessRow } from './readiness'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-drc-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, ...isolatedAppData(), VITRUM_AUTOSAVE_PATH: autosavePath },
  })
  // F-058: the app now opens on the launch screen; step into the editor.
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-030 end to end: draw a panel that breaks two rules (an unassigned piece and a dangling
// spur), open the Check dock, run the checks, see the violations and the readiness step, then waive
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

  // Open the Check dock and run the checks.
  await window.getByRole('button', { name: 'Check' }).click()
  await window.getByRole('button', { name: 'Run checks' }).click()

  // Both rules fire; the readiness meter's checks step counts them.
  const queue = window.getByLabel('Violations')
  await expect(queue.getByText('Dangling line')).toBeVisible()
  // Two rows carry the phrase (the title and a message), so count rather than match one.
  await expect(queue.getByText('Unassigned glass').first()).toBeVisible()
  await expect(await readinessRow(window, 'Checks are clear')).toContainText('errors')
  await closeReadiness(window)

  // Waive the dangling line with a note; it leaves the queue for the excluded tab.
  await queue.getByText('Dangling line').click()
  await window.getByPlaceholder('Why waive? (optional)').fill('spur is intentional')
  await queue.getByRole('button', { name: 'Waive' }).click()

  await expect(window.getByText('1 waived')).toBeVisible()
  await window.getByRole('button', { name: 'View excluded' }).click()
  await expect(window.getByText('“spur is intentional”')).toBeVisible()
})
