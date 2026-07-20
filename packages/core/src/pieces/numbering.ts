import { inscribedCircle, type Vec2 } from '@vitrum/geometry'

import { pieceKey } from './assignment'
import type { Piece, PieceId } from './types'

/**
 * Piece numbering (F-040): turning the detected pieces into a workshop **cartoon** where every
 * piece carries a stable number. Pure, framework-free domain logic — no DOM, no Svelte, no
 * `@vitrum/model` dependency (glass ids are opaque strings, the same discipline detection and glass
 * assignment follow). The UI persists the *result* on the document keyed by piece content id, and
 * resolves inheritance across edits with the shared {@link resolveGeneration} the way F-023 does.
 *
 * Three schemes are selectable per project:
 * - **grouped** (the default, Mathieu 2026-07-20): numbers encode the glass code implicitly —
 *   `A1..An, B1..`, the letter being the glass's code. Pieces are grouped by glass, then numbered
 *   in reading order within each group.
 * - **sequential**: a single row-major sweep, `1, 2, 3…`, ignoring glass.
 * - **manual**: no auto-assignment; only the per-piece overrides the user typed appear.
 *
 * Numbering only changes on an explicit renumber (workshop cartoons must not shuffle mid-build):
 * {@link renumber} is called by the "Renumber" command, never live. Manual overrides survive an
 * auto-renumber of the rest (FR-1).
 */

export type NumberingScheme = 'sequential' | 'grouped' | 'manual'

/** The glass code shown for a piece whose glass is unassigned — an unmistakable "needs glass". */
export const UNASSIGNED_CODE = '?'

/**
 * Where a piece's number is drawn and how big it can be: the **pole of inaccessibility** (the centre
 * of the largest inscribed circle), not the centroid — which for an L-shaped or annular piece can sit
 * outside the glass. `radius` (mm) is the inscribed radius, used to size the label and to decide when
 * a piece is too small to hold its label and needs a leader line (FR-2).
 */
export interface LabelPlacement {
  readonly at: Vec2
  readonly radius: number
}

/**
 * The label anchor for a piece: the pole of inaccessibility over its ring (holes respected), via the
 * geometry kernel's {@link inscribedCircle} (a port of Mapbox's `polylabel`). Deterministic and
 * bounded; the reported centre is always inside the piece, so a label centred there never lands on a
 * hole or outside an L-shape.
 */
export function labelPlacement(piece: Piece): LabelPlacement {
  const c = inscribedCircle(piece.ring, piece.holeRings)
  return { at: c.center, radius: c.radius }
}

/**
 * Order pieces in reading order — a row-major sweep, top-to-bottom then left-to-right (world y grows
 * downward, matching the screen). Rows are banded by the median piece height so a slightly staggered
 * row still reads as one row; ties break on the content id so the order is a deterministic function of
 * the input (FR-1 "deterministic orderings").
 */
export function rowMajorOrder(pieces: readonly Piece[]): Piece[] {
  if (pieces.length <= 1) return [...pieces]
  const heights = pieces
    .map((p) => p.bbox.max.y - p.bbox.min.y)
    .filter((h) => h > 0)
    .sort((a, b) => a - b)
  const rowHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)]! : 1
  const minY = Math.min(...pieces.map((p) => p.centroid.y))
  const rowOf = (p: Piece): number => Math.round((p.centroid.y - minY) / (rowHeight || 1))
  return [...pieces].sort((a, b) => {
    const ra = rowOf(a)
    const rb = rowOf(b)
    if (ra !== rb) return ra - rb
    if (a.centroid.x !== b.centroid.x) return a.centroid.x - b.centroid.x
    return pieceKey(a) < pieceKey(b) ? -1 : 1
  })
}

/** The i-th spreadsheet-style column code: 0→A … 25→Z, 26→AA, 27→AB … */
export function codeAt(i: number): string {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/**
 * Ensure every glass in use has a code, keeping the ones already assigned (codes are editable and
 * persist) and handing each new glass the next free letter. `usedGlassIds` is in first-appearance
 * (reading) order, so the first glass encountered becomes `A`, the next new one `B`, and so on.
 */
export function assignGlassCodes(
  usedGlassIds: readonly string[],
  existing: Readonly<Record<string, string>>,
): Record<string, string> {
  const codes: Record<string, string> = { ...existing }
  const taken = new Set(Object.values(codes))
  let next = 0
  const freeCode = (): string => {
    let code = codeAt(next)
    while (taken.has(code)) {
      next += 1
      code = codeAt(next)
    }
    return code
  }
  for (const id of usedGlassIds) {
    if (codes[id] !== undefined) continue
    const code = freeCode()
    codes[id] = code
    taken.add(code)
    next += 1
  }
  return codes
}

/** Everything {@link renumber} needs. Glass ids are opaque strings (core stays model-free). */
export interface RenumberInput {
  readonly pieces: readonly Piece[]
  readonly scheme: NumberingScheme
  /** Each piece's effective glass id (F-023), or undefined when unassigned. */
  readonly glassOf: (piece: Piece) => string | undefined
  /** Existing glass codes (kept and extended). Keyed by glass id. */
  readonly glassCodes: Readonly<Record<string, string>>
  /** Manual per-piece overrides, keyed by content id — excluded from the auto-sequence (FR-1). */
  readonly overrides: Readonly<Record<PieceId, string>>
}

/** The result of a renumber: fresh auto labels plus the (possibly extended) glass codes. */
export interface RenumberResult {
  /** `contentId → label` for every non-overridden piece. Overridden pieces are absent (they keep
   * their override). Empty for the `manual` scheme. */
  readonly auto: Record<PieceId, string>
  /** Glass codes after ensuring every in-use glass has one (unchanged for non-grouped schemes). */
  readonly glassCodes: Record<string, string>
}

/**
 * Compute a fresh numbering. Deterministic and human-sensible (FR-1): pieces are walked in reading
 * order; overridden pieces keep their manual label and are skipped in the auto-sequence; the
 * remaining pieces get `1,2,3…` (sequential) or `<code><n>` per glass group (grouped). Auto labels
 * that would collide with an existing override string are skipped, so no two labels coincide.
 */
export function renumber(input: RenumberInput): RenumberResult {
  const { pieces, scheme, glassOf, glassCodes: existing, overrides } = input
  const ordered = rowMajorOrder(pieces)

  // Glasses in use, in reading order — the order codes are handed out in.
  const usedOrder: string[] = []
  const seen = new Set<string>()
  for (const piece of ordered) {
    const g = glassOf(piece)
    if (g !== undefined && !seen.has(g)) {
      seen.add(g)
      usedOrder.push(g)
    }
  }
  const glassCodes = scheme === 'grouped' ? assignGlassCodes(usedOrder, existing) : { ...existing }

  const auto: Record<PieceId, string> = {}
  if (scheme === 'manual') return { auto, glassCodes }

  const overrideValues = new Set(Object.values(overrides))

  if (scheme === 'sequential') {
    let n = 1
    for (const piece of ordered) {
      const key = pieceKey(piece)
      if (overrides[key] !== undefined) continue
      let label = String(n)
      while (overrideValues.has(label)) {
        n += 1
        label = String(n)
      }
      auto[key] = label
      n += 1
    }
    return { auto, glassCodes }
  }

  // grouped: number within each glass group.
  const counters = new Map<string, number>()
  for (const piece of ordered) {
    const key = pieceKey(piece)
    if (overrides[key] !== undefined) continue
    const g = glassOf(piece)
    const code = (g !== undefined ? glassCodes[g] : undefined) ?? UNASSIGNED_CODE
    let n = (counters.get(code) ?? 0) + 1
    let label = `${code}${n}`
    while (overrideValues.has(label)) {
      n += 1
      label = `${code}${n}`
    }
    counters.set(code, n)
    auto[key] = label
  }
  return { auto, glassCodes }
}
