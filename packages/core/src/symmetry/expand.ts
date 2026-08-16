import { bboxExpand, bboxOf, bboxOverlap, closestPoint, pointAt } from '@vitrum/geometry'

import { GridIndex } from '../snap/spatialIndex'

import { symmetryTransforms, transformSymGeometry } from './transform'
import type { NetworkSegment, SymGeometry, SymmetrySetup } from './types'

/**
 * How close a replica has to run to a segment already in the network before it counts as that
 * segment's own image rather than a new one, in world mm. Matched to F-020's `weldTolerance`
 * (`DETECT_DEFAULTS.weldTolerance`, 0.01 mm) on purpose, and deliberately **not** exact equality:
 * detection welds anything closer than that into one vertex, so a border drawn 0.004 mm off the
 * axis reflects to a copy the detector cannot tell apart from the source and degenerates exactly
 * like a pointwise-identical one would. Suppressing at the same tolerance keeps expansion and
 * detection agreeing about what "the same segment" means. Kept as a local constant rather than
 * imported from `../pieces` so symmetry stays upstream of piece detection (`pieces/orbits.ts`
 * imports *this* module).
 */
export const SELF_IMAGE_TOLERANCE = 0.01

/** Parameters sampled when comparing two curves — endpoints plus interior, so extent counts. */
const SAMPLE_TS = [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1] as const

/**
 * A hair of slack on the tolerance comparison, in mm. Reflection arithmetic lands a pair of points
 * meant to be exactly `tol` apart a few ulps either side of it, so without slack the *decisive*
 * case — geometry drawn `tol / 2` off the axis, whose image is `tol` away — would be settled by
 * floating-point noise, suppressing some of a shape's replicas and keeping others. A nanometre is
 * far below anything a glass design means.
 */
const FLOAT_SLACK = 1e-9

/** Every sample of `a` lies within `tol` of curve `b`: `a` runs along `b` (possibly inside it). */
function runsAlong(a: SymGeometry, b: SymGeometry, tol: number): boolean {
  for (const t of SAMPLE_TS) {
    if (closestPoint(b, pointAt(a, t)).distance > tol + FLOAT_SLACK) return false
  }
  return true
}

/**
 * `a` and `b` trace the same path over the same extent, in either direction. Containment both
 * ways is what makes this a *full* duplicate rather than a partial overlap: a shorter segment
 * running inside a longer one satisfies only one direction, and stays. Same shape of test as
 * F-020's `duplicate-segment` diagnostic, so the two agree about what they are looking at.
 */
function samePath(a: SymGeometry, b: SymGeometry, tol: number): boolean {
  return runsAlong(a, b, tol) && runsAlong(b, a, tol)
}

/**
 * Drop every candidate replica that merely repeats a segment the network already has — its own
 * source, another source, or an earlier-ranked replica.
 *
 * Geometry lying on a mirror axis (or on a rotation's fixed line) is left where it is by that
 * group element, so a naive expansion mints a second, coincident copy of it. Detection cannot
 * survive that: the half-edge angular sweep sees two outgoing half-edges at the same vertex with
 * the same departing angle, pairs each with the other's twin, and every cycle it traces collapses
 * to zero signed area — so a design whose border runs along the axis yields **no pieces at all**
 * (found in user-test run `docs/testing/runs/2026-08-16-a`, F-052 follow-up). A segment fixed by a
 * group element does not need its image emitted, so the honest full network is the de-duplicated
 * one.
 *
 * Acceptance is decided in an order that depends only on ids — sources first (they are the stored
 * truth), then replicas by derived id — so the surviving set is independent of the input segment
 * order, as `expandReplicas` promises.
 */
function dropSelfImages(
  sources: readonly NetworkSegment[],
  candidates: readonly NetworkSegment[],
  tol: number,
): NetworkSegment[] {
  if (candidates.length === 0) return []
  const all = [...sources, ...candidates]
  const boxes = all.map((s) => bboxOf(s.geometry))
  const index = GridIndex.build(boxes)
  // Sources are always live; a replica joins the live set only once it is accepted, so two
  // replicas that repeat each other leave exactly one behind.
  const live = new Array<boolean>(all.length).fill(false)
  for (let i = 0; i < sources.length; i++) live[i] = true

  const dropped = new Array<boolean>(candidates.length).fill(false)
  const ranked = candidates
    .map((_, i) => i)
    .sort((a, b) => cmp(candidates[a]!.id, candidates[b]!.id))
  for (const ci of ranked) {
    const ai = sources.length + ci
    const box = boxes[ai]!
    const window = bboxExpand(box, tol)
    let duplicate = false
    for (const j of index.query(window)) {
      if (j === ai || !live[j] || !bboxOverlap(box, boxes[j]!, tol)) continue
      if (samePath(all[ai]!.geometry, all[j]!.geometry, tol)) {
        duplicate = true
        break
      }
    }
    if (duplicate) dropped[ci] = true
    else live[ai] = true
  }
  return candidates.filter((_, i) => !dropped[i])
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Expand a source network into its symmetry replicas (F-052 Decision §2). Returns **only** the
 * replica segments (every group element except the identity); the source is left untouched so the
 * caller keeps its real ids/nodes. Pure and deterministic: replica ids derive solely from the
 * source id and the group-element index, so two source segments that share a node get replicas
 * that share a node (per-sector welds hold by construction — seam welds across sectors are left to
 * F-020's positional clustering, Decision §4), and repeated runs are byte-identical.
 *
 * A candidate replica that merely repeats a segment the network already has is **suppressed** —
 * see {@link dropSelfImages}. So the ×2 / ×4 / ×N / ×2N multiplicity of FR-1 holds for geometry in
 * general position, and drops to the size of the geometry's orbit when it sits on an axis or other
 * fixed line (fixed geometry has a shorter orbit; that is the group acting, not a lost replica).
 *
 * `mode: 'none'` (or a radial count < 2) yields no replicas.
 */
export function expandReplicas(
  segments: readonly NetworkSegment[],
  setup: SymmetrySetup | undefined,
  tolerance = SELF_IMAGE_TOLERANCE,
): NetworkSegment[] {
  if (!setup || setup.mode === 'none') return []
  const transforms = symmetryTransforms(setup)
  const replicas: NetworkSegment[] = []
  // Skip element 0 (identity = the source itself).
  for (let k = 1; k < transforms.length; k++) {
    const t = transforms[k]!
    const suffix = `~sym${k}`
    for (const seg of segments) {
      replicas.push({
        id: `${seg.id}${suffix}`,
        geometry: transformSymGeometry(t, seg.geometry),
        role: seg.role,
        endpoints: [`${seg.endpoints[0]}${suffix}`, `${seg.endpoints[1]}${suffix}`],
      })
    }
  }
  return dropSelfImages(segments, replicas, tolerance)
}

/**
 * The full replicated network: the source segments followed by every replica. This is what piece
 * detection (F-020), DRC (F-030) and the outputs consume (F-052 Decision §2). When symmetry is off
 * it is just the source, unchanged.
 */
export function expandNetwork(
  segments: readonly NetworkSegment[],
  setup: SymmetrySetup | undefined,
  tolerance = SELF_IMAGE_TOLERANCE,
): NetworkSegment[] {
  return [...segments, ...expandReplicas(segments, setup, tolerance)]
}
