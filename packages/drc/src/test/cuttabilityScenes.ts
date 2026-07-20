import { arc, line, vec2, type Vec2 } from '@vitrum/geometry'
import {
  createEmptyProject,
  defaultTechnique,
  type Project,
  type Segment,
  type SegmentGeometry,
  type SegmentRole,
  type TechniqueKind,
  weldSegments,
} from '@vitrum/model'

import type { RuleId } from '../types'

/**
 * Synthetic scenes for the cuttability golden suite (F-031 FR-2): for each rule, one triggering case
 * and one just-inside-threshold non-triggering case, plus the acceptance-criteria pair — a
 * deliberately nasty panel and a well-drawn traditional one. Each panel is a single closed region
 * (its border drafts weld into one loop, so detection yields exactly one piece), which keeps the
 * expected violation set small and hand-verifiable.
 *
 * Concave curves use a semicircular bay: the bay meets the straight edges tangentially, so the join
 * is smooth and only `concave-curvature` fires — no incidental corner. Some tight-radius / sliver
 * cases are unavoidably also small (a sliver is by definition below the size floor), so their
 * expected sets legitimately list more than one rule; the unit tests assert per rule.
 */

export type ExpectedCounts = Partial<Record<RuleId, number>>

export interface CutScene {
  readonly name: string
  readonly project: Project
  readonly expected: ExpectedCounts
}

type Draft = { readonly geometry: SegmentGeometry; readonly role: SegmentRole }

function seg(geometry: SegmentGeometry, role: SegmentRole = 'border'): Draft {
  return { geometry, role }
}

/** Weld border drafts into a one-piece project, at the given technique (default lead). */
function panel(drafts: readonly Draft[], kind: TechniqueKind = 'lead'): Project {
  const { segments, nodes } = weldSegments(drafts)
  const byId: Record<string, Segment> = {}
  for (const s of segments) byId[s.id] = s
  const base = createEmptyProject()
  return {
    ...base,
    technique: { ...defaultTechnique(), kind },
    segments: byId,
    nodes,
  }
}

/** A rectangle border, `w × h`, as four line drafts. */
function rect(w: number, h: number): Draft[] {
  return [
    seg(line(vec2(0, 0), vec2(w, 0))),
    seg(line(vec2(w, 0), vec2(w, h))),
    seg(line(vec2(w, h), vec2(0, h))),
    seg(line(vec2(0, h), vec2(0, 0))),
  ]
}

/**
 * A `w × h` rectangle whose top edge carries a central concave dish — an inside curve of chord `c`
 * and radius `r` (r ≥ c/2) dipping down into the piece. The dish sits between two horizontal
 * stretches of top edge, so its radius is a clean, known value and the piece stays comfortably above
 * the size floor away from the curve.
 */
function bay(w: number, h: number, c: number, r: number): Draft[] {
  const mid = w / 2
  const half = c / 2
  const d = Math.sqrt(r * r - half * half) // centre sits distance d above the chord
  const center = vec2(mid, h + d)
  const startAngle = Math.atan2(-d, half) // right endpoint (mid+half, h)
  const endAngle = Math.atan2(-d, -half) // left endpoint (mid−half, h)
  return [
    seg(line(vec2(0, 0), vec2(w, 0))),
    seg(line(vec2(w, 0), vec2(w, h))),
    seg(line(vec2(w, h), vec2(mid + half, h))),
    // Concave dish, clockwise from the right endpoint through the low point to the left endpoint.
    seg(arc(center, r, startAngle, endAngle, false)),
    seg(line(vec2(mid - half, h), vec2(0, h))),
    seg(line(vec2(0, h), vec2(0, 0))),
  ]
}

/** A closed polygon border from an ordered vertex ring (line drafts between consecutive vertices). */
function polygon(points: readonly Vec2[]): Draft[] {
  return points.map((p, i) => seg(line(p, points[(i + 1) % points.length]!)))
}

/* --- min-piece-size ------------------------------------------------------- */

/** An 8 mm square: below the 10 mm lead floor but above half of it → one warning. */
export function tinyPieceScene(): CutScene {
  return { name: 'cut-tiny-piece', project: panel(rect(8, 8)), expected: { 'min-piece-size': 1 } }
}

/** A 4 mm square: below half the floor → one error (still large enough to inset, so not degenerate). */
export function tinyPieceErrorScene(): CutScene {
  return {
    name: 'cut-tiny-piece-error',
    project: panel(rect(4, 4)),
    expected: { 'min-piece-size': 1 },
  }
}

/** A 12 mm square: inset stays above the floor → silent (just-inside case). */
export function sizeOkScene(): CutScene {
  return { name: 'cut-size-ok', project: panel(rect(12, 12)), expected: {} }
}

/** The same 8 mm square under foil, whose floor is 6 mm → silent, exercising per-technique defaults. */
export function tinyPieceFoilScene(): CutScene {
  return { name: 'cut-tiny-piece-foil', project: panel(rect(8, 8), 'foil'), expected: {} }
}

/* --- degenerate-cut-contour ----------------------------------------------- */

/** A 1.2 mm square, narrower than the lead allowance it must inset by → cannot be cut. */
export function degenerateScene(): CutScene {
  return {
    name: 'cut-degenerate',
    project: panel(rect(1.2, 1.2)),
    expected: { 'degenerate-cut-contour': 1 },
  }
}

/* --- sliver --------------------------------------------------------------- */

/** A 6 × 60 mm strip: a sliver, and (being under the size floor too) also a min-piece-size error. */
export function sliverScene(): CutScene {
  return {
    name: 'cut-sliver',
    project: panel(rect(6, 60)),
    expected: { sliver: 1, 'min-piece-size': 1 },
  }
}

/** A 12 × 60 mm strip: wider than the sliver floor and the size floor → silent (just-inside case). */
export function sliverOkScene(): CutScene {
  return { name: 'cut-sliver-ok', project: panel(rect(12, 60)), expected: {} }
}

/* --- concave-curvature ---------------------------------------------------- */

/** A radius-12 dish (≈11 mm after allowance): a tight inside curve → one warning. */
export function concaveWarnScene(): CutScene {
  return {
    name: 'cut-concave-warn',
    project: panel(bay(40, 30, 16, 12)),
    expected: { 'concave-curvature': 1 },
  }
}

/** A radius-6 dish (≈5 mm after allowance): impossibly tight → one error. */
export function concaveErrorScene(): CutScene {
  return {
    name: 'cut-concave-error',
    project: panel(bay(40, 30, 10, 6)),
    expected: { 'concave-curvature': 1 },
  }
}

/** A radius-20 dish: a comfortable inside curve → silent (just-inside case). */
export function concaveOkScene(): CutScene {
  return { name: 'cut-concave-ok', project: panel(bay(40, 30, 20, 20)), expected: {} }
}

/* --- concave-notch -------------------------------------------------------- */

/** A 40 mm square with a sharp V notched into the top edge (≈28° wedge) → one error. */
export function notchScene(): CutScene {
  const points = [
    vec2(0, 0),
    vec2(40, 0),
    vec2(40, 40),
    vec2(24, 40),
    vec2(20, 24), // reflex tip of the notch
    vec2(16, 40),
    vec2(0, 40),
  ]
  return { name: 'cut-notch', project: panel(polygon(points)), expected: { 'concave-notch': 1 } }
}

/** A 40 mm square with a shallow, wide dish in the top edge (≈136° wedge) → silent (just-inside). */
export function notchOkScene(): CutScene {
  const points = [
    vec2(0, 0),
    vec2(40, 0),
    vec2(40, 40),
    vec2(35, 40),
    vec2(20, 34),
    vec2(5, 40),
    vec2(0, 40),
  ]
  return { name: 'cut-notch-ok', project: panel(polygon(points)), expected: {} }
}

/* --- sharp-point ---------------------------------------------------------- */

/** A long thin triangle with an ≈8.6° tip → one warning (fragile point). */
export function sharpPointScene(): CutScene {
  const points = [vec2(0, 0), vec2(80, 6), vec2(0, 12)]
  return {
    name: 'cut-sharp-point',
    project: panel(polygon(points)),
    expected: { 'sharp-point': 1 },
  }
}

/** A blunter triangle with an ≈37° tip → silent (just-inside case). */
export function sharpPointOkScene(): CutScene {
  const points = [vec2(0, 0), vec2(30, 10), vec2(0, 20)]
  return { name: 'cut-sharp-point-ok', project: panel(polygon(points)), expected: {} }
}

/* --- acceptance panels ---------------------------------------------------- */

/**
 * A deliberately nasty panel: a big square with a sharp V notch bitten into the top edge and a
 * fragile spike on the right. The notch is an error; the spike a warning. (Acceptance criteria.)
 */
export function nastyPanelScene(): CutScene {
  const points = [
    vec2(0, 0),
    vec2(60, 0),
    vec2(140, 20), // sharp spike tip on the right (≈28°)
    vec2(60, 40),
    vec2(34, 40),
    vec2(30, 20), // reflex notch tip
    vec2(26, 40),
    vec2(0, 40),
  ]
  return {
    name: 'cut-nasty',
    project: panel(polygon(points)),
    expected: { 'concave-notch': 1, 'sharp-point': 1 },
  }
}

/**
 * A well-drawn traditional panel: a generous rectangle with a gentle radius-30 arched top. Every
 * dimension and curve is comfortably within the craft limits → zero violations (acceptance).
 */
export function traditionalPanelScene(): CutScene {
  // A 60 × 80 rectangle; the top edge bows *outward* (convex), so there is no concave curve at all.
  const drafts: Draft[] = [
    seg(line(vec2(0, 0), vec2(60, 0))),
    seg(line(vec2(60, 0), vec2(60, 60))),
    // Convex arch: bulges up, away from the glass — centre below the chord, ccw so it rises.
    seg(arc(vec2(30, 60), 30, 0, Math.PI, true)),
    seg(line(vec2(0, 60), vec2(0, 0))),
  ]
  return { name: 'cut-traditional', project: panel(drafts), expected: {} }
}

/** Every cuttability scene, in a stable order. */
export function allCutScenes(): CutScene[] {
  return [
    tinyPieceScene(),
    tinyPieceErrorScene(),
    sizeOkScene(),
    tinyPieceFoilScene(),
    degenerateScene(),
    sliverScene(),
    sliverOkScene(),
    concaveWarnScene(),
    concaveErrorScene(),
    concaveOkScene(),
    notchScene(),
    notchOkScene(),
    sharpPointScene(),
    sharpPointOkScene(),
    nastyPanelScene(),
    traditionalPanelScene(),
  ]
}
