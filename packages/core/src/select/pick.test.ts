import { arc, cubic, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { buildPickScene, pickNode, pickSegment, pickSegments, type PickTarget } from './pick'

const targets: PickTarget[] = [
  { id: 'h', geometry: line(vec2(0, 0), vec2(100, 0)) }, // horizontal
  { id: 'v', geometry: line(vec2(50, -50), vec2(50, 50)) }, // vertical, crosses h at (50,0)
  { id: 'bez', geometry: cubic(vec2(0, 100), vec2(30, 160), vec2(70, 160), vec2(100, 100)) },
  { id: 'arc', geometry: arc(vec2(200, 0), 40, 0, Math.PI, true) }, // bulges up to y=40
]

describe('pickSegment (FR-2: true curve distance, not bbox)', () => {
  const scene = buildPickScene(targets)

  it('picks a segment when the cursor is within tolerance of the curve', () => {
    const hit = pickSegment(scene, vec2(25, 1), 3)
    expect(hit?.id).toBe('h')
    expect(hit!.distance).toBeCloseTo(1)
  })

  it('does NOT pick a curve whose bbox contains the cursor but whose path is far away', () => {
    // The bézier's bbox spans y∈[100,160]; the point (50,105) is inside the bbox but the
    // curve near x=50 sits at ~y=145, ~40 mm away — a bbox test would wrongly select it.
    const hit = pickSegment(scene, vec2(50, 105), 5)
    expect(hit).toBeNull()
  })

  it('does not pick the arc from inside its chord region (bbox contains, curve far)', () => {
    // (200, 5) is under the arc; the arc passes through (200, 40) at its apex and (160/240, 0)
    // at its ends — near x=200 the nearest arc point is the apex ~35 mm away.
    expect(pickSegment(scene, vec2(200, 5), 5)).toBeNull()
    // On the arc apex it hits.
    expect(pickSegment(scene, vec2(200, 40), 2)?.id).toBe('arc')
  })

  it('returns overlapping candidates nearest-first so clicks can cycle', () => {
    // Near the h/v crossing at (50,0): both lines are within tolerance.
    const hits = pickSegments(scene, vec2(50, 0.3), 3)
    expect(hits.map((h) => h.id).sort()).toEqual(['h', 'v'])
    // Nearest first: v passes exactly through (50,0.3) region → distance ~0 to v? both ~0.3/0.
    expect(hits[0]!.distance).toBeLessThanOrEqual(hits[1]!.distance)
  })

  it('returns nothing when the cursor is beyond tolerance of every curve', () => {
    expect(pickSegments(scene, vec2(25, 20), 3)).toEqual([])
  })
})

describe('pickNode', () => {
  const nodes = [
    { id: 'a', pos: vec2(0, 0) },
    { id: 'b', pos: vec2(100, 0) },
  ]
  it('picks the nearest node within tolerance', () => {
    expect(pickNode(nodes, vec2(2, 2), 5)?.id).toBe('a')
    expect(pickNode(nodes, vec2(98, 1), 5)?.id).toBe('b')
  })
  it('returns null beyond tolerance', () => {
    expect(pickNode(nodes, vec2(50, 50), 5)).toBeNull()
  })
})
