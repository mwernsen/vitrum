import { CSS_PX_PER_MM } from '@vitrum/core'

/**
 * Per-display physical-scale calibration for exact 1:1 zoom (F-003). A display's real
 * pixel density is rarely reported accurately, so we let the user match an on-screen
 * ruler to a physical reference (a credit card) and store the resulting CSS-px-per-mm
 * factor. It is keyed by a coarse display signature so an external monitor and a laptop
 * panel keep separate calibrations.
 *
 * Storage is `localStorage` (available in both the desktop renderer and `pnpm dev:ui`),
 * which keeps this concern inside `packages/ui` and Electron-free. A future revision can
 * promote it to a host-level settings port with an Electron `screen`-derived default.
 */
const KEY_PREFIX = 'vitrum:calibration:'

/** ISO/IEC 7810 ID-1 (credit/bank card) width — a reliable pocket reference. */
export const CREDIT_CARD_WIDTH_MM = 85.6

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** A coarse fingerprint of the current display, enough to tell distinct monitors apart. */
function displaySignature(): string {
  if (typeof window === 'undefined' || typeof window.screen === 'undefined') return 'default'
  const dpr = window.devicePixelRatio || 1
  return `${window.screen.width}x${window.screen.height}@${dpr}`
}

/** The reference scale when no calibration exists: the 96-dpi CSS assumption. */
export function defaultPxPerMm(): number {
  return CSS_PX_PER_MM
}

/** The saved factor for this display, or `null` if it was never calibrated. */
export function loadCalibration(): number | null {
  const store = safeLocalStorage()
  if (!store) return null
  const raw = store.getItem(KEY_PREFIX + displaySignature())
  if (raw === null) return null
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Persist the calibrated factor (CSS px per mm) for this display. */
export function saveCalibration(pxPerMm: number): void {
  if (!(Number.isFinite(pxPerMm) && pxPerMm > 0)) return
  safeLocalStorage()?.setItem(KEY_PREFIX + displaySignature(), String(pxPerMm))
}

/** Forget this display's calibration, reverting to the CSS-reference default. */
export function clearCalibration(): void {
  safeLocalStorage()?.removeItem(KEY_PREFIX + displaySignature())
}
