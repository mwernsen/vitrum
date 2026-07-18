import type { Vec2 } from '@vitrum/geometry'
import { add, cubic, equals, negate, sub, vec2 } from '@vitrum/geometry'

import type { DrawRole, PreviewShape, SegmentDraft, ToolDef, ToolInput, ToolStep } from './types'

/**
 * The bézier pen tool (F-011): Illustrator-style click-drag input. Clicking places a
 * corner (straight) anchor; click-dragging places a smooth anchor whose symmetric handles
 * follow the drag, giving tangent continuity across the join by default. Holding Alt while
 * placing an anchor breaks the tangent (a cusp: the incoming side arrives straight). The
 * whole path commits as one command of cubic segments (a plain click-click span is a
 * straight cubic, so it still welds cleanly for piece detection).
 */
export interface BezierAnchor {
  readonly point: Vec2
  /** Outgoing handle vector (toward the next anchor). Zero for a plain click. */
  readonly out: Vec2
  /** True ⇒ a cusp: the incoming handle is not the mirror of `out`. */
  readonly corner: boolean
}

interface Drag {
  readonly point: Vec2
  readonly handle: Vec2
  readonly corner: boolean
}

export interface BezierState {
  readonly anchors: readonly BezierAnchor[]
  readonly drag: Drag | null
  readonly cursor: Vec2 | null
}

const ZERO = vec2(0, 0)
const INITIAL: BezierState = { anchors: [], drag: null, cursor: null }

/** Incoming handle vector of an anchor: mirror of `out`, or zero at a cusp. */
function inHandle(anchor: BezierAnchor): Vec2 {
  return anchor.corner ? ZERO : negate(anchor.out)
}

/** The cubic joining two consecutive anchors. A straight span degenerates to a line-cubic. */
function spanCubic(a: BezierAnchor, b: BezierAnchor) {
  return cubic(a.point, add(a.point, a.out), add(b.point, inHandle(b)), b.point)
}

function toDrafts(anchors: readonly BezierAnchor[]): SegmentDraft[] {
  const drafts: SegmentDraft[] = []
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!
    const b = anchors[i + 1]!
    if (equals(a.point, b.point)) continue
    drafts.push({ geometry: spanCubic(a, b), role: 'lead' satisfies DrawRole })
  }
  return drafts
}

export const bezierTool: ToolDef<BezierState> = {
  id: 'bezier',
  role: 'lead',
  initial: INITIAL,

  reduce(state, input: ToolInput): ToolStep<BezierState> {
    switch (input.type) {
      case 'down':
        return {
          state: {
            ...state,
            drag: { point: input.at, handle: ZERO, corner: input.alt ?? false },
            cursor: input.at,
          },
        }
      case 'move':
        if (state.drag) {
          return {
            state: { ...state, drag: { ...state.drag, handle: sub(input.at, state.drag.point) } },
          }
        }
        return { state: { ...state, cursor: input.at } }
      case 'up': {
        if (!state.drag) return { state }
        const anchor: BezierAnchor = {
          point: state.drag.point,
          out: state.drag.handle,
          corner: state.drag.corner,
        }
        return { state: { anchors: [...state.anchors, anchor], drag: null, cursor: input.at } }
      }
      case 'enter': {
        const anchors = state.drag
          ? [
              ...state.anchors,
              { point: state.drag.point, out: state.drag.handle, corner: state.drag.corner },
            ]
          : state.anchors
        const drafts = toDrafts(anchors)
        if (drafts.length === 0) return { state: INITIAL }
        return { state: INITIAL, commit: drafts }
      }
      case 'escape':
        return { state: INITIAL }
      case 'numeric':
        return { state }
    }
  },

  preview(state, hover): readonly PreviewShape[] {
    const shapes: PreviewShape[] = []
    // The path placed so far.
    for (let i = 0; i < state.anchors.length - 1; i++) {
      shapes.push({
        kind: 'segment',
        geometry: spanCubic(state.anchors[i]!, state.anchors[i + 1]!),
        role: 'lead',
      })
    }

    const live = state.drag
      ? { point: state.drag.point, out: state.drag.handle, corner: state.drag.corner }
      : null
    const last = state.anchors.at(-1)

    if (live) {
      // The span into the anchor being dragged, plus its handle guide.
      if (last)
        shapes.push({ kind: 'segment', geometry: spanCubic(last, live), role: 'lead', ghost: true })
      if (!equals(live.out, ZERO)) {
        shapes.push({
          kind: 'segment',
          geometry: { kind: 'line', a: sub(live.point, live.out), b: add(live.point, live.out) },
          role: 'construction',
          ghost: true,
        })
      }
      shapes.push({ kind: 'point', at: live.point })
    } else if (last) {
      const tip = state.cursor ?? hover
      if (tip && !equals(last.point, tip)) {
        shapes.push({
          kind: 'segment',
          geometry: { kind: 'line', a: last.point, b: tip },
          role: 'lead',
          ghost: true,
        })
      }
    }

    for (const a of state.anchors) shapes.push({ kind: 'point', at: a.point })
    return shapes
  },

  isActive(state): boolean {
    return state.anchors.length > 0 || state.drag !== null
  },

  anchors(state): readonly Vec2[] {
    return state.anchors.map((a) => a.point)
  },
}
