import {
  arcEnd,
  arcStart,
  arcToCubics,
  closestPoint,
  cubic,
  curveLength,
  distance,
  intersect,
  line,
  pointAt,
  splitAt,
  type Vec2,
} from '@vitrum/geometry'

import type { DrawGeometry, DrawRole } from '../tools/types'

/**
 * Healing an imported network (F-050, "the hard part"). Art from Illustrator/Inkscape/Affinity is
 * never a clean planar network: endpoints miss each other by a hair, paths cross without a node,
 * and there are stray zero-length or duplicate segments. Without healing, piece detection (F-020)
 * finds garbage. A single tolerance (mm) drives three operations:
 *
 * - **snap** near-coincident endpoints together (and dangling endpoints onto a curve they nearly
 *   touch, forming a T-junction),
 * - **split** intersecting paths at their true crossings (reusing the kernel's intersection maths,
 *   in the same stable id-ordered direction F-020 uses),
 * - **drop** zero-length and duplicate segments.
 *
 * Two guarantees the UI and FR-4 rely on:
 * - **Idempotent** — healing its own output changes nothing (the property test asserts this).
 * - **No-op at tolerance 0 on an already-clean network** — an exported-then-reimported network
 *   round-trips exactly. At tolerance 0 clustering only merges bit-identical points, crossings only
 *   split at genuine interior intersections, and only truly degenerate/duplicate segments drop, so a
 *   network whose junctions are already welded is returned unchanged (same segments, same geometry).
 *
 * Pure and framework-free (geometry + the tool draft vocabulary only), so the slider's live preview
 * re-runs it and the merge command is built from its output.
 */

export interface HealSegment {
  readonly id: string
  readonly geometry: DrawGeometry
  readonly role: DrawRole
}

/** A tally of what healing did, for the summary the UI reports. */
export interface HealSummary {
  /** Endpoints moved onto a cluster representative or onto a nearby curve. */
  readonly snapped: number
  /** Source segments that were split at one or more interior crossings. */
  readonly split: number
  /** Zero-length and duplicate segments removed. */
  readonly dropped: number
}

export interface HealResult {
  readonly segments: readonly HealSegment[]
  readonly summary: HealSummary
  /** Output segments that differ from the input (new, split or snapped) — the "what changed" set. */
  readonly changedIds: ReadonlySet<string>
}

/** The `[start, end]` world points of a geometry (arc endpoints are computed). */
function endpointsOf(g: DrawGeometry): readonly [Vec2, Vec2] {
  switch (g.kind) {
    case 'line':
      return [g.a, g.b]
    case 'cubic':
      return [g.p0, g.p3]
    case 'arc':
      return [arcStart(g), arcEnd(g)]
  }
}

/** Split one geometry at sorted interior parameters, returning the ordered pieces. */
function splitAtParams(g: DrawGeometry, params: readonly number[]): DrawGeometry[] {
  const interior = [...params].filter((t) => t > 1e-9 && t < 1 - 1e-9).sort((a, b) => a - b)
  if (interior.length === 0) return [g]
  const pieces: DrawGeometry[] = []
  let rest = g
  let base = 0
  for (const t of interior) {
    const local = (t - base) / (1 - base)
    if (local <= 1e-9 || local >= 1 - 1e-9) continue
    const [before, after] = splitAt(rest, local) as [DrawGeometry, DrawGeometry]
    pieces.push(before)
    rest = after
    base = t
  }
  pieces.push(rest)
  return pieces
}

/** Clusters points so any two within `tol` collapse to one representative (min-lex point). */
class PointClusters {
  readonly #cell: number
  readonly #tol: number
  readonly #buckets = new Map<string, number[]>()
  readonly #points: Vec2[] = []
  readonly #rep: number[] = []

  constructor(tol: number) {
    this.#tol = tol
    this.#cell = Math.max(tol, 1e-9)
  }

  add(p: Vec2): void {
    const cx = Math.floor(p.x / this.#cell)
    const cy = Math.floor(p.y / this.#cell)
    const key = `${cx},${cy}`
    // Merge into any existing point within tol (3×3 neighbourhood).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.#buckets.get(`${cx + dx},${cy + dy}`)
        if (!bucket) continue
        for (const id of bucket) {
          if (distance(this.#points[id]!, p) <= this.#tol) return
        }
      }
    }
    const id = this.#points.length
    this.#points.push(p)
    this.#rep.push(id)
    const bucket = this.#buckets.get(key)
    if (bucket) bucket.push(id)
    else this.#buckets.set(key, [id])
  }

  /** Map a point to its cluster's representative position (the min-lex member). */
  resolve(p: Vec2): Vec2 {
    const cx = Math.floor(p.x / this.#cell)
    const cy = Math.floor(p.y / this.#cell)
    let best: Vec2 | null = null
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.#buckets.get(`${cx + dx},${cy + dy}`)
        if (!bucket) continue
        for (const id of bucket) {
          const q = this.#points[id]!
          if (distance(q, p) <= this.#tol && (!best || less(q, best))) best = q
        }
      }
    }
    return best ?? p
  }
}

function less(a: Vec2, b: Vec2): boolean {
  return a.x < b.x || (a.x === b.x && a.y < b.y)
}

function withEndpoints(g: DrawGeometry, start: Vec2, end: Vec2): DrawGeometry {
  switch (g.kind) {
    case 'line':
      return line(start, end)
    case 'cubic':
      return cubic(start, g.p1, g.p2, end)
    case 'arc':
      // An arc cannot keep an endpoint off its circle; the caller demotes it before moving one.
      return g
  }
}

/** A prospective endpoint→curve projection (a T-junction): move `from` onto `to`, split at `t`. */
interface Projection {
  readonly segIndex: number
  readonly t: number
  readonly from: Vec2
  readonly to: Vec2
}

/**
 * Heal to a fixed point. One pass ({@link healOnce}) snaps, splits and drops, but snapping moves the
 * points a split just created, so a single pass is not always stable — nearby crossings can cluster
 * and shift on the next look. We therefore iterate until a pass reports no work (bounded, so a
 * pathological input can never loop forever), which makes the *output* a fixed point by construction:
 * re-running `healNetwork` on it does nothing (idempotence, FR-4). The reported summary is the total
 * work across passes; `changedIds` is the union.
 */
export function healNetwork(input: readonly HealSegment[], tolerance: number): HealResult {
  const tol = Math.max(0, tolerance)
  let current = input
  let snapped = 0
  let split = 0
  let dropped = 0
  const changedIds = new Set<string>()
  for (let pass = 0; pass < 12; pass++) {
    const step = healOnce(current, tol)
    snapped += step.summary.snapped
    split += step.summary.split
    dropped += step.summary.dropped
    for (const id of step.changedIds) changedIds.add(id)
    current = step.segments
    if (step.summary.snapped === 0 && step.summary.split === 0 && step.summary.dropped === 0) break
  }
  // Only ids still present in the final output are meaningful for the highlight.
  const present = new Set(current.map((s) => s.id))
  return {
    segments: current,
    summary: { snapped, split, dropped },
    changedIds: new Set([...changedIds].filter((id) => present.has(id))),
  }
}

function healOnce(input: readonly HealSegment[], tol: number): HealResult {

  // --- Phase 1: collect split parameters (true crossings + endpoint→curve projections) ----------
  const splitParams: number[][] = input.map(() => [])
  const projections: Projection[] = []

  // A crossing this close (mm) to either curve's endpoint is treated as a junction, not a new split.
  // Splitting there would leave two sub-curves sharing an endpoint that a floating solver re-crosses
  // a nanometre away, which would make healing oscillate rather than converge — this keeps it a fixed
  // point (idempotence, FR-4). At real CAD scale the margin never swallows a genuine interior crossing.
  const margin = Math.max(tol, 1e-4)
  const nearEndpoint = (p: Vec2, g: DrawGeometry): boolean => {
    const [s, e] = endpointsOf(g)
    return distance(p, s) <= margin || distance(p, e) <= margin
  }

  for (let i = 0; i < input.length; i++) {
    for (let j = i + 1; j < input.length; j++) {
      // Intersect in a stable, id-ordered direction so results don't depend on input order (F-020).
      const [lo, hi] = input[i]!.id <= input[j]!.id ? [i, j] : [j, i]
      for (const x of intersect(input[lo]!.geometry, input[hi]!.geometry)) {
        if (x.tangential) continue
        if (nearEndpoint(x.point, input[lo]!.geometry) || nearEndpoint(x.point, input[hi]!.geometry))
          continue
        splitParams[lo]!.push(x.t0)
        splitParams[hi]!.push(x.t1)
      }
    }
  }

  // Endpoint→curve projections (T-junctions) only matter with a positive tolerance: at tol 0 a
  // dangling end near another curve is left alone (only exact geometric crossings, handled above).
  // Each endpoint projects onto at most its single nearest curve, so it never splits two curves at
  // once — that would move it to one target while cutting another elsewhere and break convergence.
  if (tol > 0) {
    for (let i = 0; i < input.length; i++) {
      for (const end of endpointsOf(input[i]!.geometry)) {
        let best: { j: number; t: number; to: Vec2; distance: number } | null = null
        for (let j = 0; j < input.length; j++) {
          if (j === i) continue
          const near = closestPoint(input[j]!.geometry, end)
          if (near.distance > tol) continue
          if (near.t <= 1e-6 || near.t >= 1 - 1e-6) continue // interior only (endpoints cluster)
          if (!best || near.distance < best.distance) {
            best = { j, t: near.t, to: near.point, distance: near.distance }
          }
        }
        if (best) {
          splitParams[best.j]!.push(best.t)
          projections.push({ segIndex: best.j, t: best.t, from: end, to: best.to })
        }
      }
    }
  }

  // --- Phase 2: split every segment at its interior parameters ----------------------------------
  interface Working {
    id: string
    geometry: DrawGeometry
    role: DrawRole
    fromId: string
  }
  const working: Working[] = []
  let splitCount = 0
  for (let i = 0; i < input.length; i++) {
    const seg = input[i]!
    const pieces = splitAtParams(seg.geometry, dedupeParams(seg.geometry, splitParams[i]!, tol))
    if (pieces.length > 1) splitCount++
    pieces.forEach((geometry, k) => {
      working.push({
        id: k === 0 ? seg.id : `${seg.id}~${k}`,
        geometry,
        role: seg.role,
        fromId: seg.id,
      })
    })
  }

  // --- Phase 3: snap endpoints (T-junction moves first, then cluster near-misses) ---------------
  const moveEndpoint = (p: Vec2): Vec2 => {
    for (const proj of projections) {
      if (distance(p, proj.from) <= 1e-9) return proj.to
    }
    return p
  }

  const clusters = new PointClusters(tol)
  for (const w of working) {
    const [s, e] = endpointsOf(w.geometry)
    clusters.add(moveEndpoint(s))
    clusters.add(moveEndpoint(e))
  }

  const snappedEndpoints = new Set<string>()
  const resolved: HealSegment[] = []
  for (const w of working) {
    const [s0, e0] = endpointsOf(w.geometry)
    const s = clusters.resolve(moveEndpoint(s0))
    const e = clusters.resolve(moveEndpoint(e0))
    const startMoved = !exact(s, s0)
    const endMoved = !exact(e, e0)
    if (startMoved || endMoved) snappedEndpoints.add(w.id)

    if (w.geometry.kind === 'arc' && (startMoved || endMoved)) {
      // Moving an arc's endpoint takes it off its circle — demote to a welded cubic chain, then move
      // the outer ends. Interior joins stay put.
      const cubics = arcToCubics(w.geometry)
      const last = cubics.length - 1
      cubics.forEach((c, k) => {
        const cs = k === 0 ? s : c.p0
        const ce = k === last ? e : c.p3
        resolved.push({
          id: k === 0 ? w.id : `${w.id}~a${k}`,
          geometry: cubic(cs, c.p1, c.p2, ce),
          role: w.role,
        })
      })
    } else {
      resolved.push({ id: w.id, geometry: withEndpoints(w.geometry, s, e), role: w.role })
    }
  }

  // --- Phase 4: drop zero-length and duplicate segments -----------------------------------------
  const seen = new Set<string>()
  const out: HealSegment[] = []
  let dropped = 0
  for (const seg of resolved) {
    if (curveLength(seg.geometry) <= tol) {
      dropped++
      continue
    }
    const key = duplicateKey(seg.geometry, tol)
    if (seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    out.push(seg)
  }

  // --- Changed set ("what changed" highlight) ---------------------------------------------------
  const inputById = new Map(input.map((s) => [s.id, s.geometry]))
  const changedIds = new Set<string>()
  for (const seg of out) {
    const original = inputById.get(seg.id)
    if (!original || !sameGeometry(original, seg.geometry)) changedIds.add(seg.id)
  }

  return {
    segments: out,
    summary: { snapped: snappedEndpoints.size, split: splitCount, dropped },
    changedIds,
  }
}

/** Deduplicate split parameters, collapsing two within `tol` (measured along the curve) into one. */
function dedupeParams(g: DrawGeometry, params: readonly number[], tol: number): number[] {
  const sorted = [...params].map((t) => (t < 0 ? 0 : t > 1 ? 1 : t)).sort((a, b) => a - b)
  const kept: number[] = []
  for (const t of sorted) {
    const p = pointAt(g, t)
    if (kept.length === 0 || distance(pointAt(g, kept[kept.length - 1]!), p) > Math.max(tol, 1e-9)) {
      kept.push(t)
    }
  }
  return kept
}

function exact(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * A direction-insensitive signature for duplicate detection: five sampled points quantised to the
 * tolerance grid, oriented so a segment and its reverse produce the same key. Two segments sharing
 * this key trace the same curve within tolerance and are treated as duplicates.
 */
function duplicateKey(g: DrawGeometry, tol: number): string {
  const q = Math.max(tol, 1e-6)
  const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const p = pointAt(g, t)
    return `${Math.round(p.x / q)},${Math.round(p.y / q)}`
  })
  const forward = samples.join('|')
  const backward = [...samples].reverse().join('|')
  return forward <= backward ? forward : backward
}

/** Exact-ish geometry equality (to floating precision) for the changed-set diff. */
function sameGeometry(a: DrawGeometry, b: DrawGeometry): boolean {
  if (a.kind !== b.kind) return false
  const near = (p: Vec2, q: Vec2): boolean => distance(p, q) <= 1e-9
  if (a.kind === 'line' && b.kind === 'line') return near(a.a, b.a) && near(a.b, b.b)
  if (a.kind === 'cubic' && b.kind === 'cubic')
    return near(a.p0, b.p0) && near(a.p1, b.p1) && near(a.p2, b.p2) && near(a.p3, b.p3)
  if (a.kind === 'arc' && b.kind === 'arc')
    return (
      near(a.center, b.center) &&
      Math.abs(a.radius - b.radius) <= 1e-9 &&
      Math.abs(a.startAngle - b.startAngle) <= 1e-9 &&
      Math.abs(a.endAngle - b.endAngle) <= 1e-9 &&
      a.ccw === b.ccw
    )
  return false
}
