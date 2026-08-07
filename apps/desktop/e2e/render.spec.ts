import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0
let pngPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  pngPath = join(tmpdir(), `vitrum-e2e-render-${id}.png`)
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ...isolatedAppData(),
      VITRUM_AUTOSAVE_PATH: join(tmpdir(), `vitrum-e2e-render-auto-${id}.vitrum`),
      VITRUM_GLASS_LIBRARY_PATH: join(tmpdir(), `vitrum-e2e-render-lib-${id}.json`),
      VITRUM_EXPORT_PNG_PATH: pngPath,
    },
  })
  // F-058: the app now opens on the launch screen; step into the editor.
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

// F-053: drives the realistic WebGL render through the packaged file:// build (the only place the
// F-030 "module worker blocked under file://" class of GPU/context problem shows up). Draws + paints
// a panel, switches to the Render view (asserting the WebGL layer goes live), edits the geometry
// while in render mode (FR-3: it's a live view, not an export), and exports a PNG snapshot of the
// render (asserting a real image lands on disk).
test('render view: switch live, edit in render mode, export a PNG snapshot', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  // A closed rectangular border → one piece; paint it so the render has coloured glass.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(120, 120))
  await window.mouse.click(...at(360, 300))

  // Cockpit v2 opens the dock on Draw, so open the Glass section to reach the palette.
  await window.getByRole('button', { name: 'Glass', exact: true }).click()
  const paletteRegion = window.getByRole('region', { name: 'Glass palette' })
  await paletteRegion.locator('button.glass').first().click()
  await window.mouse.click(...at(240, 210))

  // The debug palette lets us read the segment count without depending on canvas pixels.
  const debug = window.getByRole('dialog', { name: 'Debug commands' })
  const count = debug.getByTestId('segment-count')
  const openDebug = async () => {
    await window.keyboard.press('Control+k')
    await expect(debug).toBeVisible()
  }
  const closeDebug = async () => {
    await window.keyboard.press('Control+k')
    await expect(debug).toBeHidden()
    await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }

  await openDebug()
  const before = Number((await count.textContent())!.replace(/\D/g, ''))
  await closeDebug()

  // Switch to the Render view: the WebGL glass layer goes live (visible, no longer .hidden).
  await window.getByRole('tab', { name: 'Render', exact: true }).click()
  const glass = window.locator('canvas.glass-render')
  await expect(glass).toBeVisible()

  // FR-3: edit the geometry while in render mode — a division line adds one segment live. The tools
  // live in the Draw section (Cockpit v2), which stays available in the render view because render
  // is editable; picking Line also exits the paint mode left active from painting above.
  await window.getByRole('button', { name: 'Draw', exact: true }).click()
  await window.getByRole('button', { name: 'Line (L)', exact: true }).click()
  await window.mouse.click(...at(240, 140))
  await window.mouse.dblclick(...at(240, 280))
  await openDebug()
  await expect
    .poll(async () => Number((await count.textContent())!.replace(/\D/g, '')))
    .toBeGreaterThan(before)
  await closeDebug()

  // Export a PNG snapshot of the render (F-053 scope: portfolio/client image).
  await rm(pngPath, { force: true })
  await window.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = window.getByRole('dialog', { name: 'Export' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('What to export').selectOption('png')
  await dialog.getByRole('button', { name: 'Export' }).click()
  await expect(dialog).toBeHidden()

  await expect
    .poll(
      async () => {
        try {
          return (await readFile(pngPath)).byteLength
        } catch {
          return 0
        }
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0)
  const png = await readFile(pngPath)
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
})
