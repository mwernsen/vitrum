import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

import { closeReadiness, readinessRow } from './readiness'

import { editorWindow } from './editor'

import { isolatedAppData } from './appdata'

let app: ElectronApplication
let runId = 0
let documentPath: string

test.beforeEach(async () => {
  const id = `${process.pid}-${runId++}`
  documentPath = join(tmpdir(), `vitrum-e2e-symglass-doc-${id}.vitrum`)
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      ...isolatedAppData(),
      VITRUM_AUTOSAVE_PATH: join(tmpdir(), `vitrum-e2e-symglass-auto-${id}.vitrum`),
      VITRUM_GLASS_LIBRARY_PATH: join(tmpdir(), `vitrum-e2e-symglass-lib-${id}.json`),
    },
  })
  // Stub the native dialogs so the save/reopen round-trip can run headless (repo E2E convention).
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dialog.showMessageBox = (async () => ({ response: 0 })) as any
  }, documentPath)
  await editorWindow(app)
})

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

/** The readiness meter's glass step, parsed as `painted of total`. */
async function painted(window: Page): Promise<{ painted: number; total: number }> {
  const row = await readinessRow(window, 'Every piece has glass')
  const text = (await row.textContent()) ?? ''
  const match = /(\d+) of (\d+) painted/.exec(text)
  if (!match) throw new Error(`could not read the glass readiness row: ${JSON.stringify(text)}`)
  return { painted: Number(match[1]), total: Number(match[2]) }
}

// F-052 [S2] (user-test run docs/testing/runs/2026-08-16-a): glass follows live symmetry. Painting the
// source sector once colours every replica, and the colours re-derive from the source on a cold
// reload — so a symmetric design is painted once, not once per sector. Piece counts are read from the
// readiness meter rather than hardcoded, so the test states the invariant ("one paint coloured every
// piece") without depending on where the symmetry centre happens to sit.
test('painting the source sector colours every replica, and survives a reload', async () => {
  const window = await app.firstWindow()
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y]

  // Turn on a single mirror. A reflection of a shape confined to the source half-plane can never
  // overlap it, so the drawn rectangle and its replica are always two distinct pieces.
  await window.getByRole('button', { name: 'Draw', exact: true }).click()
  await window.getByRole('button', { name: 'Mirror (1 axis)' }).click()

  // Draw a closed rectangle. Pointers are folded into the source sector (FR-5), so this lands in the
  // source half whatever the centre is, and the mirror image is derived beside it.
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(...at(110, 110))
  await window.mouse.click(...at(210, 190))

  const before = await painted(window)
  expect(before.total).toBeGreaterThanOrEqual(2) // the replica really is a detected piece
  expect(before.painted).toBe(0)
  await closeReadiness(window)

  // Pick a glass (selecting a library swatch imports a project copy and enters paint mode).
  await window.getByRole('button', { name: 'Glass', exact: true }).click()
  const palette = window.getByRole('region', { name: 'Glass palette' })
  await expect(palette).toBeVisible()
  await palette.locator('button.glass').first().click()

  // One click, inside the rectangle the user drew.
  await window.mouse.click(...at(160, 150))

  const after = await painted(window)
  expect(after.total).toBe(before.total)
  expect(after.painted).toBe(before.total) // painted once ⇒ every sector coloured
  await closeReadiness(window)

  // Save and reopen: replica colour re-derives from the source on a cold detection (no per-replica
  // entry is stored, so this is the path that would have silently lost the colour).
  await window.keyboard.press('Control+s')
  await closeReadiness(window)
  await window.keyboard.press('Control+o')
  const reloaded = await painted(window)
  expect(reloaded).toEqual({ painted: before.total, total: before.total })
})
