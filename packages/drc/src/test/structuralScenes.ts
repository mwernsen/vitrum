import { line, vec2, type Vec2 } from '@vitrum/geometry'
import {
  createEmptyProject,
  weldSegments,
  type Project,
  type ReinforcementBar,
  type Segment,
  type SegmentRole,
} from '@vitrum/model'

import type { RuleId } from '../types'

/**
 * Headline scenes for the structural pack's on-disk golden suite (F-032): the Mondrian/brick hinge
 * pair and the oversized/braced reinforcement pair. Shared by the in-code test and the `.vitrum`
 * fixture drift-guard so the checked-in files stay in step with the builders. `expected` lists only
 * the *headline* rule's active count — `panel-weight` always adds an info that the golden test
 * ignores by rule id, keeping these scenes about the behaviour under test.
 */

type Draft = { geometry: ReturnType<typeof line>; role: SegmentRole }

export interface StructuralScene {
  readonly name: string
  readonly project: Project
  /** The rule the scene is about, and its expected active-violation count. */
  readonly headline: RuleId
  readonly count: number
}

function seg(a: Vec2, b: Vec2, role: SegmentRole = 'lead'): Draft {
  return { geometry: line(a, b), role }
}

function projectFrom(
  drafts: readonly Draft[],
  reinforcements: readonly ReinforcementBar[] = [],
): Project {
  const { segments, nodes } = weldSegments(drafts)
  const byId: Record<string, Segment> = {}
  for (const s of segments) byId[s.id] = s
  return { ...createEmptyProject(), segments: byId, nodes, reinforcements }
}

function rect(w: number, h: number): Draft[] {
  const A = vec2(0, 0)
  const B = vec2(w, 0)
  const C = vec2(w, h)
  const D = vec2(0, h)
  return [seg(A, B, 'border'), seg(B, C, 'border'), seg(C, D, 'border'), seg(D, A, 'border')]
}

/** Mondrian grid: a full vertical + full horizontal divider, each edge to edge → two hinges. */
export function mondrianScene(): StructuralScene {
  const w = 600
  const h = 600
  const mid = vec2(w / 2, h / 2)
  const drafts: Draft[] = [
    ...rect(w, h),
    seg(vec2(w / 2, 0), mid),
    seg(mid, vec2(w / 2, h)),
    seg(vec2(0, h / 2), mid),
    seg(mid, vec2(w, h / 2)),
  ]
  return { name: 'struct-mondrian', project: projectFrom(drafts), headline: 'hinge-line', count: 2 }
}

/** Staggered layout: both dividers jog at mid-span, so no collinear chain reaches an edge. */
export function brickScene(): StructuralScene {
  const drafts: Draft[] = [
    ...rect(600, 600),
    seg(vec2(300, 0), vec2(300, 280)),
    seg(vec2(300, 280), vec2(340, 320)),
    seg(vec2(340, 320), vec2(340, 600)),
    seg(vec2(0, 300), vec2(280, 300)),
    seg(vec2(280, 300), vec2(320, 340)),
    seg(vec2(320, 340), vec2(600, 340)),
  ]
  return { name: 'struct-brick', project: projectFrom(drafts), headline: 'hinge-line', count: 0 }
}

/** An oversized panel (0.54 m², 900 mm span) with no bar → needs reinforcement. */
export function oversizedScene(): StructuralScene {
  return {
    name: 'struct-oversized',
    project: projectFrom(rect(900, 600)),
    headline: 'panel-needs-reinforcement',
    count: 1,
  }
}

/** The same oversized panel, now braced by a bar spanning the long dimension → cleared. */
export function bracedScene(): StructuralScene {
  const bar: ReinforcementBar = {
    id: 'r-bar-1',
    a: vec2(50, 300),
    b: vec2(850, 300),
    widthMm: 6,
    material: 'zinc',
  }
  return {
    name: 'struct-braced',
    project: projectFrom(rect(900, 600), [bar]),
    headline: 'panel-needs-reinforcement',
    count: 0,
  }
}

export function structuralScenes(): StructuralScene[] {
  return [mondrianScene(), brickScene(), oversizedScene(), bracedScene()]
}
