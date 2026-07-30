import type { Locator, Page } from '@playwright/test'

/**
 * Read one of the four "ready to cut" steps (F-020/023/030/040).
 *
 * Cockpit v2 collapsed the 44px readiness strip into a single segmented meter in the top bar, so the
 * per-step detail lives in its popover rather than in always-visible pills. This opens the popover
 * (idempotent — clicking the trigger while open would close it) and returns the row, so a spec can
 * assert on its text the way it used to assert on a pill.
 */
export async function readinessRow(
  window: Page,
  title: 'Geometry closes' | 'Every piece has glass' | 'Checks are clear' | 'Pieces are numbered',
): Promise<Locator> {
  const popover = window.getByRole('dialog', { name: 'Ready to cut' })
  if (!(await popover.isVisible())) await window.getByTestId('readiness-meter').click()
  return popover.getByRole('button').filter({ hasText: title })
}

/** Dismiss the readiness popover, so it stops covering the canvas. */
export async function closeReadiness(window: Page): Promise<void> {
  const popover = window.getByRole('dialog', { name: 'Ready to cut' })
  if (await popover.isVisible()) await window.keyboard.press('Escape')
}
