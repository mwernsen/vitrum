import { signedArea } from '@vitrum/geometry'

import { buildGraph } from '../pieces/graph'
import { pruneDangling, traceCycles } from '../pieces/faces'
import type { PieceSegment } from '../pieces/types'
import { countPieces } from '../svg/import'
import { healNetwork, type HealSegment } from '../svg/heal'
import type { SegmentDraft } from '../tools/types'

import { binarise, despeckle, fillHoles } from './binarise'
import { pruneSpurs, walkSkeleton } from './skeleton'
import { thin } from './thin'
import type { GreyBitmap, InkMask, TraceGrid, TraceOptions, TraceResult } from './types'
import { vectoriseRun } from './vectorise'

/**
 * The autotrace pipeline (F-059): greyscale pixels in, a healed lead-line network out.
 *
 * preprocess → binarise → despeckle → **thin** → walk → simplify → fit → **heal**. Healing is
 * F-050's `healNetwork` verbatim: a traced scan produces exactly the near-miss junctions, crossings
 * and duplicate segments it was written for, and a second implementation would be a second set of
 * bugs.
 *
 * Deterministic end to end (FR-6): every stage sweeps in a fixed order, no randomness, no iteration
 * over a hash set's insertion order, so the same image and settings always give the same segments.
 */

/** Floors for the stroke-width-derived spur and junction-merge distances, for very thin linework. */
const MIN_SPUR_PX = 4
const MIN_MERGE_PX = 2
/** And ceilings, so a smudged blob cannot make the estimate swallow real geometry. */
const MAX_SPUR_PX = 24
const MAX_MERGE_PX = 16

/** Tolerance (mm) the topology graph clusters coincident endpoints at — F-020's own value. */
const TOPOLOGY_TOL_MM = 0.01

/** Sensible starting settings. The threshold is the one a designer actually reaches for. */
export function defaultTraceOptions(): TraceOptions {
  return {
    thresholdLuma: 100,
    adaptiveRadiusPx: 24,
    adaptiveBias: 12,
    minBlobPx: 150,
    simplifyMm: 0.4,
    fitMm: 0.6,
    healMm: 1.5,
    role: 'lead',
    outerAsBorder: false,
  }
}

export function traceBitmap(
  image: GreyBitmap,
  grid: TraceGrid,
  options: TraceOptions,
): TraceResult {
  const binary = binarise(
    image,
    options.thresholdLuma,
    options.adaptiveRadiusPx,
    options.adaptiveBias,
  )
  const speckSize = Math.max(1, Math.round(options.minBlobPx))
  const cleaned = despeckle(binary, speckSize)
  // The same size knob in both directions: ink specks go, and paper pinholes inside a stroke fill.
  const solid = fillHoles(cleaned.mask, speckSize)
  const skeleton = thin(solid)
  // Both cleanup distances scale with the drawing's own stroke width, estimated as ink area over
  // skeleton length. That is what makes the pipeline work on a fine pen and a fat marker alike: a
  // fixed pixel constant either leaves an X as two junctions plus a stub, or eats short real lines.
  const strokePx = estimateStrokeWidthPx(cleaned.inkPx, skeleton)
  const mergePx = clamp(Math.round(strokePx), MIN_MERGE_PX, MAX_MERGE_PX)
  const spurPx = clamp(strokePx * 1.5, MIN_SPUR_PX, MAX_SPUR_PX)
  const runs = pruneSpurs(walkSkeleton(skeleton, mergePx), spurPx)

  const raw: HealSegment[] = []
  for (const [i, run] of runs.entries()) {
    const geometries = vectoriseRun(run, grid, {
      simplifyMm: options.simplifyMm,
      fitMm: options.fitMm,
      cornerMinArmMm: strokePx * grid.mmPerPx,
    })
    for (const [j, geometry] of geometries.entries()) {
      // Ids are internal scaffolding for healing and the border walk; none of them leaves this
      // function (the document mints its own on merge).
      raw.push({ id: `t${i}_${j}`, geometry, role: options.role })
    }
  }

  const heal = healNetwork(raw, Math.max(options.healMm, 0))
  const border = options.outerAsBorder ? outerContourIds(heal.segments) : new Set<string>()
  const final = heal.segments.map((s) =>
    border.has(s.id) ? ({ ...s, role: 'border' } as HealSegment) : s,
  )

  return {
    segments: final.map(toDraft),
    healed: final.filter((s) => heal.changedIds.has(s.id)).map(toDraft),
    mask: solid,
    pieceCount: countPieces(final),
    summary: {
      inkPx: cleaned.inkPx,
      despeckled: cleaned.removed,
      runs: runs.length,
      snapped: heal.summary.snapped,
      split: heal.summary.split,
      dropped: heal.summary.dropped,
    },
  }
}

/**
 * The drawing's stroke width in pixels: ink area divided by centreline length. A one-pixel skeleton
 * has as many pixels as it is long, so `inkPx / skeletonPx` is the mean width of everything drawn.
 */
function estimateStrokeWidthPx(inkPx: number, skeleton: InkMask): number {
  let skeletonPx = 0
  for (const v of skeleton.data) if (v === 1) skeletonPx++
  if (skeletonPx === 0) return 1
  return Math.max(1, inkPx / skeletonPx)
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function toDraft(segment: HealSegment): SegmentDraft {
  return { geometry: segment.geometry, role: segment.role }
}

/**
 * The ids of the segments on the network's **outermost closed contour**.
 *
 * Reuses F-020's planar graph: its face tracer walks every face with the interior on the left, so
 * bounded faces come out counter-clockwise and each connected component's *unbounded* boundary comes
 * out clockwise. The outermost contour is therefore the clockwise cycle enclosing the most area.
 * Dangling edges are pruned first, or the walk would run out along a stray line and back.
 */
function outerContourIds(segments: readonly HealSegment[]): Set<string> {
  const ids = new Set<string>()
  if (segments.length === 0) return ids
  const pieceSegments: PieceSegment[] = segments.map((s, i) => ({
    id: s.id,
    geometry: s.geometry,
    role: s.role,
    endpoints: [`${i}a`, `${i}b`],
  }))
  const graph = buildGraph(pieceSegments, TOPOLOGY_TOL_MM)
  const edges = pruneDangling(graph)
  if (edges.length === 0) return ids
  const { cw } = traceCycles(graph.vertices.length, edges, graph.segmentsById, TOPOLOGY_TOL_MM)

  let best: (typeof cw)[number] | undefined
  let bestArea = 0
  for (const cycle of cw) {
    const area = Math.abs(signedArea(cycle.ring))
    if (area > bestArea) {
      bestArea = area
      best = cycle
    }
  }
  if (!best) return ids
  for (const span of best.spans) ids.add(span.segmentId)
  return ids
}
