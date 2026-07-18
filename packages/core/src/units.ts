export type LengthUnit = 'mm' | 'in'

const MM_PER_INCH = 25.4

/** Convert a length in millimetres to the given display unit. */
export function convertLength(mm: number, unit: LengthUnit): number {
  return unit === 'in' ? mm / MM_PER_INCH : mm
}

/**
 * Format a millimetre length for display, e.g. `formatLength(300, 'mm')` →
 * `"300.0 mm"` and `formatLength(25.4, 'in')` → `"1.00 in"`. Inch values get an
 * extra decimal because an inch is a much coarser unit than a millimetre.
 */
export function formatLength(mm: number, unit: LengthUnit): string {
  const value = convertLength(mm, unit)
  const digits = unit === 'in' ? 2 : 1
  return `${value.toFixed(digits)} ${unit}`
}
