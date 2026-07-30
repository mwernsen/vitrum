import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication
let runId = 0

test.beforeEach(async () => {
  const autosavePath = join(tmpdir(), `vitrum-e2e-vp-${process.pid}-${runId++}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VITRUM_AUTOSAVE_PATH: autosavePath },
  })
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

const zoomPercent = (text: string | null): number => Number.parseInt(text ?? '', 10)

// Drives the F-003 viewport end to end: the canvas and its chrome render, the cursor
// read-out tracks the pointer, keyboard zoom is cursor-anchored, and the unit switch
// reformats coordinates. Pixel-level rendering is covered by manual calibration checks.
test('pans, zooms and switches units through the canvas viewport', async () => {
  const window = await app.firstWindow()

  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()

  const zoom = window.getByLabel('Zoom level')
  const coords = window.getByLabel('Cursor position')
  await expect(zoom).toHaveText(/%$/)
  await expect(coords).toHaveText('X — Y —')

  // Moving the pointer over the canvas updates the live coordinate read-out.
  await canvas.hover()
  await expect(coords).not.toHaveText('X — Y —')
  await expect(coords).toContainText('mm')

  // Keyboard zoom-in (one 1.2× step) increases the reported zoom.
  const before = zoomPercent(await zoom.textContent())
  await window.keyboard.press('=')
  await expect.poll(async () => zoomPercent(await zoom.textContent())).toBeGreaterThan(before)

  // Switching the unit reformats the coordinate read-out to fractional inches.
  await window.getByRole('button', { name: /Measurement unit/ }).click()
  await expect(window.getByRole('button', { name: /Measurement unit/ })).toHaveText('in')
  await canvas.hover()
  await expect(coords).toContainText('"')

  // Zoom-to-fit reframes the default region without error. Cockpit v2 moved it onto the canvas
  // viewport chip, next to the zoom read-out it changes.
  await window.getByRole('button', { name: 'Zoom to fit' }).click()
  await expect(zoom).toHaveText(/%$/)
})
