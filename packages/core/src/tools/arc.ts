import type { Vec2 } from '@vitrum/geometry'
import { EPS, arc, equals, line, vec2 } from '@vitrum/geometry'

import { constrainAngle, placeNumeric } from './constrain'
import type { DrawGeometry, DrawRole, PreviewShape, ToolDef, ToolInput, ToolStep } from './types'

/**
 * The arc tool (F-011): two construction modes, cycled by re-pressing `A`.
 * - `three-point`: click start, click end, then a point the arc passes through.
 * - `center`: click centre, click a start point (sets radius + start angle), click the
 *   end direction. The sweep takes the short way from start to end.
 *
 * Shift constrains the point being placed to 0/45/90° about its reference, and numeric
 * entry places it a typed length/angle away (FR-3). Every completed arc is one command.
 */
export type ArcMode = 'three-point' | 'center'

export interface ArcState {
  readonly mode: ArcMode
  /** Clicks placed so far (max 2; the third click commits). World mm. */
  readonly points: readonly Vec2[]
  readonly cursor: Vec2 | null
}

const INITIAL: ArcState = { mode: 'three-point', points: [], cursor: null }

/** The point new placements are measured/constrained against, given the clicks so far. */
function reference(state: ArcState): Vec2 | null {
  if (state.points.length === 0) return null
  return state.mode === 'center' ? state.points[0]! : state.points.at(-1)!
}

function constrained(state: ArcState, at: Vec2, shift: boolean): Vec2 {
  const ref = reference(state)
  return shift && ref ? constrainAngle(ref, at) : at
}

/** Circumcircle centre of three points, or `null` when they are collinear. */
export function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < EPS) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  return vec2(ux, uy)
}

/** An arc through three points, or a straight line when they are (near-)collinear. */
export function arcThroughPoints(start: Vec2, through: Vec2, end: Vec2): DrawGeometry {
  const center = circumcenter(start, through, end)
  if (!center) return line(start, end)
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
  // Orientation of the three points chooses the sweep direction so `through` lies on it.
  const cross =
    (through.x - start.x) * (end.y - start.y) - (through.y - start.y) * (end.x - start.x)
  return arc(center, radius, startAngle, endAngle, cross > 0)
}

/** An arc from `start` around `center`, sweeping the short way toward `end`'s direction. */
export function arcFromCenter(center: Vec2, start: Vec2, end: Vec2): DrawGeometry | null {
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  if (radius < EPS) return null
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
  if (Math.abs(startAngle - endAngle) < EPS) return null
  const cross =
    (start.x - center.x) * (end.y - center.y) - (start.y - center.y) * (end.x - center.x)
  return arc(center, radius, startAngle, endAngle, cross > 0)
}

/** Build the arc from three placed reference points, per the active mode. */
function build(mode: ArcMode, pts: readonly Vec2[]): DrawGeometry | null {
  const [p0, p1, p2] = pts
  if (!p0 || !p1 || !p2) return null
  return mode === 'three-point' ? arcThroughPoints(p0, p2, p1) : arcFromCenter(p0, p1, p2)
}

function commitFrom(state: ArcState, third: Vec2): ToolStep<ArcState> {
  const geometry = build(state.mode, [...state.points, third])
  const reset: ArcState = { ...INITIAL, mode: state.mode }
  if (!geometry) return { state: reset }
  return { state: reset, commit: [{ geometry, role: 'lead' satisfies DrawRole }] }
}

export const arcTool: ToolDef<ArcState> = {
  id: 'arc',
  role: 'lead',
  initial: INITIAL,

  reduce(state, input: ToolInput): ToolStep<ArcState> {
    switch (input.type) {
      case 'down': {
        const at = constrained(state, input.at, input.shift ?? false)
        if (state.points.length === 2) return commitFrom(state, at)
        return { state: { ...state, points: [...state.points, at], cursor: at } }
      }
      case 'move':
        return { state: { ...state, cursor: constrained(state, input.at, input.shift ?? false) } }
      case 'numeric': {
        const ref = reference(state)
        if (!ref) return { state } // Need a first click (start/centre) before a value.
        const at = placeNumeric(ref, input.value, state.cursor, input.shift ?? false)
        if (state.points.length === 2) return commitFrom(state, at)
        return { state: { ...state, points: [...state.points, at], cursor: at } }
      }
      case 'enter':
        // Commit early using the live cursor as the final point, if two are placed.
        if (state.points.length === 2 && state.cursor) return commitFrom(state, state.cursor)
        return { state: { ...INITIAL, mode: state.mode } }
      case 'escape':
        return { state: { ...INITIAL, mode: state.mode } }
      case 'up':
        return { state }
    }
  },

  preview(state, hover): readonly PreviewShape[] {
    const shapes: PreviewShape[] = []
    const tip = state.cursor ?? hover
    const pts = state.points
    for (const p of pts) shapes.push({ kind: 'point', at: p })
    if (!tip) return shapes

    if (pts.length === 1) {
      // Radius / chord guide line to the cursor.
      if (!equals(pts[0]!, tip)) {
        shapes.push({ kind: 'segment', geometry: line(pts[0]!, tip), role: 'lead', ghost: true })
      }
    } else if (pts.length === 2) {
      const geometry = build(state.mode, [pts[0]!, pts[1]!, tip])
      if (geometry) shapes.push({ kind: 'segment', geometry, role: 'lead', ghost: true })
    }
    return shapes
  },

  isActive(state): boolean {
    return state.points.length > 0
  },

  anchors(state): readonly Vec2[] {
    return state.points
  },

  cycleMode(state): ArcState {
    const mode: ArcMode = state.mode === 'three-point' ? 'center' : 'three-point'
    return { ...INITIAL, mode }
  },

  hint(state): string {
    return state.mode === 'three-point' ? 'arc: 3-point' : 'arc: centre'
  },
}
