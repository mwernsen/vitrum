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
  const banner = window.getByRole('banner')

  // Wait for the renderer to show one or the other before deciding.
  await expect(rail.or(banner).first()).toBeVisible()

  if (await rail.isVisible()) {
    await window.getByRole('button', { name: 'New panel', exact: true }).click()
    const dialog = window.getByRole('dialog', { name: 'New panel' })
    await dialog.getByRole('button', { name: 'Create panel' }).click()
  }

  await expect(banner).toBeVisible()
  return window
}
