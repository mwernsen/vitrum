import {
  canonicalizeToSource,
  expandReplicas,
  radialCount,
  symmetryTransforms,
  transformSymGeometry,
  type NetworkSegment,
  type PreviewShape,
  type SymmetryMode,
  type SymmetrySetup,
} from '@vitrum/core'
import { vec2, type Vec2 } from '@vitrum/geometry'
import {
  bakeSymmetry,
  outputSegments,
  segmentsFromDrafts,
  setSymmetry,
  type Command,
  type Project,
  type Segment,
} from '@vitrum/model'

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
 * - {@link canonicalize} folds a pointer into the source sector; the shell composes it in front of
 *   the F-012 resolver, so drawing/editing is confined to the source (Decision §1 / FR-5) with no
 *   change to the tool or `ResolvedPoint` contracts.
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
