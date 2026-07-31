import type { Vec2 } from '@vitrum/geometry'
import { equals, line } from '@vitrum/geometry'

import { constrainAngle, placeNumeric } from './constrain'
import type { DrawRole, PreviewShape, SegmentDraft, ToolDef, ToolInput, ToolStep } from './types'

/**
 * The line tool: click-click polyline chaining, each span its own segment (F-011).
 * Consecutive spans share the exact same anchor value, so their endpoints are coincident
 * — the "auto-weld into one coincident node" the resolved open question calls for, which
 * piece detection (F-020) relies on. The whole chain commits as ONE document command, so
 * a single undo removes the whole polyline, not one point (FR-1).
 *
 * Interaction:
 * - `down`  places an anchor (Shift constrains the new span to 0/45/90°).
 * - `move`  updates the rubber-band cursor.
 * - `numeric` places an anchor a typed length/angle from the last one (KiCad-style).
 * - `enter` finishes: ≥2 anchors commit as spans, a lone anchor is discarded.
 * - `escape` discards the in-progress chain without touching the document (FR-5).
 */
export interface LineState {
  /** Placed anchors of the chain, world mm. Adjacent anchors define one span. */
  readonly anchors: readonly Vec2[]
  /** Last hover position for the rubber-band preview, world mm. */
  readonly cursor: Vec2 | null
}

const INITIAL: LineState = { anchors: [], cursor: null }

/** Constrain `to` against the last anchor when Shift is held. */
function resolveSpanEnd(
  anchors: readonly Vec2[],
  to: Vec2,
  shift: boolean,
  refDirs: readonly Vec2[] = [],
): Vec2 {
  const last = anchors.at(-1)
  return shift && last ? constrainAngle(last, to, refDirs) : to
}

/** Build the chain's spans as line drafts. Coincident anchors (a doubled click) are skipped. */
function spans(anchors: readonly Vec2[], role: DrawRole): SegmentDraft[] {
  const drafts: SegmentDraft[] = []
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!
    const b = anchors[i + 1]!
    if (equals(a, b)) continue
    drafts.push({ geometry: line(a, b), role })
  }
  return drafts
}

export const lineTool: ToolDef<LineState> = {
  id: 'line',
  role: 'lead',
  initial: INITIAL,

  reduce(state, input: ToolInput): ToolStep<LineState> {
    switch (input.type) {
      case 'down': {
        const at = resolveSpanEnd(state.anchors, input.at, input.shift ?? false, input.refDirs)
        return { state: { anchors: [...state.anchors, at], cursor: at } }
      }
      case 'move': {
        const cursor = resolveSpanEnd(state.anchors, input.at, input.shift ?? false, input.refDirs)
        return { state: { ...state, cursor } }
      }
      case 'numeric': {
        const last = state.anchors.at(-1)
        if (!last) return { state } // Need a starting anchor first.
        const at = placeNumeric(
          last,
          input.value,
          state.cursor,
          input.shift ?? false,
          input.refDirs,
        )
        return { state: { anchors: [...state.anchors, at], cursor: at } }
      }
      case 'enter': {
        const drafts = spans(state.anchors, this.role)
        if (drafts.length === 0) return { state: INITIAL } // Nothing drawable — discard.
        return { state: INITIAL, commit: drafts }
      }
      case 'escape':
        return { state: INITIAL }
      case 'up':
        return { state }
    }
  },

  preview(state, hover): readonly PreviewShape[] {
    const shapes: PreviewShape[] = []
    const anchors = state.anchors
    for (let i = 0; i < anchors.length - 1; i++) {
      shapes.push({
        kind: 'segment',
        geometry: line(anchors[i]!, anchors[i + 1]!),
        role: this.role,
      })
    }
    const last = anchors.at(-1)
    const tip: Vec2 | null = state.cursor ?? hover
    if (last && tip && !equals(last, tip)) {
      shapes.push({ kind: 'segment', geometry: line(last, tip), role: this.role, ghost: true })
    }
    for (const a of anchors) shapes.push({ kind: 'point', at: a })
    return shapes
  },

  isActive(state): boolean {
    return state.anchors.length > 0
  },

  anchors(state): readonly Vec2[] {
    return state.anchors
  },
}
