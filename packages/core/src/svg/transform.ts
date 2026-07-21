import { compose, IDENTITY, rotation, scaling, translation, type Transform2D } from '@vitrum/geometry'

/**
 * Parse an SVG `transform` attribute into one composed affine matrix (F-050). SVG transforms
 * compose **left-to-right** in the writing order — `transform="translate(10) rotate(30)"` applies
 * `rotate` to a point first, then `translate` — which is exactly {@link compose}'s convention
 * (`compose(A, B)` applies B first). Nesting is handled by the caller composing the parent CTM with
 * each child's local transform, so the full stack collapses to a single matrix per element (Scope).
 *
 * Supports the SVG transform functions `matrix`, `translate`, `scale`, `rotate`, `skewX`, `skewY`.
 * Angles are in degrees (SVG convention). An unrecognised function or malformed argument list yields
 * the identity for that term rather than throwing, so one odd attribute never fails a whole import.
 */
export function parseTransform(attr: string | undefined): Transform2D {
  if (!attr) return IDENTITY
  const terms: Transform2D[] = []
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attr)) !== null) {
    terms.push(term(m[1]!, numbers(m[2]!)))
  }
  return terms.length === 0 ? IDENTITY : compose(...terms)
}

const DEG = Math.PI / 180

function term(fn: string, a: readonly number[]): Transform2D {
  switch (fn) {
    case 'matrix':
      return a.length >= 6
        ? { a: a[0]!, b: a[1]!, c: a[2]!, d: a[3]!, e: a[4]!, f: a[5]! }
        : IDENTITY
    case 'translate':
      return translation(a[0] ?? 0, a[1] ?? 0)
    case 'scale':
      return scaling(a[0] ?? 1, a[1] ?? a[0] ?? 1)
    case 'rotate':
      return a.length >= 3
        ? rotation((a[0] ?? 0) * DEG, { x: a[1]!, y: a[2]! })
        : rotation((a[0] ?? 0) * DEG)
    case 'skewx':
      return { a: 1, b: 0, c: Math.tan((a[0] ?? 0) * DEG), d: 1, e: 0, f: 0 }
    case 'skewy':
      return { a: 1, b: Math.tan((a[0] ?? 0) * DEG), c: 0, d: 1, e: 0, f: 0 }
    default:
      return IDENTITY
  }
}

/** Parse the comma/space-separated numeric argument list of a transform function. */
function numbers(list: string): number[] {
  const out: number[] = []
  const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(list)) !== null) out.push(Number(m[0]))
  return out
}
