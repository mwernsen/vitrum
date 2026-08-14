import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

import { baseEnv, isolatedAppData } from './appdata'

/**
 * F-058 end to end, through the packaged app. Two flows the acceptance criteria name:
 *
 * 1. launch screen → new panel via the dialog → draw → save → back to the library → the entry is
 *    listed with a real panes figure (which is what proves the save-time index, FR-10) → reopen it →
 *    content intact;
 * 2. launching *with* a file argument bypasses the library into the editor (FR-1).
 *
 * The app is launched per test rather than in `beforeEach`, because flow 2 needs two launches: one to
 * produce a real `.vitrum` on disk, a second to open it from the command line.
 */

let runId = 0

interface Run {
  app: ElectronApplication
  window: Page
}

/**
 * Launch the packaged app with every piece of app-data isolated to this run: autosave (so no
 * crash-recovery prompt), the panel library, and version history. `savePath` bypasses the native save
 * dialog; `args` appends command-line arguments after the app path.
 */
async function launch(env: Record<string, string>, args: string[] = []): Promise<Run> {
  const app = await electron.launch({
    args: ['.', ...args],
    env: { ...baseEnv(), ...env },
  })
  return { app, window: await app.firstWindow() }
}

function isolated(label: string): { env: Record<string, string>; savePath: string } {
  const id = `${process.pid}-${runId++}`
  // Its own directory for the saved panel, so a later launch can still open the file by path while
  // getting a fresh library of its own.
  const savePath = join(mkdtempSync(join(tmpdir(), `vitrum-e2e-${label}-${id}-`)), 'panel.vitrum')
  return { savePath, env: { ...isolatedAppData(), VITRUM_SAVE_AS_PATH: savePath } }
}

/** Draw a closed rectangular border, so the panel really has one detectable pane. */
async function drawBorder(window: Page): Promise<void> {
  const canvas = window.getByRole('main', { name: 'Design canvas' })
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  await window.getByRole('button', { name: 'Panel border' }).click()
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.mouse.click(box.x + 120, box.y + 120)
  await window.mouse.click(box.x + 380, box.y + 320)
}

/** Create a panel through the new-panel dialog and land in the editor. */
async function createPanel(window: Page, name: string): Promise<void> {
  await window.getByRole('button', { name: 'New panel', exact: true }).click()
  const dialog = window.getByRole('dialog', { name: 'New panel' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Width').fill('300')
  await dialog.getByLabel('Height').fill('400')
  await dialog.getByRole('button', { name: 'Create panel' }).click()
  await expect(window.getByRole('banner')).toBeVisible()
}

test('goes from the launch screen through a new panel and back, with a real indexed figure', async () => {
  const { env } = isolated('library')
  const { app, window } = await launch(env)

  // FR-1: a plain launch opens the launch screen, not the editor.
  await expect(window.getByRole('navigation', { name: 'Library sections' })).toBeVisible()
  await expect(window.getByTestId('library-empty')).toContainText('No panels yet')
  // "Glass library" (F-063) is now a live destination alongside "Panels"; the removed
  // Cut lists / Versions / Settings rows stay gone (F-058 amendment 2026-08-14).
  const rail = window.getByRole('navigation', { name: 'Library sections' })
  await expect(rail.getByRole('button', { name: /Glass library/ })).toBeEnabled()
  await expect(rail.getByRole('button', { name: /Settings/ })).toHaveCount(0)

  // FR-3: the dialog creates the panel and enters the editor with its real name and size.
  await createPanel(window, 'Rose window, south nave')
  await expect(window.getByTestId('document-chip')).toContainText('Rose window, south nave')

  // Draw a closed border, so there is one pane to count, then save.
  await drawBorder(window)
  await expect(window.getByLabel('Unsaved changes')).toBeVisible()
  await window.keyboard.press('Control+s')
  await expect(window.getByLabel('Saved', { exact: true })).toBeVisible()

  // FR-5: back to the library from the top bar, behind the unsaved-changes guard (clean here).
  await window.getByRole('button', { name: 'Back to panel library' }).click()
  await expect(rail).toBeVisible()

  // The just-saved panel now leads the Continue hero, carrying the figures the save indexed —
  // this is what proves FR-10: the panes count came from the library entry, not from the open file.
  const hero = window.getByRole('region', { name: 'Continue' })
  await expect(hero).toContainText('Rose window, south nave')
  await expect(hero).toContainText('1 pane')
  await expect(hero).toContainText('Geometry complete')

  // FR-2/FR-9: reopening it restores the content — the four border segments are still there.
  await hero.getByRole('button', { name: 'Resume editing' }).click()
  await expect(window.getByTestId('document-chip')).toContainText('Rose window, south nave')
  await window.keyboard.press('Control+k')
  const palette = window.getByRole('dialog', { name: 'Debug commands' })
  await expect(palette.getByTestId('segment-count')).toHaveText('Segments: 4')

  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})

test('launching with a file argument bypasses the library (FR-1)', async () => {
  // First launch: produce a real `.vitrum` on disk through the app itself.
  const { env, savePath } = isolated('library-arg')
  const first = await launch(env)
  await createPanel(first.window, 'Chapel lancet')
  await drawBorder(first.window)
  await first.window.keyboard.press('Control+s')
  await expect(first.window.getByLabel('Saved', { exact: true })).toBeVisible()
  await first.app.evaluate(({ app }) => app.exit(0)).catch(() => {})

  // Second launch, with that file as a command-line argument: straight into the editor.
  const second = await launch(isolated('library-arg2').env, [savePath])
  await expect(second.window.getByTestId('document-chip')).toContainText('Chapel lancet')
  await expect(second.window.getByRole('navigation', { name: 'Library sections' })).toBeHidden()
  // …and it really loaded the file, not a blank document.
  await second.window.keyboard.press('Control+k')
  await expect(
    second.window.getByRole('dialog', { name: 'Debug commands' }).getByTestId('segment-count'),
  ).toHaveText('Segments: 4')

  await second.app.evaluate(({ app }) => app.exit(0)).catch(() => {})
})
