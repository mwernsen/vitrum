import {
  canonicalizeToSource,
  canonicalizeToSourceSector,
  expandReplicas,
  radialCount,
  sectorFrame,
  symmetryTransforms,
  transformSymGeometry,
  type NetworkSegment,
  type PointerResolver,
  type PreviewShape,
  type SymmetryMode,
  type SymmetrySetup,
} from '@vitrum/core'
import { applyToPoint, applyToVector, distanceSq, vec2, type Vec2 } from '@vitrum/geometry'
import {
  bakeSymmetry,
  outputSegments,
  segmentsFromDrafts,
  setSymmetry,
  type Command,
  type Project,
  type Segment,
} from '@vitrum/model'

/**
 * How close a point folded back out of a replica sector must be to a stored source coordinate to be
 * taken as *that* coordinate, by reference. A fold is an isometry composed of its own inverse, so it
 * returns the source point to within float rounding (~1e-13 mm) — but welding keys on exact equality
 * (`vecKey`), so without this the weld F-012 FR-1 promises would silently become a duplicate node a
 * nanometre away. Far below any drawable distinction, far above the rounding.
 */
const EXACT_SOURCE_MM = 1e-6

/** What the symmetry controller needs from its surroundings. */
export interface SymmetryHost {
  getDoc(): Project
  execute(command: Command): void
  /** A sensible default center when symmetry is first enabled (panel/content center). */
  defaultCenter(): Vec2
}

/**
 * Live-symmetry controller (F-052). The reactive owner of the document's symmetry *setup* and the
 * two seams that make replicas appear without touching any tool:
 *
 * - {@link sectorResolver} wraps the F-012 resolver so a pointer is snapped in the sector it is in and
 *   only the winner folds back into the source sector — drawing/editing stays confined to the source
 *   (Decision §1 / FR-5) with no change to the tool or `ResolvedPoint` contracts. {@link canonicalize}
 *   is the bare fold, for callers that need the source point without snapping.
 * - {@link replicasOf} expands the source into its derived replicas (via the pure `@vitrum/core`
 *   transform) for the canvas, piece detection, DRC and outputs (Decision §2).
 *
 * Setup edits go through commands, so each is one undo entry (FR-4); bake is one compound command
 * (FR-3). No document state is held here — it is read live from the doc, so undo/redo just work.
 */
export class SymmetryController {
  readonly #host: SymmetryHost

  constructor(host: SymmetryHost) {
    this.#host = host
  }

  get setup(): SymmetrySetup {
    return this.#host.getDoc().symmetry
  }

  /** True when replication is on (mode ≠ none). */
  get active(): boolean {
    return this.setup.mode !== 'none'
  }

  /** Radial fold count, clamped ≥ 2 (only meaningful for the radial mode). */
  get count(): number {
    return radialCount(this.setup)
  }

  /** Fold a world point into the source fundamental domain (FR-5). Identity when symmetry is off. */
  canonicalize = (world: Vec2): Vec2 => canonicalizeToSource(world, this.setup)

  /**
   * Decorate a pointer resolver so snapping is evaluated **in the sector the cursor is in**, and only
   * the winning point is folded back to source (F-052 FR-5; fixes the 2026-08-16-a finding).
   *
   * The original composition folded first (`snap(canonicalize(world))`). That confined drawing
   * correctly but measured snapping in the wrong space: with the cursor in a replica sector, the
   * folded point sweeps *backwards* past the 45° rays angle snap fans from the gesture's anchor, so a
   * stroke crossing the axis flipped between 45° angles instead of following the cursor, and every
   * snap marker was drawn in the source sector rather than under the cursor.
   *
   * Snapping in the sector needs the gesture's anchors (and any angular constraint) mapped into that
   * sector too — the anchor's *image* is where the stroke the user sees starts, so the rays fan from
   * the point they clicked. The resolved position then folds back through the sector frame's exact
   * inverse. This is not an approximation: replica geometry is a rigid image of the source, so a snap
   * onto sector `k`'s copy of an endpoint folds back onto that endpoint (asserted to 1e-9 mm by a
   * property test, and to exact identity for welds via {@link EXACT_SOURCE_MM}).
   *
   * `ResolvedPoint.snap` is deliberately left in **sector** coordinates: it is what the overlay draws,
   * and the marker belongs under the cursor. Only `world` — the coordinate the document stores — is
   * folded, so FR-5 still holds: a gesture never authors geometry into a replica sector.
   */
  sectorResolver(resolve: PointerResolver): PointerResolver {
    return (world, ctx) => {
      const setup = this.setup
      if (setup.mode === 'none') return resolve(world, ctx)
      const { sector } = canonicalizeToSourceSector(world, setup)
      // Drawing inside the source sector is unchanged, down to reference identity of the point.
      if (sector === 0) return resolve(world, ctx)

      const { toSector, toSource } = sectorFrame(setup, sector)
      const resolved = resolve(world, {
        ...ctx,
        anchors: ctx.anchors.map((a) => applyToPoint(toSector, a)),
        constrain: ctx.constrain && {
          origin: applyToPoint(toSector, ctx.constrain.origin),
          refDirs: ctx.constrain.refDirs.map((d) => applyToVector(toSector, d)),
        },
      })
      const folded = applyToPoint(toSource, resolved.world)
      const exact =
        resolved.snap?.kind === 'endpoint' ? this.#exactSource(folded, ctx.anchors) : null
      return { ...resolved, world: exact ?? folded }
    }
  }

  /**
   * The stored source coordinate a folded point *is* (within {@link EXACT_SOURCE_MM}), by reference,
   * or `null`. Restores bit-identical welding (F-012 FR-1) for an endpoint snap taken on a replica:
   * the candidates are the gesture's own anchors and the document's nodes, which is every coordinate
   * a replica endpoint can be the image of.
   */
  #exactSource(point: Vec2, anchors: readonly Vec2[]): Vec2 | null {
    const tol = EXACT_SOURCE_MM * EXACT_SOURCE_MM
    for (const anchor of anchors) if (distanceSq(anchor, point) <= tol) return anchor
    for (const node of Object.values(this.#host.getDoc().nodes)) {
      if (distanceSq(node.pos, point) <= tol) return node.pos
    }
    return null
  }

  /** The derived replica segments for a source output network (empty when symmetry is off). */
  replicasOf(source: readonly NetworkSegment[]): Segment[] {
    return expandReplicas(source, this.setup) as Segment[]
  }

  /**
   * The source fundamental domain as an angular sector `{ start, span }` from the center (radians),
   * matching where {@link canonicalize} folds points to — so a canvas tint over it marks exactly
   * the region the user draws in. `null` when symmetry is off. Spans: mirror π, double-mirror π/2
   * (opening at `angle + π/2`, the quadrant between the two axes), radial 2π/N, radial + mirror π/N.
   */
  get sourceDomain(): { start: number; span: number } | null {
    const { mode, angle } = this.setup
    switch (mode) {
      case 'none':
        return null
      case 'mirror':
        return { start: angle, span: Math.PI }
      case 'double-mirror':
        return { start: angle + Math.PI / 2, span: Math.PI / 2 }
      case 'radial': {
        const wedge = (2 * Math.PI) / this.count
        return { start: angle, span: this.setup.mirror ? wedge / 2 : wedge }
      }
    }
  }

  /**
   * Mirror a tool's live preview shapes into the replica sectors (F-052), so drawing shows the full
   * symmetric result live — the ghost appears under the cursor in every sector, not just the source
   * — instead of only materialising on commit. Segment previews only (anchor handles stay single,
   * so the cursor never looks duplicated); empty when symmetry is off.
   */
  previewReplicas(shapes: readonly PreviewShape[]): PreviewShape[] {
    if (!this.active) return []
    const replicaTransforms = symmetryTransforms(this.setup).slice(1)
    const out: PreviewShape[] = []
    for (const shape of shapes) {
      if (shape.kind !== 'segment') continue
      for (const t of replicaTransforms) {
        out.push({
          kind: 'segment',
          geometry: transformSymGeometry(t, shape.geometry),
          role: shape.role,
          ghost: shape.ghost,
        })
      }
    }
    return out
  }

  // --- Setup edits (each one undo entry, FR-4) -------------------------------

  /** Switch mode. Turning replication on for the first time seeds a sensible center. */
  setMode(mode: SymmetryMode): void {
    const seedCenter = mode !== 'none' && this.setup.mode === 'none'
    this.#host.execute(
      setSymmetry(seedCenter ? { mode, center: this.#host.defaultCenter() } : { mode }),
    )
  }

  setCount(count: number): void {
    this.#host.execute(setSymmetry({ count: Math.max(2, Math.round(count)) }))
  }

  setMirror(mirror: boolean): void {
    this.#host.execute(setSymmetry({ mirror }))
  }

  /** Set the primary-axis angle from degrees (the panel talks degrees; the model stores radians). */
  setAngleDeg(deg: number): void {
    this.#host.execute(setSymmetry({ angle: (deg * Math.PI) / 180 }))
  }

  setCenter(center: Vec2): void {
    this.#host.execute(setSymmetry({ center }))
  }

  /** The primary-axis angle in degrees, for the panel. */
  get angleDeg(): number {
    return (this.setup.angle * 180) / Math.PI
  }

  // --- Bake (FR-3) -----------------------------------------------------------

  /**
   * Bake the live symmetry into ordinary segments (FR-3): expand the source into replicas with the
   * same transform, weld them into concrete welded segments (coincident endpoints share a node,
   * F-013 — this materializes the seams), and hand them to the one compound `bakeSymmetry` command,
   * which adds them and turns the mode off as a single undo step. A no-op when symmetry is off.
   */
  bake(): void {
    const doc = this.#host.getDoc()
    if (doc.symmetry.mode === 'none') return
    const replicas = expandReplicas(outputSegments(doc), doc.symmetry)
    if (replicas.length === 0) return
    const welded = segmentsFromDrafts(
      replicas.map((r) => ({ geometry: r.geometry, role: r.role })),
      doc.nodes,
    )
    this.#host.execute(bakeSymmetry(welded))
  }

  // --- Canvas axis guides ----------------------------------------------------

  /**
   * The symmetry axes to draw as construction-like guides, as world-space line segments spanning
   * `radius` mm from the center: the mirror axis (or two, for double-mirror) or the radial spokes
   * (2N with a mirror). Empty when symmetry is off.
   */
  axisSegments(radius: number): { a: Vec2; b: Vec2 }[] {
    const { mode, center, angle } = this.setup
    const along = (theta: number, from: number): { a: Vec2; b: Vec2 } => ({
      a: vec2(center.x + from * Math.cos(theta), center.y + from * Math.sin(theta)),
      b: vec2(center.x + radius * Math.cos(theta), center.y + radius * Math.sin(theta)),
    })
    const fullLine = (theta: number) => ({ ...along(theta, -radius) })
    switch (mode) {
      case 'none':
        return []
      case 'mirror':
        return [fullLine(angle)]
      case 'double-mirror':
        return [fullLine(angle), fullLine(angle + Math.PI / 2)]
      case 'radial': {
        const n = this.count
        const spokes = this.setup.mirror ? 2 * n : n
        const step = (2 * Math.PI) / spokes
        const out: { a: Vec2; b: Vec2 }[] = []
        for (let k = 0; k < spokes; k++) out.push(along(angle + k * step, 0))
        return out
      }
    }
  }

  get center(): Vec2 {
    return this.setup.center
  }
}
