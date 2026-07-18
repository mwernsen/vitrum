import type { Vec2 } from '@vitrum/geometry'
import { vec2 } from '@vitrum/geometry'

import { placeNumeric } from './constrain'
import { ellipseDrafts, rectangleDrafts, regularPolygonDrafts } from './shapes'
import type {
  DrawRole,
  PreviewShape,
  SegmentDraft,
  ToolDef,
  ToolId,
  ToolInput,
  ToolStep,
} from './types'

/**
 * State shared by the two-click "span" tools (rectangle, circle/ellipse, polygon, border):
 * a first point (corner or centre), the live cursor, the held Shift, and the index of the
 * cycled mode (side count, circle-vs-ellipse). Kept opaque behind the {@link makeSpanTool}
 * factory so all four tools share one tested interaction.
 */
export interface SpanState {
  readonly start: Vec2 | null
  readonly cursor: Vec2 | null
  readonly shift: boolean
  readonly modeIndex: number
}

interface SpanConfig {
  readonly id: ToolId
  readonly role: DrawRole
  /** Cyclable modes (labels). The active one is passed to `build`. Omit for a modeless tool. */
  readonly modes?: readonly string[]
  /** Build the committed drafts from the two points, the active mode and modifiers. */
  build(start: Vec2, end: Vec2, ctx: { shift: boolean; mode: string | null }): SegmentDraft[]
  /** Canvas HUD label for the active mode. */
  hint?(mode: string | null): string
}

function initial(): SpanState {
  return { start: null, cursor: null, shift: false, modeIndex: 0 }
}

function mode(config: SpanConfig, state: SpanState): string | null {
  return config.modes ? config.modes[state.modeIndex % config.modes.length]! : null
}

/**
 * Build a two-click span tool. First click sets `start`; the second (or Enter with a live
 * cursor, or numeric entry) commits `config.build(...)` as one command and resets. Shape
 * tools emit ordinary segments/curves (never special objects), so pieces detect uniformly.
 */
export function makeSpanTool(config: SpanConfig): ToolDef<SpanState> {
  const commit = (state: SpanState, end: Vec2): ToolStep<SpanState> => {
    const drafts = state.start
      ? config.build(state.start, end, { shift: state.shift, mode: mode(config, state) })
      : []
    const reset: SpanState = { ...initial(), modeIndex: state.modeIndex }
    return drafts.length > 0 ? { state: reset, commit: drafts } : { state: reset }
  }

  return {
    id: config.id,
    role: config.role,
    initial: initial(),

    reduce(state, input: ToolInput): ToolStep<SpanState> {
      switch (input.type) {
        case 'down': {
          const shift = input.shift ?? false
          if (state.start === null) {
            return { state: { ...state, start: input.at, cursor: input.at, shift } }
          }
          return commit({ ...state, shift }, input.at)
        }
        case 'move':
          return { state: { ...state, cursor: input.at, shift: input.shift ?? state.shift } }
        case 'numeric': {
          if (state.start === null) return { state }
          const end = placeNumeric(
            state.start,
            input.value,
            state.cursor,
            input.shift ?? state.shift,
          )
          return commit({ ...state, shift: input.shift ?? state.shift }, end)
        }
        case 'enter':
          if (state.start && state.cursor) return commit(state, state.cursor)
          return { state: { ...initial(), modeIndex: state.modeIndex } }
        case 'escape':
          return { state: { ...initial(), modeIndex: state.modeIndex } }
        case 'up':
          return { state }
      }
    },

    preview(state, hover): readonly PreviewShape[] {
      const shapes: PreviewShape[] = []
      if (state.start) shapes.push({ kind: 'point', at: state.start })
      const tip = state.cursor ?? hover
      if (state.start && tip) {
        const drafts = config.build(state.start, tip, {
          shift: state.shift,
          mode: mode(config, state),
        })
        for (const d of drafts)
          shapes.push({ kind: 'segment', geometry: d.geometry, role: d.role, ghost: true })
      }
      return shapes
    },

    isActive(state): boolean {
      return state.start !== null
    },

    anchors(state): readonly Vec2[] {
      return state.start ? [state.start] : []
    },

    cycleMode: config.modes
      ? (state): SpanState => ({
          ...initial(),
          modeIndex: (state.modeIndex + 1) % config.modes!.length,
        })
      : undefined,

    hint: config.hint ? (state): string => config.hint!(mode(config, state)) : undefined,
  }
}

/* -------------------------------------------------------------------------- */
/* The concrete span tools                                                     */
/* -------------------------------------------------------------------------- */

/** Square off `end` against `start` so |dx| == |dy| (for Shift-constrained shapes). */
function squareOff(start: Vec2, end: Vec2): Vec2 {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const size = Math.max(Math.abs(dx), Math.abs(dy))
  return vec2(start.x + Math.sign(dx || 1) * size, start.y + Math.sign(dy || 1) * size)
}

export const rectangleTool: ToolDef<SpanState> = makeSpanTool({
  id: 'rectangle',
  role: 'lead',
  build: (start, end, { shift }) =>
    rectangleDrafts(start, shift ? squareOff(start, end) : end, 'lead'),
})

const POLYGON_SIDES = ['3', '4', '5', '6', '8', '12'] as const

export const polygonTool: ToolDef<SpanState> = makeSpanTool({
  id: 'polygon',
  role: 'lead',
  modes: POLYGON_SIDES,
  build: (center, vertex, { mode }) =>
    regularPolygonDrafts(center, vertex, Number(mode ?? '6'), 'lead'),
  hint: (mode) => `${mode ?? '6'}-gon`,
})

export const circleTool: ToolDef<SpanState> = makeSpanTool({
  id: 'circle',
  role: 'lead',
  modes: ['circle', 'ellipse'],
  build: (center, edge, { shift, mode }) => {
    if (mode === 'ellipse') {
      const rx = Math.abs(edge.x - center.x)
      const ry = Math.abs(edge.y - center.y)
      const r = Math.max(rx, ry)
      return ellipseDrafts(center, shift ? r : rx, shift ? r : ry, 'lead')
    }
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y)
    return ellipseDrafts(center, radius, radius, 'lead')
  },
  hint: (mode) => mode ?? 'circle',
})

/**
 * The border tool: a rectangular panel outline whose segments carry `role: 'border'`. The
 * "exactly one border contour per document" rule (v1) is enforced by `ToolController`,
 * which replaces any existing border on commit.
 */
export const borderTool: ToolDef<SpanState> = makeSpanTool({
  id: 'border',
  role: 'border',
  build: (start, end, { shift }) =>
    rectangleDrafts(start, shift ? squareOff(start, end) : end, 'border'),
  hint: () => 'border',
})
