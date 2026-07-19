import { detectPieces, pieceKey } from '@vitrum/core'
import { line, vec2, type Vec2 } from '@vitrum/geometry'
import {
  createEmptyProject,
  outputSegments,
  weldSegments,
  type Project,
  type Segment,
  type SegmentRole,
} from '@vitrum/model'

import type { RuleId } from '../types'

/**
 * Synthetic scenes for the golden-file suite (F-030 FR-5). Each builder returns a project plus the
 * exact set of violations it must produce, so the golden test is `scene → expected violation set`.
 * Geometry is built with the same coincidence-welding the drawing tools use (`weldSegments`), so
 * shared corners are genuinely one node and the network satisfies the model invariants.
 *
 * The rectangle border is split at the midpoint of its top and bottom edges (M1, M2) so an internal
 * splitter can weld to real border nodes; the clean scene's splitter divides the panel into two
 * pieces. Broken scenes derive from this base.
 */

/** Expected active violations for a scene: rule id → count. Absent rule ⇒ zero. */
export type ExpectedCounts = Partial<Record<RuleId, number>>

export interface Scene {
  readonly name: string
  readonly project: Project
  readonly expected: ExpectedCounts
}

type Draft = { geometry: ReturnType<typeof line>; role: SegmentRole }

const A = vec2(0, 0)
const B = vec2(100, 0)
const C = vec2(100, 80)
const D = vec2(0, 80)
const M1 = vec2(50, 0) // top-edge midpoint
const M2 = vec2(50, 80) // bottom-edge midpoint

function seg(a: Vec2, b: Vec2, role: SegmentRole): Draft {
  return { geometry: line(a, b), role }
}

/** The closed rectangle border, split at M1/M2 so a splitter can weld to it. */
function borderDrafts(): Draft[] {
  return [
    seg(A, M1, 'border'),
    seg(M1, B, 'border'),
    seg(B, C, 'border'),
    seg(C, M2, 'border'),
    seg(M2, D, 'border'),
    seg(D, A, 'border'),
  ]
}

function projectFrom(drafts: readonly Draft[]): Project {
  const { segments, nodes } = weldSegments(drafts)
  const byId: Record<string, Segment> = {}
  for (const s of segments) byId[s.id] = s
  return { ...createEmptyProject(), segments: byId, nodes }
}

/**
 * Assign a (single) glass to every detected piece, so `unassigned-glass` is silent. Returns the
 * project with `assignments` filled by content id and one glass in the catalog.
 */
function assignAll(project: Project): Project {
  const { pieces } = detectPieces(outputSegments(project))
  const assignments: Record<string, string> = {}
  for (const piece of pieces) assignments[pieceKey(piece)] = 'g-clear'
  return {
    ...project,
    glasses: {
      'g-clear': {
        id: 'g-clear',
        name: 'Clear',
        color: '#dfeaf2',
        transparency: 'transparent',
        texture: 'smooth',
        thicknessMm: 3,
      },
    },
    assignments,
  }
}

/** Clean reference: closed border + one splitter, both pieces assigned. Silent (FR-5). */
export function cleanScene(): Scene {
  const project = assignAll(projectFrom([...borderDrafts(), seg(M1, M2, 'lead')]))
  return { name: 'clean', project, expected: {} }
}

/** A stub off the splitter with a free far end → one dangling line. */
export function danglingScene(): Scene {
  // The stub starts on the splitter (x = 50) so that end is an intersection, not a free end; only
  // its far end (35, 40) dangles.
  const project = assignAll(
    projectFrom([...borderDrafts(), seg(M1, M2, 'lead'), seg(vec2(50, 40), vec2(35, 40), 'lead')]),
  )
  return { name: 'dangling', project, expected: { 'dangling-line': 1 } }
}

/** The splitter cut in two with a 0.3 mm gap at the centre → one near-miss, its two free ends. */
export function nearMissScene(): Scene {
  const P = vec2(50, 40)
  const Q = vec2(50, 40.3)
  const project = assignAll(
    projectFrom([...borderDrafts(), seg(M1, P, 'lead'), seg(Q, M2, 'lead')]),
  )
  return { name: 'near-miss', project, expected: { 'near-miss-joint': 1, 'dangling-line': 2 } }
}

/** Two lead lines over the same path (welded to the same nodes) → one overlap. */
export function duplicateScene(): Scene {
  // Both splitters share M1/M2 exactly, so they weld to the same two nodes and overlap.
  const project = assignAll(
    projectFrom([...borderDrafts(), seg(M1, M2, 'lead'), seg(M1, M2, 'lead')]),
  )
  return { name: 'duplicate', project, expected: { 'duplicate-segment': 1 } }
}

/** A border missing one edge → two free border ends. */
export function openBorderScene(): Scene {
  // Drop the final D→A edge; A and D become degree-1 border nodes.
  const drafts = borderDrafts().slice(0, 5)
  return { name: 'open-border', project: projectFrom(drafts), expected: { 'open-border': 2 } }
}

/** A lead line entirely outside the border → one orphan, its two free ends. */
export function orphanScene(): Scene {
  const project = assignAll(
    projectFrom([
      ...borderDrafts(),
      seg(M1, M2, 'lead'),
      seg(vec2(140, 20), vec2(180, 60), 'lead'),
    ]),
  )
  return {
    name: 'orphan',
    project,
    expected: { 'orphan-region': 1, 'dangling-line': 2 },
  }
}

/** Clean geometry, but only one of the two pieces has glass → one unassigned. */
export function unassignedScene(): Scene {
  const base = projectFrom([...borderDrafts(), seg(M1, M2, 'lead')])
  const { pieces } = detectPieces(outputSegments(base))
  const first = pieces[0]
  const project: Project = {
    ...base,
    glasses: {
      'g-clear': {
        id: 'g-clear',
        name: 'Clear',
        color: '#dfeaf2',
        transparency: 'transparent',
        texture: 'smooth',
        thicknessMm: 3,
      },
    },
    assignments: first ? { [pieceKey(first)]: 'g-clear' } : {},
  }
  return { name: 'unassigned', project, expected: { 'unassigned-glass': 1 } }
}

/**
 * A dense grid panel for the FR-1 benchmark: a `cells × cells` lattice of lead lines inside the
 * border, welded at every crossing, yielding `cells² ` pieces. `cells = 14` → 196 pieces, the
 * ~200-piece reference the runner is benchmarked against.
 */
export function gridProject(cells = 14): Project {
  const size = 100
  const step = size / cells
  const drafts: Draft[] = []
  // Border.
  const tl = vec2(0, 0)
  const tr = vec2(size, 0)
  const br = vec2(size, size)
  const bl = vec2(0, size)
  drafts.push(
    seg(tl, tr, 'border'),
    seg(tr, br, 'border'),
    seg(br, bl, 'border'),
    seg(bl, tl, 'border'),
  )
  // Interior grid: internal verticals and horizontals, welded end to end into full spans.
  for (let i = 1; i < cells; i++) {
    const x = i * step
    for (let j = 0; j < cells; j++) {
      const y0 = j * step
      drafts.push(seg(vec2(x, y0), vec2(x, y0 + step), 'lead'))
    }
  }
  for (let j = 1; j < cells; j++) {
    const y = j * step
    for (let i = 0; i < cells; i++) {
      const x0 = i * step
      drafts.push(seg(vec2(x0, y), vec2(x0 + step, y), 'lead'))
    }
  }
  return projectFrom(drafts)
}

/** Every scene, in a stable order. */
export function allScenes(): Scene[] {
  return [
    cleanScene(),
    danglingScene(),
    nearMissScene(),
    duplicateScene(),
    openBorderScene(),
    orphanScene(),
    unassignedScene(),
  ]
}
