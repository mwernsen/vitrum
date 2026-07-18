export type LengthUnit = 'mm' | 'in'

const MM_PER_INCH = 25.4

/** Convert a length in millimetres to the given display unit. */
export function convertLength(mm: number, unit: LengthUnit): number {
  return unit === 'in' ? mm / MM_PER_INCH : mm
}

/** Options for {@link formatLength}. Defaults keep the plain decimal behaviour callers rely on. */
export interface LengthFormatOptions {
  /** Render inches as a reduced fraction (e.g. `3 5/8"`) instead of a decimal. Ignored for mm. */
  readonly fractional?: boolean
}

/**
 * Format a millimetre length for display, e.g. `formatLength(300, 'mm')` →
 * `"300.0 mm"` and `formatLength(25.4, 'in')` → `"1.00 in"`. Inch values get an
 * extra decimal because an inch is a much coarser unit than a millimetre. Pass
 * `{ fractional: true }` to render inches as a reduced fraction (`3 5/8"`).
 */
export function formatLength(mm: number, unit: LengthUnit, opts: LengthFormatOptions = {}): string {
  if (unit === 'in' && opts.fractional) return formatFractionalInch(mm)
  const value = convertLength(mm, unit)
  const digits = unit === 'in' ? 2 : 1
  return `${value.toFixed(digits)} ${unit}`
}

const greatestCommonDivisor = (a: number, b: number): number =>
  b === 0 ? a : greatestCommonDivisor(b, a % b)

/**
 * Format a millimetre length as a fractional inch, the workshop-native notation for
 * stained glass: whole inches plus a fraction reduced to lowest terms, rounded to the
 * nearest `1/denominator` inch. Examples with the default 1/32 resolution:
 * `92.075 → 3 5/8"`, `25.4 → 1"`, `1.5875 → 1/16"`, `0 → 0"`.
 *
 * `denominator` must be a power of two so the reduced fraction stays a binary fraction
 * (16ths, 8ths, …), which is how rulers and glass are actually graduated.
 */
export function formatFractionalInch(mm: number, denominator = 32): string {
  const sign = mm < 0 ? '-' : ''
  const inches = Math.abs(mm) / MM_PER_INCH

  // Round to the nearest 1/denominator, then split into whole + fractional parts,
  // carrying a full denominator up into the whole number (e.g. 32/32 → +1 inch).
  const ticks = Math.round(inches * denominator)
  const whole = Math.floor(ticks / denominator)
  let numerator = ticks - whole * denominator

  if (numerator === 0) return `${sign}${whole}"`

  const divisor = greatestCommonDivisor(numerator, denominator)
  numerator /= divisor
  const reducedDenominator = denominator / divisor

  const fraction = `${numerator}/${reducedDenominator}`
  return whole === 0 ? `${sign}${fraction}"` : `${sign}${whole} ${fraction}"`
}
