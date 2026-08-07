import { flattenCurve, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { detectPieces } from '../pieces/detect'
import type { PieceSegment } from '../pieces/types'
import type { SegmentDraft } from '../tools/types'

import rectifiedPng from './fixtures/cartoon-rectified.png?inline'
import { decodeDataUrl } from './fixtures/dataUrl'
import { decodeGreyPng } from './fixtures/png'
import { defaultTraceOptions, traceBitmap } from './trace'
import type { TraceGrid, TraceOptions, TraceResult } from './types'

/**
 * The committed reference cartoon (F-059 FR-3, FR-4, FR-6, FR-8).
 *
 * `cartoon-photo-workbench.jpg` is the photograph Mathieu took at his bench; `cartoon-rectified.png`
 * is that photo after the four-corner correction and crop F-051 performs before the trace ever runs
 * (reproducible with `fixtures/rectify.py` — see the fixtures README). The rectified raster is what
 * the pipeline takes, so it is what these tests drive: the perspective correction is F-051's job and
 * has its own tests.
 *
 * Everything awkward about the photo survives rectification and is exercised here: pencil piece
 * numbers and Dutch colour notes, graphite smudging, faint construction lines, and an unevenly
 * exposed, worn sheet whose own cut edge reads as ink.
 */

/** The sheet's assumed physical size. Nominal — the trace's mm scale comes from F-051's calibration. */
const SHEET_MM = 300
/** The fixture is the sheet at its own resolution (see `rectify.py`): 980 px, ~6 px of marker stroke. */
const PX = 980
const MM_PER_PX = SHEET_MM / PX

const grid: TraceGrid = {
  width: PX,
  height: PX,
  origin: { x: 0, y: 0 },
  mmPerPx: MM_PER_PX,
}

// Decoded once: inflating a 980 × 980 PNG for every test is pure overhead.
const decoded = decodeGreyPng(decodeDataUrl(rectifiedPng))

/** Traces with the shipped defaults. Memoised — most tests want exactly this result. */
let cached: TraceResult | undefined
function traced(): TraceResult {
  cached ??= traceBitmap(decoded, grid, defaultTraceOptions())
  return cached
}

function trace(overrides: Partial<TraceOptions> = {}): TraceResult {
  return traceBitmap(decoded, grid, { ...defaultTraceOptions(), ...overrides })
}

function toPieceSegments(drafts: readonly SegmentDraft[]): PieceSegment[] {
  return drafts.map((d, i) => ({
    id: `s${i}`,
    geometry: d.geometry,
    role: d.role,
    endpoints: [`${i}a`, `${i}b`],
  }))
}

/** Every traced point, flattened finely enough that a segment cannot skip over a small box. */
function tracedPoints(drafts: readonly SegmentDraft[]): Vec2[] {
  const out: Vec2[] = []
  for (const d of drafts) out.push(...flattenCurve(d.geometry, 0.2))
  return out
}

/**
 * A segment's *defining* points, in order — not a flattening. Flattening is adaptive, so the same
 * curve at twice the size yields more points; the control points are what scale exactly.
 */
function keyPoints(draft: SegmentDraft): Vec2[] {
  const g = draft.geometry
  if (g.kind === 'line') return [g.a, g.b]
  if (g.kind === 'cubic') return [g.p0, g.p1, g.p2, g.p3]
  return [g.center]
}

/**
 * Hand-listed boxes around the hand annotations, in **rectified pixels** (read off the fixture, then
 * checked by drawing them back over it). The pencil piece numbers 11, 5, 10, 6, 8, 7, 1, 2, 3, the
 * "5000" dimension note, and the Dutch colour notes "Oranje lucht" (orange sky), "dakpannen" (roof
 * tiles), "gras" (grass) and "(vet)".
 */
const ANNOTATIONS: ReadonlyArray<{
  name: string
  box: readonly [number, number, number, number]
}> = [
  { name: 'Oranje lucht', box: [129, 126, 299, 170] },
  { name: '11', box: [397, 75, 436, 124] },
  { name: '5 (dakpannen number)', box: [81, 358, 126, 415] },
  { name: 'dakpannen', box: [55, 436, 165, 480] },
  { name: '10', box: [436, 371, 475, 410] },
  { name: '6 (sun number)', box: [763, 279, 812, 325] },
  { name: '8 (gras number)', box: [80, 610, 119, 655] },
  { name: 'gras', box: [152, 623, 222, 668] },
  { name: '7', box: [636, 616, 674, 660] },
  { name: '1', box: [139, 816, 183, 867] },
  { name: '5000', box: [210, 803, 294, 854] },
  { name: '2', box: [520, 823, 558, 873] },
  { name: '3', box: [855, 818, 900, 875] },
  { name: '(vet)', box: [107, 881, 209, 925] },
]

function insideAnnotation(p: Vec2): string | null {
  const px = p.x / MM_PER_PX
  const py = p.y / MM_PER_PX
  for (const { name, box } of ANNOTATIONS) {
    if (px >= box[0] && px <= box[2] && py >= box[1] && py <= box[3]) return name
  }
  return null
}

/** Annotation names any traced segment passes through. */
function annotationHits(result: TraceResult): string[] {
  return [
    ...new Set(
      tracedPoints(result.segments)
        .map((p) => insideAnnotation(p))
        .filter((name): name is string => name !== null),
    ),
  ]
}

function piecesOf(result: TraceResult) {
  return detectPieces(toPieceSegments(result.segments)).pieces
}

/** A region big enough to be a piece of glass rather than a two-pixel sliver. */
const SUBSTANTIVE_MM2 = 500

describe('reference cartoon', () => {
  it('decodes the committed rectified raster at the sheet resolution', () => {
    expect(decoded.width).toBe(PX)
    expect(decoded.height).toBe(PX)
  })

  it('traces the marker linework to a stable segment count', () => {
    const result = traced()
    // Exact, because the whole point of a committed fixture is that a change in the pipeline's
    // output is something a reviewer sees rather than something that drifts.
    expect(result.segments).toHaveLength(51)
    expect(result.summary.runs).toBe(43)
    // The despeckle pass drops the pencil marks' darkest cores and the graphite dust: over a hundred
    // small blobs, none of them geometry.
    expect(result.summary.despeckled).toBeGreaterThan(100)
  })

  it('finds the six regions the marker linework closes (FR-4)', () => {
    const result = traced()
    const pieces = piecesOf(result)
    expect(pieces).toHaveLength(6)
    expect(result.pieceCount).toBe(6)

    // Every one is a real region, not a sliver: the smallest is over a fifth of the largest.
    const areas = pieces.map((p) => p.area).sort((a, b) => b - a)
    expect(areas[areas.length - 1]! / areas[0]!).toBeGreaterThan(0.2)

    // They are where the drawing says they are. Centroids in rectified pixels, matching the pencil
    // numbers on the sheet: 5 (dakpannen), 8 (gras), 10, 7, 2, and the narrow bay right of 7.
    const centroids = pieces
      .map((p) => ({
        x: Math.round(p.centroid.x / MM_PER_PX),
        y: Math.round(p.centroid.y / MM_PER_PX),
      }))
      .sort((a, b) => a.x - b.x || a.y - b.y)
    const expected = [
      { x: 150, y: 405 }, // 5 — dakpannen
      { x: 165, y: 654 }, // 8 — gras
      { x: 427, y: 411 }, // 10
      { x: 509, y: 639 }, // 7
      { x: 602, y: 840 }, // 2
      { x: 770, y: 778 }, // the bay between the two right-hand verticals
    ]
    for (const [i, want] of expected.entries()) {
      const got = centroids[i]!
      expect(
        Math.hypot(got.x - want.x, got.y - want.y),
        `piece ${i} at ${got.x},${got.y}`,
      ).toBeLessThan(8)
    }
  })

  /**
   * **Six, not eleven — and mostly a property of the cartoon, not of the trace.**
   *
   * Mathieu numbered the pieces by hand and the numbering runs to at least 11, so FR-4 aims at that.
   * The trace closes 6. The shortfall breaks down as:
   *
   * - Four or five regions are **never closed on the sheet**, because their outer edge *is* the panel
   *   border and the panel border is not drawn: the top strip ("Oranje lucht", 11) has no line along
   *   the top, the right-hand column (3 and its neighbour) has no right edge, and the bottom-left
   *   region (1) has no line along its bottom.
   * - The sun (6) **is** drawn as a closed circle, but the photograph does not contain all of it: the
   *   sheet is folded, and the circle's right-hand arc lies under the fold, surviving only as a faint
   *   grey imprint at exactly the luminance of the pencil annotations. Recovering it would import the
   *   annotations with it, which FR-8 forbids.
   *
   * The two tests below pin that explanation down: adding the sheet outline closes exactly one more
   * region (the whole open remainder as a single face, not five), and raising the threshold as far as
   * the pencil never adds a substantive region. So no amount of tuning recovers them — completing the
   * panel border is an edit the designer makes after the trace, which is what F-059 is for. The
   * target count needs Mathieu's sign-off.
   */
  it('is short of the hand numbering because the panel border is the sheet edge, not a drawn line', () => {
    const result = traced()
    const withSheetOutline: SegmentDraft[] = [...result.segments]
    const corners: Vec2[] = [
      { x: 0, y: 0 },
      { x: SHEET_MM, y: 0 },
      { x: SHEET_MM, y: SHEET_MM },
      { x: 0, y: SHEET_MM },
    ]
    for (let i = 0; i < 4; i++) {
      withSheetOutline.push({
        geometry: { kind: 'line', a: corners[i]!, b: corners[(i + 1) % 4]! },
        role: 'border',
      })
    }
    const { pieces } = detectPieces(toPieceSegments(withSheetOutline))
    expect(pieces).toHaveLength(7)
    // The extra face is the whole open remainder, far larger than any traced region.
    const areas = pieces.map((p) => p.area).sort((a, b) => b - a)
    expect(areas[0]! / areas[1]!).toBeGreaterThan(5)
  })

  it('cannot buy the missing regions with a higher threshold — only slivers appear', () => {
    const base = piecesOf(traced()).filter((p) => p.area >= SUBSTANTIVE_MM2)
    expect(base).toHaveLength(6)
    for (const thresholdLuma of [120, 130]) {
      const greedy = piecesOf(trace({ thresholdLuma }))
      const substantive = greedy.filter((p) => p.area >= SUBSTANTIVE_MM2)
      // Never *more* real regions, however much extra ink the threshold lets in — the open ones are
      // open on the sheet. (It can be fewer: past the pencil, smudges start bridging real lines.)
      expect(substantive.length, `threshold ${thresholdLuma}`).toBeLessThanOrEqual(6)
      // And everything the extra ink does add is a sliver.
      for (const p of greedy) {
        if (p.area < SUBSTANTIVE_MM2) expect(p.area).toBeLessThan(SUBSTANTIVE_MM2)
      }
    }
  }, 30000)

  it('keeps every hand annotation out of the geometry (FR-8)', () => {
    expect(annotationHits(traced())).toEqual([])
  })

  it('does pick the annotations up once the threshold passes the pencil — the control that matters', () => {
    // Proof that luminance is what separates them: raise the ceiling past mid-grey and the numbers and
    // colour notes start becoming geometry. A blob-size filter could not tell them apart — a pencil
    // "10" is about as large as a short lead segment, and at this resolution it is well past the
    // despeckle floor, so it is the threshold and nothing else doing the work.
    const greedy = trace({ thresholdLuma: 150 })
    expect(annotationHits(greedy).length).toBeGreaterThan(0)
    expect(greedy.segments.length).toBeGreaterThan(traced().segments.length * 2)
  }, 30000)

  it('is deterministic on the real fixture (FR-6)', () => {
    const a = trace()
    const b = trace()
    expect(b.segments).toEqual(a.segments)
    expect(b.summary).toEqual(a.summary)
    expect(b.pieceCount).toBe(a.pieceCount)
  }, 30000)

  it('lands the trace at the calibrated scale (FR-3)', () => {
    const result = traced()
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of tracedPoints(result.segments)) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    // Everything traced sits on the calibrated sheet — within a pixel of its edges, since a fitted
    // curve may bow a hair past the outermost pixel centre.
    expect(minX).toBeGreaterThanOrEqual(-MM_PER_PX)
    expect(minY).toBeGreaterThanOrEqual(-MM_PER_PX)
    expect(maxX).toBeLessThanOrEqual(SHEET_MM + MM_PER_PX)
    expect(maxY).toBeLessThanOrEqual(SHEET_MM + MM_PER_PX)
    // The drawing occupies most of it (the right-hand fold carries no linework).
    expect(maxX - minX).toBeGreaterThan(SHEET_MM * 0.85)
    expect(maxY - minY).toBeGreaterThan(SHEET_MM * 0.9)

    // And the mm are the calibration's, not a guessed DPI: the same pixels calibrated to twice the
    // size trace to exactly twice the geometry (FR-3 allows 1%; this is exact to nine decimals).
    // Note the geometric tolerances are in mm too, so they double with the calibration — which is
    // what makes the two traces similar rather than merely close.
    const doubled = traceBitmap(
      decoded,
      { ...grid, mmPerPx: MM_PER_PX * 2 },
      {
        ...defaultTraceOptions(),
        simplifyMm: defaultTraceOptions().simplifyMm * 2,
        fitMm: defaultTraceOptions().fitMm * 2,
        healMm: defaultTraceOptions().healMm * 2,
      },
    )
    expect(doubled.segments).toHaveLength(result.segments.length)
    for (const [i, draft] of result.segments.entries()) {
      const from = keyPoints(draft)
      const to = keyPoints(doubled.segments[i]!)
      expect(to).toHaveLength(from.length)
      for (const [j, p] of from.entries()) {
        expect(to[j]!.x).toBeCloseTo(p.x * 2, 9)
        expect(to[j]!.y).toBeCloseTo(p.y * 2, 9)
      }
    }
  }, 30000)

  it('gives the outermost contour the border role when asked', () => {
    const plain = traced()
    expect(plain.segments.some((s) => s.role === 'border')).toBe(false)
    const bordered = trace({ outerAsBorder: true })
    const borderSegments = bordered.segments.filter((s) => s.role === 'border')
    expect(borderSegments.length).toBeGreaterThan(0)
    // A guess at intent, so it never covers the whole network — only the outer walk.
    expect(borderSegments.length).toBeLessThan(bordered.segments.length)
  })

  it('previews the binarised sheet at the traced resolution', () => {
    const result = traced()
    expect(result.mask.width).toBe(PX)
    expect(result.mask.height).toBe(PX)
    let ink = 0
    for (const v of result.mask.data) if (v === 1) ink++
    // A few percent of the sheet is marker; anything near half would mean the threshold flooded.
    expect(ink / result.mask.data.length).toBeGreaterThan(0.02)
    expect(ink / result.mask.data.length).toBeLessThan(0.1)
  })
})
