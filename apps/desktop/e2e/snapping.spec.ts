import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-snap-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-012 endpoint snapping end to end: draw a line, then draw a second line whose start
// is clicked *near but not exactly* the first line's endpoint. With endpoint snap on (default),
// the second start welds to the first endpoint's exact coordinate (FR-1), so the network has
// one shared node — read as the debug palette's distinct-node count, which drops to 3 rather
// than 4. Also confirms the construction-guide tool and the snap chip are present.
test('welds a second line to an existing endpoint via endpoint snap', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!

  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))
  const dblclick = (x: number, y: number) => window.mouse.dblclick(...at(x, y))

  // The tools and the snap chip are on the chrome.
  await expect(window.getByRole('button', { name: 'Construction guide (G)' })).toBeVisible()
  await expect(window.getByRole('button', { name: /Snapping/ })).toBeVisible()

  // First line: L, click, double-click → one span, endpoints at (200,200) and (300,200).
  await window.keyboard.press('l')
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(200, 200)
  await dblclick(300, 200)

  // Second line: start clicked ~5 px off the first endpoint. Endpoint snap pulls it onto the
  // exact node, so the two lines share a coordinate.
  await window.keyboard.press('l')
  await click(304, 203)
  await dblclick(420, 260)

  await expect(window.getByText('Unsaved')).toBeVisible()

  await window.keyboard.press('Control+k')
  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 2')
  // Four endpoints, but two coincide exactly after the weld → three distinct nodes.
  await expect(palette.getByTestId('node-count')).toHaveText('Distinct nodes: 3')
})
