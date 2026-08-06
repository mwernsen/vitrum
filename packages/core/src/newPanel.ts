import { toMillimetres, type LengthUnit } from './units'

/**
 * Validation for the new-panel dialog (F-058 FR-3). Pure and unit-aware: the form works in the
 * unit the user picked and this converts to the millimetres the document stores, so the dialog
 * itself holds no arithmetic. Lives in `core` (not `model`) because it is unit conversion — the
 * `NewPanelSpec` the caller assembles from the result is the model's own type.
 */

/** The raw dialog fields, as typed. Dimensions are strings so a partially typed value is valid input. */
export interface NewPanelForm {
  readonly name: string
  readonly width: string
  readonly height: string
  readonly units: LengthUnit
}

/** Per-field messages, in sentence case, keyed by the field they belong under. */
export interface NewPanelErrors {
  readonly name?: string
  readonly width?: string
  readonly height?: string
}

export interface NewPanelValidation {
  readonly ok: boolean
  readonly errors: NewPanelErrors
  /** The trimmed name, falling back to "Untitled panel" when the user left it blank. */
  readonly name: string
  /** The panel extent in millimetres. Zero when the corresponding field is invalid. */
  readonly widthMm: number
  readonly heightMm: number
}

/** The largest panel we accept, in mm — 10 m is far past any leaded light and catches typos. */
export const MAX_PANEL_MM = 10_000

/**
 * Check a new-panel form. A dimension must parse as a finite number, be strictly greater than zero,
 * and stay inside {@link MAX_PANEL_MM} once converted from the form's unit. The name is optional; a
 * blank one becomes "Untitled panel" rather than an error, because the panel is renamed at Save-As
 * anyway (Open question 1: Save-As decides).
 */
export function validateNewPanel(form: NewPanelForm): NewPanelValidation {
  const width = parseDimension(form.width, form.units)
  const height = parseDimension(form.height, form.units)
  const errors: NewPanelErrors = {
    ...(width.error ? { width: width.error } : {}),
    ...(height.error ? { height: height.error } : {}),
  }
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    name: form.name.trim() || 'Untitled panel',
    widthMm: width.mm,
    heightMm: height.mm,
  }
}

/**
 * Parse one dimension field into millimetres. Accepts a comma decimal separator, since a European
 * workshop types "40,5" as readily as "40.5".
 */
function parseDimension(raw: string, units: LengthUnit): { mm: number; error?: string } {
  const text = raw.trim().replace(',', '.')
  if (text === '') return { mm: 0, error: 'Enter a size' }
  const value = Number(text)
  if (!Number.isFinite(value)) return { mm: 0, error: 'Enter a number' }
  if (value <= 0) return { mm: 0, error: 'Must be greater than zero' }
  const mm = toMillimetres(value, units)
  if (mm > MAX_PANEL_MM) return { mm: 0, error: 'Too large for one panel' }
  return { mm }
}
