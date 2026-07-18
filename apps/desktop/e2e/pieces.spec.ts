import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-pieces-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// Drives F-020 end to end: draw a closed border (one piece), split it with a line (two
// pieces), then add a spur (a dangling-end diagnostic). Piece and diagnostic counts are read
// from the debug palette — the same dev signal the F-002/F-011 E2Es use; the coloured overlay
// itself is a manual/gallery check.
test('detects pieces live as the network closes, splits and breaks', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!

  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))
  const dblclick = (x: number, y: number) => window.mouse.dblclick(...at(x, y))

  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  const pieceCount = palette.getByTestId('piece-count')
  const diagnosticCount = palette.getByTestId('diagnostic-count')

  async function openPalette() {
    await window.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
  }
  async function closePalette() {
    await window.keyboard.press('Control+k')
    await expect(palette).toBeHidden()
    await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }

  // Closed rectangular border → one piece.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await click(120, 120)
  await click(360, 300)

  await openPalette()
  await expect(pieceCount).toHaveText('Pieces: 1')
  await expect(diagnosticCount).toHaveText('Diagnostics: 0')
  await closePalette()

  // A divider from the top edge to the bottom edge splits the panel into two pieces. Snapping
  // (on by default) welds the endpoints onto the border so the crossing is exact.
  await window.keyboard.press('l')
  await click(240, 120)
  await dblclick(240, 300)

  await openPalette()
  await expect(pieceCount).toHaveText('Pieces: 2')
  await closePalette()

  // A spur that dangles into empty space is reported (and pruned from face tracing).
  await window.keyboard.press('l')
  await click(360, 300)
  await dblclick(440, 380)

  await openPalette()
  await expect(pieceCount).toHaveText('Pieces: 2')
  await expect(diagnosticCount).not.toHaveText('Diagnostics: 0')
})
