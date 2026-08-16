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

  // The centre seeds to the panel's centre, not its top-left corner: the new-panel dialog's
  // defaults are 300 × 400 mm, so the spokes pivot on (150, 200) and every replica lands on the
  // glass (run 2026-08-16-a, F-052 finding 1). Editable right here, too.
  await expect(window.getByLabel('Symmetry centre x')).toHaveValue('150')
  await expect(window.getByLabel('Symmetry centre y')).toHaveValue('200')

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

// Regression, user-test run 2026-08-16-a finding 2 (F-052 FR-5): drawing with the cursor in a
// replica sector used to snap in *folded* source space, so a stroke crossing the axis flipped
// between 45° rays instead of following the cursor. Snapping now happens in the sector the cursor is
// in and only the winner folds back, so the line the user sees — the replica under their cursor —
// runs from the point they clicked to the point they released.
test('drawing in a replica sector follows the cursor, not a 45° artefact', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (p: { x: number; y: number }): [number, number] => [box.x + p.x, box.y + p.y]
  const dock = window.getByRole('complementary', { name: 'Panel dock' })

  /** The status bar's raw cursor readout, in mm — the app's own answer for "where is the pointer". */
  const cursorMm = async (): Promise<{ x: number; y: number }> => {
    const text = (await window.getByLabel('Cursor position').textContent()) ?? ''
    const m = /X\s+(-?[\d.]+)\s*mm\s+Y\s+(-?[\d.]+)\s*mm/.exec(text)
    if (!m) throw new Error(`unreadable cursor readout: ${text}`)
    return { x: Number(m[1]), y: Number(m[2]) }
  }

  // Mirror symmetry with the axis at 36°: deliberately **not** a multiple of 22.5°, so reflecting
  // the 45° ray fan does not map it onto itself. That is exactly the case the old fold-then-snap
  // order got wrong — with an axis at 0/45/90° the two orders happen to agree.
  await window.getByRole('button', { name: 'Draw', exact: true }).click()
  await window.getByRole('button', { name: 'Mirror (1 axis)' }).click()
  await window.getByLabel('Symmetry axis angle in degrees').fill('36')
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  // Grid snap off: it fires within the same radius as angle snap and would mask the difference.
  await dock.getByRole('button', { name: 'Grid', exact: true }).click()

  // A stroke wholly inside a replica sector (with the axis through the panel, that is what the
  // cursor is in for most of the panel), at ~22° off every 45° ray so no angle snap may fire —
  // while its *reflection* lands ~5° off one, which is what the old order snapped to.
  const start = { x: Math.round(box.width * 0.72), y: Math.round(box.height * 0.18) }
  const end = { x: start.x + 65, y: start.y + 26 }

  await window.mouse.move(...at(start))
  const startMm = await cursorMm()
  await window.keyboard.press('l')
  await window.mouse.click(...at(start))
  await window.mouse.move(...at(end))
  const endMm = await cursorMm()
  await window.mouse.dblclick(...at(end))

  // Screen px → mm, so the tolerance below is two pixels whatever the zoom is. Measured: the fix
  // lands within 0.5 px of the cursor, the fold-then-snap order was 6.3 px out.
  const spanPx = Math.hypot(end.x - start.x, end.y - start.y)
  const mmPerPx = Math.hypot(endMm.x - startMm.x, endMm.y - startMm.y) / spanPx
  const tol = 2 * mmPerPx

  await window.keyboard.press('Control+k')
  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  await expect(palette).toBeVisible()
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 1')

  // `outputNetwork()` lists the source first, then the replicas — so entry 1 is the mirror image,
  // the line the user was actually looking at while drawing.
  const ends = (await palette.getByTestId('output-ends').textContent()) ?? ''
  const points = [...ends.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }))
  expect(points).toHaveLength(4) // 2 segments × 2 endpoints
  const [replicaStart, replicaEnd] = [points[2]!, points[3]!]

  // The replica starts where the user clicked (so the click really was in a replica sector — if it
  // had been in the source, the *source* segment would be the one under the cursor) …
  expect(Math.hypot(replicaStart.x - startMm.x, replicaStart.y - startMm.y)).toBeLessThan(tol)
  // … and ends where they released, rather than on a 45° ray reflected out of source space.
  expect(Math.hypot(replicaEnd.x - endMm.x, replicaEnd.y - endMm.y)).toBeLessThan(tol)
})
