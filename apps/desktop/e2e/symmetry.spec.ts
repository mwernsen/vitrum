import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-symmetry-${process.pid}-${runId++}.vitrum`)
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

// F-052 FR-1/FR-3: with 6-fold radial symmetry, drawing one line yields 6 live replicas (proved by
// baking → 6 stored segments), undoing the bake restores the single source, and undoing the draw
// removes everything (the replicas are derived from the one source command — free undo).
test('6-fold radial: draw one line → 6 replicas, undo removes all, then bake', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]
  const click = (x: number, y: number) => window.mouse.click(...at(x, y))
  const dblclick = (x: number, y: number) => window.mouse.dblclick(...at(x, y))

  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  const count = palette.getByTestId('segment-count')
  const openPalette = async () => {
    await window.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
  }
  const closePalette = async () => {
    await window.keyboard.press('Control+k')
    await expect(palette).toBeHidden()
    await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }

  // Open the Draw dock section and turn on 6-fold radial symmetry. Cockpit v2 replaced the mode
  // select with four mode buttons, so the current mode is visible without opening anything.
  await window.getByRole('button', { name: 'Draw', exact: true }).click()
  await window.getByRole('button', { name: 'Radial (N-fold)' }).click()
  await window.getByLabel('Radial fold count').fill('6')
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  // Draw one line (L, click, double-click to finish) → a single source segment.
  await window.keyboard.press('l')
  await click(180, 160)
  await dblclick(260, 220)

  await openPalette()
  await expect(count).toHaveText('Segments: 1')
  await closePalette()

  // Bake the live symmetry: the 5 derived replicas materialise → 6 stored segments, one undo step.
  await window.getByRole('button', { name: 'Draw', exact: true }).click()
  await window.getByRole('button', { name: 'Bake symmetry' }).click()

  await openPalette()
  await expect(count).toHaveText('Segments: 6')

  // Undo the bake → back to the single source line.
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText('Segments: 1')

  // Undo the draw → nothing left (the source and all its live replicas are gone together, FR-1).
  await palette.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText('Segments: 0')
})
