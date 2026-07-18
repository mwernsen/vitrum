import type { Vec2 } from '@vitrum/geometry'
import { EPS, add, distance, line, normalize, scale, sub, vec2 } from '@vitrum/geometry'

import { placeNumeric } from './constrain'
import { ellipseDrafts } from './shapes'
import type { PreviewShape, SegmentDraft, ToolDef, ToolInput, ToolStep } from './types'

/**
 * The construction-guide tool (F-012): infinite guide lines (horizontal, vertical, angled
 * through a point) and guide circles. Every draft carries `role: 'construction'`, so it
 * participates in snapping but is excluded from piece detection, DRC and all outputs (FR-5,
 * enforced by `outputSegments` in `@vitrum/model`).
 *
 * An "infinite" line has no natural endpoints, and the geometry kernel / document model are
 * deliberately finite-primitive only (F-010/F-002). Rather than widen those contracts with
 * a new infinite-line primitive, a guide line is stored as a very long finite {@link line}
 * centred on the through-point ({@link GUIDE_HALF_LENGTH} each way) — far beyond any real
 * panel, so it reads as infinite and snapping works along its whole visible extent. Its
 * huge bbox is handled by the spatial index's oversized-item list, so it never smears the
 * grid.
 */
const GUIDE_HALF_LENGTH = 100_000 // mm (100 m each way)

const MODES = ['horizontal', 'vertical', 'angled', 'circle'] as const
type GuideMode = (typeof MODES)[number]

/**
 * One-click modes (horizontal/vertical) commit on the first click; two-click modes
 * (angled/circle) place `first`, then commit on the second click / Enter / numeric entry.
 */
export interface GuideState {
  readonly modeIndex: number
  readonly first: Vec2 | null
  readonly cursor: Vec2 | null
}

function initial(): GuideState {
  return { modeIndex: 0, first: null, cursor: null }
}

function modeOf(state: GuideState): GuideMode {
  return MODES[state.modeIndex % MODES.length]!
}

function guideLine(through: Vec2, dir: Vec2): SegmentDraft {
  const d = normalize(dir)
  return {
    geometry: line(
      sub(through, scale(d, GUIDE_HALF_LENGTH)),
      add(through, scale(d, GUIDE_HALF_LENGTH)),
    ),
    role: 'construction',
  }
}

/** Build the committed drafts for a mode given the reference point and the second point. */
function build(mode: GuideMode, first: Vec2, second: Vec2): SegmentDraft[] {
  switch (mode) {
    case 'horizontal':
      return [guideLine(first, vec2(1, 0))]
    case 'vertical':
      return [guideLine(first, vec2(0, 1))]
    case 'angled': {
      const dir = sub(second, first)
      if (Math.hypot(dir.x, dir.y) < EPS) return []
      return [guideLine(first, dir)]
    }
    case 'circle': {
      const radius = distance(first, second)
      if (radius < EPS) return []
      return ellipseDrafts(first, radius, radius, 'construction')
    }
  }
}

/** Modes that commit immediately on the first click (no second point needed). */
function isOneClick(mode: GuideMode): boolean {
  return mode === 'horizontal' || mode === 'vertical'
}

export const guideTool: ToolDef<GuideState> = {
  id: 'guide',
  role: 'construction',
  initial: initial(),

  reduce(state, input: ToolInput): ToolStep<GuideState> {
    const mode = modeOf(state)
    const reset: GuideState = { ...initial(), modeIndex: state.modeIndex }

    switch (input.type) {
      case 'down': {
        if (isOneClick(mode)) {
          const drafts = build(mode, input.at, input.at)
          return drafts.length > 0 ? { state: reset, commit: drafts } : { state: reset }
        }
        if (state.first === null) {
          return { state: { ...state, first: input.at, cursor: input.at } }
        }
        const drafts = build(mode, state.first, input.at)
        return drafts.length > 0 ? { state: reset, commit: drafts } : { state: reset }
      }
      case 'move':
        return { state: { ...state, cursor: input.at } }
      case 'numeric': {
        if (state.first === null || input.at === undefined) return { state }
        const end = placeNumeric(state.first, input.value, state.cursor, input.shift ?? false)
        const drafts = build(mode, state.first, end)
        return drafts.length > 0 ? { state: reset, commit: drafts } : { state: reset }
      }
      case 'enter':
        if (state.first && state.cursor) {
          const drafts = build(mode, state.first, state.cursor)
          if (drafts.length > 0) return { state: reset, commit: drafts }
        }
        return { state: reset }
      case 'escape':
        return { state: reset }
      case 'up':
        return { state }
    }
  },

  preview(state, hover): readonly PreviewShape[] {
    const mode = modeOf(state)
    const tip = state.cursor ?? hover
    const shapes: PreviewShape[] = []
    if (state.first) shapes.push({ kind: 'point', at: state.first })

    if (isOneClick(mode)) {
      if (tip) {
        for (const d of build(mode, tip, tip))
          shapes.push({ kind: 'segment', geometry: d.geometry, role: d.role, ghost: true })
      }
      return shapes
    }
    if (state.first && tip) {
      for (const d of build(mode, state.first, tip))
        shapes.push({ kind: 'segment', geometry: d.geometry, role: d.role, ghost: true })
    }
    return shapes
  },

  isActive(state): boolean {
    return state.first !== null
  },

  anchors(state): readonly Vec2[] {
    return state.first ? [state.first] : []
  },

  cycleMode(state): GuideState {
    return { ...initial(), modeIndex: (state.modeIndex + 1) % MODES.length }
  },

  hint(state): string {
    return `guide: ${modeOf(state)}`
  },
}
