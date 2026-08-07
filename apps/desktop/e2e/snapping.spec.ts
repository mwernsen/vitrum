import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-snap-${process.pid}-${runId++}.vitrum`)
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

  // Cockpit v2: the tools and the snap controls both live in the Draw dock section.
  const draw = window.getByRole('complementary', { name: 'Panel dock' })
  await expect(window.getByRole('button', { name: 'Guide (G)' })).toBeVisible()
  await expect(draw.getByRole('switch', { name: 'Snapping' })).toBeVisible()

  // Isolate endpoint snap from the zoom-adaptive grid: with grid snap on, the first line's
  // endpoints jump to grid nodes (spacing varies with zoom), which makes a fixed-pixel near-miss
  // brittle. Turn grid off so this test proves *endpoint* welding specifically.
  const gridChip = draw.getByRole('button', { name: 'Grid', exact: true })
  await expect(gridChip).toHaveAttribute('aria-pressed', 'true')
  await gridChip.click()
  await expect(gridChip).toHaveAttribute('aria-pressed', 'false')

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

  await expect(window.getByLabel('Unsaved changes')).toBeVisible()

  await window.keyboard.press('Control+k')
  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 2')
  // Four endpoints, but two coincide exactly after the weld → three distinct nodes.
  await expect(palette.getByTestId('node-count')).toHaveText('Distinct nodes: 3')
})
