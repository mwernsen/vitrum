import { line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { buildSnapScene, curveEndpoints, resolveSnap, type SnapScene } from './snap'
import { DEFAULT_SNAP_SETTINGS, SNAP_KINDS, type SnapKind, type SnapSettings } from './types'

/** Settings with only the named kinds enabled, so a single snap kind can be tested alone. */
function only(...kinds: SnapKind[]): SnapSettings {
  const toggles = Object.fromEntries(SNAP_KINDS.map((k) => [k, kinds.includes(k)])) as Record<
    SnapKind,
    boolean
  >
  return { ...DEFAULT_SNAP_SETTINGS, toggles }
}

function scene(...geoms: ReturnType<typeof line>[]): SnapScene {
  return buildSnapScene(geoms.map((geometry) => ({ geometry })))
}

const base = {
  radiusMm: 3,
  gridMm: 10,
  anchors: [] as ReturnType<typeof vec2>[],
}

describe('resolveSnap — per-kind resolution', () => {
  it('snaps to an endpoint and returns the node coordinate bit-identically (FR-1)', () => {
    const l = line(vec2(3.141592653589793, 2.718281828459045), vec2(100, 0))
    const hit = resolveSnap(scene(l), {
      ...base,
      world: vec2(3.5, 2.4),
      settings: only('endpoint'),
    })
    expect(hit?.kind).toBe('endpoint')
    // The exact stored Vec2 is returned — reference-identical, so a welded endpoint cannot be
    // an epsilon-close duplicate.
    expect(hit?.world).toBe(l.a)
    expect(hit?.world.x).toBe(l.a.x)
    expect(hit?.world.y).toBe(l.a.y)
  })

  it('snaps to a segment intersection', () => {
    const a = line(vec2(0, 0), vec2(10, 0))
    const b = line(vec2(4, -5), vec2(4, 5))
    const hit = resolveSnap(scene(a, b), {
      ...base,
      world: vec2(4.4, 0.3),
      settings: only('intersection'),
    })
    expect(hit?.kind).toBe('intersection')
    expect(hit?.world.x).toBeCloseTo(4, 9)
    expect(hit?.world.y).toBeCloseTo(0, 9)
  })

  it('snaps to a midpoint', () => {
    const l = line(vec2(0, 0), vec2(10, 0))
    const hit = resolveSnap(scene(l), { ...base, world: vec2(5, 0.4), settings: only('midpoint') })
    expect(hit?.kind).toBe('midpoint')
    expect(hit?.world.x).toBeCloseTo(5, 9)
    expect(hit?.world.y).toBeCloseTo(0, 9)
  })

  it('snaps to the nearest point on a curve', () => {
    const l = line(vec2(0, 0), vec2(10, 0))
    const hit = resolveSnap(scene(l), { ...base, world: vec2(3, 0.6), settings: only('on-curve') })
    expect(hit?.kind).toBe('on-curve')
    expect(hit?.world.x).toBeCloseTo(3, 9)
    expect(hit?.world.y).toBeCloseTo(0, 9)
  })

  it('snaps to the nearest grid node when within radius', () => {
    const hit = resolveSnap(scene(), { ...base, world: vec2(11, 9), settings: only('grid') })
    expect(hit?.kind).toBe('grid')
    expect(hit?.world.x).toBe(10)
    expect(hit?.world.y).toBe(10)
  })

  it('does not grid-snap when the nearest node is outside the radius', () => {
    const hit = resolveSnap(scene(), { ...base, world: vec2(5, 5), settings: only('grid') })
    expect(hit).toBeNull()
  })

  it('snaps onto a 0/45/90 ray from the last anchor (angle) with an overlay guide', () => {
    const hit = resolveSnap(scene(), {
      ...base,
      world: vec2(10, 0.5),
      anchors: [vec2(0, 0)],
      settings: only('angle'),
    })
    expect(hit?.kind).toBe('angle')
    expect(hit?.world.x).toBeCloseTo(10, 9)
    expect(hit?.world.y).toBeCloseTo(0, 9)
    expect(hit?.guides?.length).toBe(1)
  })
})

describe('resolveSnap — priority and master toggle (FR-2, FR-3)', () => {
  it('honours priority order over raw nearness: endpoint beats a nearer midpoint', () => {
    // Cursor sits exactly on the midpoint of `mid`, but an endpoint of `edge` is also in range.
    const mid = line(vec2(0, 0), vec2(4, 0)) // midpoint (2,0), right under the cursor
    const edge = line(vec2(2.3, 0.3), vec2(50, 50)) // endpoint (2.3,0.3), slightly off
    const hit = resolveSnap(scene(mid, edge), {
      ...base,
      radiusMm: 5,
      world: vec2(2, 0),
      settings: only('endpoint', 'midpoint'),
    })
    expect(hit?.kind).toBe('endpoint')
    expect(hit?.world).toBe(edge.a)
  })

  it('picks the nearest candidate within a kind', () => {
    const near = line(vec2(1, 0), vec2(1, 20)) // endpoint (1,0)
    const far = line(vec2(2.5, 0), vec2(2.5, 20)) // endpoint (2.5,0)
    const hit = resolveSnap(scene(near, far), {
      ...base,
      radiusMm: 5,
      world: vec2(0.5, 0),
      settings: only('endpoint'),
    })
    expect(hit?.world).toBe(near.a)
  })

  it('returns null when the master toggle is off (temporary disable)', () => {
    const l = line(vec2(0, 0), vec2(10, 0))
    const settings: SnapSettings = { ...only('endpoint'), master: false }
    expect(resolveSnap(scene(l), { ...base, world: vec2(0, 0), settings })).toBeNull()
  })

  it('returns null when nothing is in range', () => {
    const l = line(vec2(0, 0), vec2(10, 0))
    // Off any grid node (nearest is (510,510), ~7 mm away) and far from the line.
    const hit = resolveSnap(scene(l), {
      ...base,
      world: vec2(505, 505),
      settings: DEFAULT_SNAP_SETTINGS,
    })
    expect(hit).toBeNull()
  })
})

describe('resolveSnap — index-backed cost (FR-4)', () => {
  it('resolves quickly and correctly against a 5,000-segment scene', () => {
    const geoms: ReturnType<typeof line>[] = []
    const cols = 71
    for (let i = 0; i < 5000; i++) {
      const x = (i % cols) * 20
      const y = Math.floor(i / cols) * 20
      geoms.push(line(vec2(x, y), vec2(x + 20, y)))
    }
    const s = scene(...geoms)
    // A node exists at every (20·c, 20·r); snapping near one welds to it exactly.
    const start = Date.now()
    let hits = 0
    for (let i = 0; i < 2000; i++) {
      const hit = resolveSnap(s, {
        ...base,
        world: vec2(700.4, 700.3),
        settings: only('endpoint'),
      })
      if (hit) hits++
    }
    const elapsed = Date.now() - start
    expect(hits).toBe(2000)
    // Generous bound: 2,000 queries over 5,000 segments in well under a second proves the
    // per-query cost is local, not O(total).
    expect(elapsed).toBeLessThan(1000)
  })
})

describe('curveEndpoints', () => {
  it('returns a line’s stored endpoints by reference', () => {
    const l = line(vec2(1, 2), vec2(3, 4))
    const [a, b] = curveEndpoints(l)
    expect(a).toBe(l.a)
    expect(b).toBe(l.b)
  })
})
