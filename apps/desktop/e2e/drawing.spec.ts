import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-draw-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives the F-011 drawing tools end to end: draw a panel (border + lines + an arc + a
// bézier) with real pointer/keyboard input, confirm the segments land in the document,
// and confirm one undo removes one whole gesture (FR-1). Segment counts are read from the
// debug palette (the same signal F-002's E2E uses); pixel rendering is manual.
test('draws a panel of border, lines, an arc and a bézier', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!

  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))
  const dblclick = (x: number, y: number) => window.mouse.dblclick(...at(x, y))

  // Border (toolbar-only, no shortcut). Two corners auto-commit as four border segments.
  await window.getByRole('button', { name: 'Panel border' }).click()
  // Drop focus off the button so later keystrokes only reach the global tool handler.
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(100, 100)
  await click(360, 300)

  // Line polyline: L, click, click, double-click to finish → two welded spans.
  await window.keyboard.press('l')
  await click(120, 120)
  await click(180, 150)
  await dblclick(240, 120)

  // Arc (three-point): three clicks auto-commit one arc.
  await window.keyboard.press('a')
  await click(130, 200)
  await click(170, 240)
  await click(210, 200)

  // Bézier: B, click, double-click to finish → one (straight) cubic.
  await window.keyboard.press('b')
  await click(280, 140)
  await dblclick(340, 180)

  await expect(window.getByText('Unsaved')).toBeVisible()

  // The document now holds 4 (border) + 2 (line) + 1 (arc) + 1 (bézier) = 8 segments.
  await window.keyboard.press('Control+k')
  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  const count = palette.getByTestId('segment-count')
  await expect(count).toHaveText('Segments: 8')

  // One undo removes one whole gesture, not one segment (FR-1): bézier, arc, line, border.
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText('Segments: 7') // − bézier (1)
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText('Segments: 6') // − arc (1)
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText('Segments: 4') // − line (2)
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText('Segments: 0') // − border (4)
})
