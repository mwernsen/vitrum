import Flatten from '@flatten-js/core'
import { Bezier } from 'bezier-js'

import { EPS } from './epsilon'
import type { Arc, CubicBezier, Line } from './types'
import type { Vec2 } from './vec2'

/**
 * Bridges between the kernel's plain-data primitives and the two vetted libraries we
 * wrap (F-010 open question 1, resolved "hybrid"): `@flatten-js/core` for
 * segment/arc/polygon robustness and a spatial index, `bezier-js` for Bézier
 * evaluation and subdivision intersection. Keep every reference to those libraries
 * behind this module so the rest of the kernel stays library-agnostic and our epsilon
 * strategy is the single source of truth.
 */

// Align flatten-js's internal comparison tolerance with ours (both are 1e-6 by
// default, but pin it so a library default change can't silently shift our results).
Flatten.Utils.setTolerance(EPS)

export type FlPoint = InstanceType<typeof Flatten.Point>
export type FlSegment = InstanceType<typeof Flatten.Segment>
export type FlArc = InstanceType<typeof Flatten.Arc>

export function fromFlPoint(p: FlPoint): Vec2 {
  return { x: p.x, y: p.y }
}

export function toFlSegment(l: Line): FlSegment {
  return Flatten.segment(l.a.x, l.a.y, l.b.x, l.b.y)
}

export function toFlArc(a: Arc): FlArc {
  return Flatten.arc(
    Flatten.point(a.center.x, a.center.y),
    a.radius,
    a.startAngle,
    a.endAngle,
    a.ccw,
  )
}

export function toBezier(c: CubicBezier): Bezier {
  return new Bezier(c.p0.x, c.p0.y, c.p1.x, c.p1.y, c.p2.x, c.p2.y, c.p3.x, c.p3.y)
}
