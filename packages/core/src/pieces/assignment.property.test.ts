import { line, vec2 } from '@vitrum/geometry'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { pieceKey, resolveGeneration } from './assignment'
import { PieceDetector } from './detect'
import type { PieceId, PieceSegment } from './types'

/**
 * The document is the single source of truth for a piece's glass (F-023, fix of 2026-08-16). Whatever
 * sequence of paints, unassigns and geometry edits a session goes through, resolution may only show a
 * value the document currently stores — inheritance carries *which* entry a surviving piece reads,
 * never a value of its own. Two invariants say it:
 *
 * - **Sound**: every resolved value is one the document stores right now.
 * - **Empty**: with no stored assignments nothing is coloured, so a removal is never inherited back.
 */

const SQUARE = { n0: vec2(0, 0), n1: vec2(100, 0), n2: vec2(100, 100), n3: vec2(0, 100) }
const EDGES: Array<[keyof typeof SQUARE, keyof typeof SQUARE]> = [
  ['n0', 'n1'],
  ['n1', 'n2'],
  ['n2', 'n3'],
  ['n3', 'n0'],
]

/** The panel border, optionally reshaped (a corner nudged) and optionally split by dividers. */
function network(nudge: number, dividers: readonly number[]): PieceSegment[] {
  const nodes = { ...SQUARE, n2: vec2(100 + nudge, 100) }
  const segs: PieceSegment[] = EDGES.map(([a, b], i) => ({
    id: `s${i}`,
    geometry: line(nodes[a], nodes[b]),
    role: 'lead',
    endpoints: [a, b] as const,
  }))
  for (const x of dividers) {
    segs.push({
      id: `d${x}`,
      geometry: line(vec2(x, 0), vec2(x, 100)),
      role: 'lead',
      endpoints: [`d${x}a`, `d${x}b`],
    })
  }
  return segs
}

/** One user step: paint or clear a piece (by index), clear everything, or change the geometry. */
type Step =
  | { kind: 'paint'; at: number; glass: string }
  | { kind: 'clear'; at: number }
  | { kind: 'clearAll' }
  | { kind: 'divider'; x: number }
  | { kind: 'nudge'; by: number }

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant<'paint'>('paint'),
    at: fc.nat({ max: 5 }),
    glass: fc.constantFrom('amber', 'ruby', 'cobalt'),
  }),
  fc.record({ kind: fc.constant<'clear'>('clear'), at: fc.nat({ max: 5 }) }),
  fc.record({ kind: fc.constant<'clearAll'>('clearAll') }),
  fc.record({ kind: fc.constant<'divider'>('divider'), x: fc.integer({ min: 10, max: 90 }) }),
  fc.record({ kind: fc.constant<'nudge'>('nudge'), by: fc.integer({ min: -20, max: 20 }) }),
)

describe('resolveGeneration invariants (F-023)', () => {
  it('never shows a value the document does not store', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 12 }), (steps) => {
        const detector = new PieceDetector()
        let dividers: number[] = []
        let nudge = 0
        let stored: Record<PieceId, string> = {}
        let origins: ReadonlyMap<PieceId, PieceId> = new Map()

        /** One generation, as the shell resolves it after every document change. */
        const generation = (): PieceId[] => {
          const gen = detector.update(network(nudge, dividers))
          const resolved = resolveGeneration(gen.pieces, gen.lineage, stored, origins)
          origins = resolved.origins

          const values = Object.values(stored)
          for (const value of resolved.effective.values()) expect(values).toContain(value)
          if (values.length === 0) expect(resolved.effective.size).toBe(0)
          return gen.pieces.map(pieceKey)
        }

        for (const s of steps) {
          const keys = generation()
          if (s.kind === 'paint' && keys.length > 0) {
            stored = { ...stored, [keys[s.at % keys.length]!]: s.glass }
          } else if (s.kind === 'clear' && keys.length > 0) {
            stored = { ...stored }
            delete stored[keys[s.at % keys.length]!]
          } else if (s.kind === 'clearAll') {
            stored = {}
          } else if (s.kind === 'divider') {
            dividers = dividers.includes(s.x)
              ? dividers.filter((x) => x !== s.x)
              : [...dividers, s.x]
          } else if (s.kind === 'nudge') {
            nudge = s.by
          }
        }
        generation() // the state the last step leaves the panel in
      }),
      { numRuns: 200 },
    )
  })
})
