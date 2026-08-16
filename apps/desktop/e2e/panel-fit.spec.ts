import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { baseEnv, isolatedAppData } from './appdata'

/**
 * A 300 × 400 mm order whose border is drawn to exactly 300 × 400 — the came centreline, so the panel
 * assembles to 305 × 405 mm. Opened from disk because no amount of clicking on a canvas hits an exact
 * millimetre; the same scene is the `fit-drawn-to-size` golden fixture in `packages/drc`.
 */
const DRAWN_TO_SIZE = fileURLToPath(new URL('./fixtures/drawn-to-size.vitrum', import.meta.url))

let app: ElectronApplication
let runId = 0

function launchEnv(): Record<string, string> {
  const autosavePath = join(tmpdir(), `vitrum-e2e-fit-${process.pid}-${runId++}.vitrum`)
  return { ...baseEnv(), ...isolatedAppData(), VITRUM_AUTOSAVE_PATH: autosavePath }
}

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'], env: launchEnv() })
  // F-058: the app opens on the launch screen; step into the editor. Its new-panel defaults order a
  // 300 × 400 mm panel, which is exactly the reference this rule checks against.
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-033 end to end: the panel ordered by the new-panel dialog is 300 × 400 mm, so a design
// drawn far larger than that has no glass to be cut from. Draw one, run the checks, and see the
// violation naming the ordered size; undo the design and watch it clear.
test('flags a design larger than the ordered panel and clears it', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!

  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))

  // Zoom well out so a pixel maps to several millimetres; the drawn border is then a metre-plus
  // panel, comfortably past the ordered 300 × 400 mm whatever the display's calibrated scale.
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let i = 0; i < 12; i++) await window.keyboard.press('-')

  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(120, 120)
  await click(560, 500)

  // Run the checks and read the violation. Scope to the queue: Cockpit v2 also promotes the top
  // violation into a "Fix next" card, so the title appears twice.
  await window.getByRole('button', { name: 'Check' }).click()
  await window.getByRole('button', { name: 'Run checks' }).click()
  const queue = window.getByLabel('Violations')
  const row = queue.getByText('Exceeds panel')
  await expect(row).toBeVisible()
  // The message states what was measured against what was ordered — and since 2026-08-16 what it
  // measures is the *assembled* panel, drawn extent plus the perimeter came.
  await expect(queue).toContainText('the ordered 300 × 400 mm panel')
  await expect(queue).toContainText('assembles to')
  await expect(queue).toContainText('of came on each side')

  // Undo the border — one gesture is one undo entry — and re-run: nothing is left to overrun.
  await window.keyboard.press('Control+k')
  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 0')
  await window.keyboard.press('Escape')

  // Still in the Check section — and do not re-click the rail button here: a violation row's
  // accessible name can contain the word "check" (the weight rule's "check hanging hardware"),
  // which makes a name-based button query ambiguous once the queue has rows.
  await window.getByRole('button', { name: 'Re-run' }).click()
  await expect(window.getByText('Exceeds panel')).toHaveCount(0)
})

// The 2026-08-16 meaning of `panelSize`, end to end: a border drawn to *exactly* the ordered
// 300 × 400 mm used to pass clean, because the drawn centreline was compared with the order. The came
// lands outside that line, so the finished panel is 305 × 405 mm and the rule now says so — as an
// error, since no amount of moving it will make it fit the opening.
test('measures the finished panel, so a design drawn to the ordered size is an error', async () => {
  // This test opens a document rather than drawing one, so the editor from `beforeEach` is not used.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  app = await electron.launch({ args: ['.', DRAWN_TO_SIZE], env: launchEnv() })
  const window = await app.firstWindow()
  await expect(window.getByTestId('document-chip')).toContainText('Panel fit')

  await window.getByRole('button', { name: 'Check' }).click()
  await window.getByRole('button', { name: 'Run checks' }).click()
  const queue = window.getByLabel('Violations')
  await expect(queue.getByText('Exceeds panel')).toBeVisible()
  await expect(queue).toContainText(
    'assembles to 305 × 405 mm — 5 mm wider and 5 mm taller than the ordered 300 × 400 mm panel ' +
      '(drawn 300 × 400 mm plus 2.5 mm of came on each side)',
  )
})
