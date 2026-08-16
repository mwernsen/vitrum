import { line, vec2, type Vec2 } from '@vitrum/geometry'
import {
  createEmptyProject,
  weldSegments,
  type Project,
  type Segment,
  type SegmentGeometry,
  type SegmentRole,
} from '@vitrum/model'

import type { RuleId, Severity } from '../types'

/**
 * Headline scenes for the panel-fit pack's on-disk golden suite (F-033): a design larger than the
 * ordered glass, one that fits but sits outside it, and one that fits inside. Shared by the golden
 * test and its `.vitrum` fixture drift-guard, so the checked-in files stay in step with the builders.
 *
 * Unlike the other packs' scenes these carry `settings.panelSize` — the ordered size is the whole
 * reference — so the fixtures also prove it survives the persistence path.
 */

type Draft = { geometry: SegmentGeometry; role: SegmentRole }

export interface FitScene {
  readonly name: string
  readonly project: Project
  /** The rule the scene is about, and its expected active-violation count. */
  readonly headline: RuleId
  readonly count: number
  /** The severity the one expected violation should carry, when there is one. */
  readonly severity?: Severity
}

function seg(a: Vec2, b: Vec2, role: SegmentRole = 'border'): Draft {
  return { geometry: line(a, b), role }
}

function rect(x: number, y: number, w: number, h: number): Draft[] {
  const A = vec2(x, y)
  const B = vec2(x + w, y)
  const C = vec2(x + w, y + h)
  const D = vec2(x, y + h)
  return [seg(A, B), seg(B, C), seg(C, D), seg(D, A)]
}

/** A 300 × 400 mm order, as the new-panel dialog's defaults produce (F-058). */
function ordered(drafts: readonly Draft[]): Project {
  const { segments, nodes } = weldSegments(drafts)
  const byId: Record<string, Segment> = {}
  for (const s of segments) byId[s.id] = s
  return {
    ...createEmptyProject({ name: 'Panel fit', panelSize: { width: 300, height: 400 } }),
    segments: byId,
    nodes,
  }
}

/** A 400 mm design in a 300 mm panel — the finding this pack exists for. Error: it cannot fit. */
export function oversizedScene(): FitScene {
  return {
    name: 'fit-oversized',
    project: ordered(rect(0, 0, 400, 400)),
    headline: 'design-exceeds-panel',
    count: 1,
    severity: 'error',
  }
}

/** A design that would fit the order but is drawn 40 mm off its right edge. Warning: move it. */
export function misplacedScene(): FitScene {
  return {
    name: 'fit-misplaced',
    project: ordered(rect(60, 10, 280, 380)),
    headline: 'design-exceeds-panel',
    count: 1,
    severity: 'warning',
  }
}

/**
 * A border drawn to exactly the ordered 300 × 400 mm. Error: `panelSize` is the *finished* panel
 * (Mathieu, 2026-08-16), and the drawn line is the came centreline, so this assembles to
 * 305 × 405 mm with the default H 5 mm came. The scene that passed clean under the old meaning.
 */
export function drawnToSizeScene(): FitScene {
  return {
    name: 'fit-drawn-to-size',
    project: ordered(rect(0, 0, 300, 400)),
    headline: 'design-exceeds-panel',
    count: 1,
    severity: 'error',
  }
}

/** The same design, inside the ordered panel — silent. */
export function insideScene(): FitScene {
  return {
    name: 'fit-inside',
    project: ordered(rect(10, 10, 280, 380)),
    headline: 'design-exceeds-panel',
    count: 0,
  }
}

export function fitScenes(): FitScene[] {
  return [oversizedScene(), misplacedScene(), drawnToSizeScene(), insideScene()]
}
