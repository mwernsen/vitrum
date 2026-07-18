import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-edit-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives the F-013 selection/editing flow end to end: draw a welded L, select the whole
// network, transform it (mirror) through the inspector, then delete and undo. Junction
// integrity (FR-1) is observed through the debug palette's distinct-node count — the
// coincidence checker the spec names — which stays at 3 through the edits (a tear would
// push it to 4).
test('reworks a drawn network without tearing a welded junction', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!

  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))
  const dblclick = (x: number, y: number) => window.mouse.dblclick(...at(x, y))

  const openPalette = async () => {
    await window.keyboard.press('Control+k')
    return window.getByRole('dialog', { name: 'Debug commands' })
  }
  const closePalette = (p: ReturnType<typeof window.getByRole>) =>
    p.getByRole('button', { name: 'Close' }).click()

  // Draw an L of two welded spans (the polyline auto-welds at the middle junction).
  await window.keyboard.press('l')
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(150, 150)
  await click(230, 190)
  await dblclick(310, 150)

  // Enter the inert select tool (Esc cancels any rubber band, then the tool).
  await window.keyboard.press('Escape')
  await window.keyboard.press('Escape')

  // Baseline: two segments, three distinct nodes (the middle junction welded).
  let palette = await openPalette()
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 2')
  await expect(palette.getByTestId('node-count')).toHaveText('Distinct nodes: 3')
  await closePalette(palette)

  // Select everything, then mirror it through the inspector — the shared junction moves as one
  // node, so the weld holds (still three distinct nodes, not four).
  await window.keyboard.press('Control+a')
  await expect(window.getByText('2 selected')).toBeVisible()
  await window.getByRole('button', { name: 'Mirror horizontal' }).click()

  palette = await openPalette()
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 2')
  await expect(palette.getByTestId('node-count')).toHaveText('Distinct nodes: 3') // no tear
  await closePalette(palette)

  // Delete the selection from the inspector; one undo restores the intact, welded network.
  await window.getByRole('button', { name: 'Delete' }).click()
  palette = await openPalette()
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 0')
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 2')
  await expect(palette.getByTestId('node-count')).toHaveText('Distinct nodes: 3')
  await closePalette(palette)
})
