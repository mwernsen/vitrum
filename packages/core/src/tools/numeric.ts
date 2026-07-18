import { toMillimetres, type LengthUnit } from '../units'

import type { NumericValue } from './types'

/** Characters a numeric-entry buffer may contain (digits, sign, point, separators). */
const NUMERIC_CHAR = /[0-9.,\-\s]/

/** True if `char` can extend a numeric-entry buffer — the UI uses this to route keys. */
export function isNumericChar(char: string): boolean {
  return char.length === 1 && NUMERIC_CHAR.test(char)
}

/**
 * Parse a KiCad-style numeric-entry buffer into a {@link NumericValue}. The first field
 * is a length in the current display `unit` (converted to mm so tools stay unit-agnostic
 * and FR-2 holds); an optional second field, after a comma or space, is an absolute angle
 * in degrees. Returns `null` when nothing parses (an empty or malformed buffer), so the
 * caller can fall back to finishing the gesture. Examples (mm): `"120"` → `{length:120}`,
 * `"120, 30"` → `{length:120, angle:30}`, `"@45"`/`",45"` → `{angle:45}`.
 */
export function parseNumericEntry(buffer: string, unit: LengthUnit): NumericValue | null {
  const trimmed = buffer.trim().replace(/^@/, ',')
  if (trimmed === '') return null

  const [lengthField, angleField] = trimmed.split(/[,\s]+/, 2)
  const value: { length?: number; angle?: number } = {}

  if (lengthField !== undefined && lengthField !== '') {
    const n = Number(lengthField)
    if (!Number.isFinite(n)) return null
    value.length = toMillimetres(n, unit)
  }
  if (angleField !== undefined && angleField !== '') {
    const n = Number(angleField)
    if (!Number.isFinite(n)) return null
    value.angle = n
  }

  return value.length === undefined && value.angle === undefined ? null : value
}
