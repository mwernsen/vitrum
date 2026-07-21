/**
 * Deterministic number formatting for text-based exports (F-043 FR-4). SVG and DXF are plain text,
 * so byte-identical output for the same document just requires that every number is rendered the
 * same way every time: round to a fixed number of decimals, drop trailing zeros, and normalise
 * negative zero to `0`. Centralised here so SVG and DXF agree and the determinism tests have one
 * place to point at.
 */

/** Format a coordinate/length with up to `decimals` fractional digits, trailing zeros trimmed. */
export function fmt(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Number(value.toFixed(decimals))
  const normalised = Object.is(rounded, -0) ? 0 : rounded
  return normalised.toString()
}
