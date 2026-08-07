import { arc, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { healNetwork, type HealSegment } from './heal'
import { countPieces } from './import'

let counter = 0
function seg(geometry: HealSegment['geometry']): HealSegment {
  return { id: `s${counter++}`, geometry, role: 'lead' }
}

/** Four exactly-welded lines forming a clean unit square. */
function cleanSquare(): HealSegment[] {
  counter = 0
  return [
    seg(line(vec2(0, 0), vec2(100, 0))),
    seg(line(vec2(100, 0), vec2(100, 100))),
    seg(line(vec2(100, 100), vec2(0, 100))),
    seg(line(vec2(0, 100), vec2(0, 0))),
  ]
}

describe('healNetwork — no-op guarantee (FR-4)', () => {
  it('returns a clean network unchanged at tolerance 0', () => {
    const input = cleanSquare()
    const { segments, summary, changedIds } = healNetwork(input, 0)
    expect(segments).toHaveLength(4)
    expect(summary).toEqual({ snapped: 0, split: 0, dropped: 0 })
    expect(changedIds.size).toBe(0)
    expect(countPieces(segments)).toBe(1)
  })
})

describe('healNetwork — snap near-coincident endpoints', () => {
  it('welds corners that miss by less than the tolerance so the square closes', () => {
    counter = 0
    // A square whose corners each miss by 0.3 mm — piece detection finds nothing raw.
    const input = [
      seg(line(vec2(0, 0), vec2(100, 0))),
      seg(line(vec2(100.2, 0.1), vec2(100, 100))),
      seg(line(vec2(100.1, 100.2), vec2(0, 100))),
      seg(line(vec2(0.2, 100.1), vec2(0.1, 0.2))),
    ]
    expect(countPieces(input)).toBe(0)
    const healed = healNetwork(input, 0.5)
    expect(healed.summary.snapped).toBeGreaterThan(0)
    expect(countPieces(healed.segments)).toBe(1)
  })
})

describe('healNetwork — split at crossings', () => {
  it('splits an X of two crossing lines into four spans', () => {
    counter = 0
    const input = [seg(line(vec2(-10, 0), vec2(10, 0))), seg(line(vec2(0, -10), vec2(0, 10)))]
    const healed = healNetwork(input, 0.1)
    expect(healed.segments).toHaveLength(4)
    expect(healed.summary.split).toBe(2)
  })
})

describe('healNetwork — drop degenerate + duplicate segments', () => {
  it('drops a zero-length segment', () => {
    counter = 0
    const input = [seg(line(vec2(5, 5), vec2(5, 5))), seg(line(vec2(0, 0), vec2(10, 0)))]
    const healed = healNetwork(input, 0.01)
    expect(healed.segments).toHaveLength(1)
    expect(healed.summary.dropped).toBe(1)
  })

  it('drops a duplicate (including a reversed one)', () => {
    counter = 0
    const input = [
      seg(line(vec2(0, 0), vec2(10, 0))),
      seg(line(vec2(10, 0), vec2(0, 0))), // reversed duplicate
    ]
    const healed = healNetwork(input, 0.01)
    expect(healed.segments).toHaveLength(1)
    expect(healed.summary.dropped).toBe(1)
  })
})

describe('healNetwork — T-junction (endpoint onto a nearby curve)', () => {
  it('snaps a dangling end onto a nearby line and splits it', () => {
    counter = 0
    // A closed square plus an interior wall whose top end stops 0.3 mm short of the top edge.
    const input = [
      seg(line(vec2(0, 0), vec2(100, 0))), // bottom
      seg(line(vec2(100, 0), vec2(100, 100))),
      seg(line(vec2(100, 100), vec2(0, 100))), // top
      seg(line(vec2(0, 100), vec2(0, 0))),
      seg(line(vec2(50, 0), vec2(50, 99.7))), // interior wall, short of the top
    ]
    const healed = healNetwork(input, 0.5)
    // The top edge is split by the wall's endpoint → the square divides into two pieces.
    expect(countPieces(healed.segments)).toBe(2)
  })
})

describe('healNetwork — arcs', () => {
  it('keeps an arc intact when its endpoints do not move', () => {
    counter = 0
    const input = [seg(arc(vec2(0, 0), 20, 0, Math.PI / 2, true))]
    const healed = healNetwork(input, 0.5)
    expect(healed.segments).toHaveLength(1)
    expect(healed.segments[0]!.geometry.kind).toBe('arc')
  })
})

describe('healNetwork — idempotence on curved fixtures (FR-4)', () => {
  function assertIdempotent(input: HealSegment[], tol: number): void {
    const once = healNetwork(input, tol)
    const twice = healNetwork(
      once.segments.map((s) => ({ id: s.id, geometry: s.geometry, role: s.role })),
      tol,
    )
    expect(twice.summary).toEqual({ snapped: 0, split: 0, dropped: 0 })
    expect(twice.segments).toHaveLength(once.segments.length)
    // A settled network reports nothing changed. `changedIds` compares by id, so it only settles if
    // ids are unique — duplicates leave a twin permanently "changed" (see the regression below).
    expect(twice.changedIds.size).toBe(0)
    for (const result of [once, twice]) {
      const ids = result.segments.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  }

  it('a full circle inside a square is a fixed point', () => {
    counter = 0
    assertIdempotent(
      [
        seg(line(vec2(0, 0), vec2(100, 0))),
        seg(line(vec2(100, 0), vec2(100, 100))),
        seg(line(vec2(100, 100), vec2(0, 100))),
        seg(line(vec2(0, 100), vec2(0, 0))),
        seg(arc(vec2(50, 50), 20, 0, Math.PI * 2, true)),
      ],
      0.5,
    )
  })

  it('an arched top (line + arc) with near-miss joints is a fixed point', () => {
    counter = 0
    assertIdempotent(
      [
        seg(line(vec2(0, 0), vec2(0, 50))),
        seg(arc(vec2(50, 50), 50, Math.PI, 0, false)),
        seg(line(vec2(100.2, 50.1), vec2(100, 0))),
        seg(line(vec2(100, 0), vec2(0.1, -0.1))),
      ],
      0.5,
    )
  })
})

describe('healNetwork — messy fixture (FR-2)', () => {
  it('heals near-misses, a stray crossing and a duplicate to the apparent regions', () => {
    counter = 0
    const input = [
      // Square with near-miss corners.
      seg(line(vec2(0, 0), vec2(100, 0.15))),
      seg(line(vec2(100.1, 0), vec2(100, 100))),
      seg(line(vec2(100, 100.1), vec2(-0.1, 100))),
      seg(line(vec2(0, 100.1), vec2(0.1, -0.1))),
      // A duplicate of the bottom edge.
      seg(line(vec2(0, 0), vec2(100, 0.15))),
      // An interior diagonal splitting the square into two triangles, corners near the square's.
      seg(line(vec2(0.2, 0.1), vec2(99.9, 100.2))),
    ]
    const healed = healNetwork(input, 0.5)
    expect(healed.summary.dropped).toBeGreaterThan(0)
    expect(countPieces(healed.segments)).toBe(2)
  })
})

describe('healNetwork — offcut ids stay unique across passes (FR-4 regression)', () => {
  /**
   * Found by the FR-4 property test, which failed on roughly one run in three until this was fixed.
   *
   * These three crossing lines plus a degenerate one need several passes to settle. The first piece
   * of a split keeps its parent's id, so a segment that already survived one split gets split again
   * on a later pass — and naming its offcut positionally (`${id}~1`) reissued an id an earlier pass
   * had already given to a different, still-present segment. `changedIds` compares by id, so the
   * mismatched twin was reported as changed on every subsequent pass and the network never read as
   * settled, even though its geometry had stopped moving.
   */
  const counterexample = (): HealSegment[] => {
    counter = 0
    return [
      seg(line(vec2(40, 0), vec2(0, -80))),
      seg(line(vec2(-10, -90), vec2(100, 30))),
      seg(line(vec2(50, -10), vec2(-20, -110))),
      seg(line(vec2(0, 0), vec2(0, 0))), // degenerate — dropped, but it shifts the pass sequence
    ]
  }

  it('issues no duplicate ids and settles on the second pass', () => {
    const once = healNetwork(counterexample(), 2)
    const ids = once.segments.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)

    const twice = healNetwork(
      once.segments.map((s) => ({ id: s.id, geometry: s.geometry, role: s.role })),
      2,
    )
    expect(twice.summary).toEqual({ snapped: 0, split: 0, dropped: 0 })
    expect(twice.changedIds.size).toBe(0)
  })
})
