import { expect, type ElectronApplication, type Page } from '@playwright/test'

/**
 * The app's window, already in the editor.
 *
 * F-058 makes the launch screen the startup state, so every spec *about the editor* has to walk past
 * it. On a first run the library is empty, so the new-panel dialog is the only route in — which is
 * exactly what the design intends: there is nothing to resume yet. Its defaults (300 × 400 mm, lead
 * came) match the panel the editor used to boot with, so specs downstream see what they always saw.
 *
 * Idempotent, and safe on a build that opens straight into the editor: it waits for whichever of the
 * two surfaces appears and only clicks through if it is the library.
 */
export async function editorWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow()
  const rail = window.getByRole('navigation', { name: 'Library sections' })
  // "Am I in the editor?" is the view switcher, not `getByRole('banner')`. Three elements carry the
  // banner role — the cockpit top bar, the launch screen's top bar, and any open dialog's header —
  // and none has an accessible name, so a banner query is ambiguous the moment two are on screen.
  // Under strict mode that ambiguity fails *immediately* rather than retrying, which turned a slow
  // "Create panel" click into a hard error instead of a wait. The view tablist exists only in the
  // cockpit.
  const editor = window.getByRole('tablist', { name: 'View mode' })

  // Wait for the renderer to show one or the other before deciding.
  await expect(rail.or(editor).first()).toBeVisible()

  if (await rail.isVisible()) {
    await window.getByRole('button', { name: 'New panel', exact: true }).click()
    const dialog = window.getByRole('dialog', { name: 'New panel' })
    await dialog.getByRole('button', { name: 'Create panel' }).click()
    // Settle before asserting: while the dialog is up its header is a second banner, and the
    // document is only swapped in once it closes.
    await expect(dialog).toBeHidden()
  }

  await expect(editor).toBeVisible()
  return window
}
