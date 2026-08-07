import { arcStart, arcEnd, curveLength, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { detectPieces } from '../pieces/detect'
import type { PieceSegment } from '../pieces/types'
import type { SegmentDraft } from '../tools/types'

import { binarise, despeckle } from './binarise'
import { traceGridFor } from './raster'
import { pruneSpurs, walkSkeleton } from './skeleton'
import { thin } from './thin'
import { defaultTraceOptions, traceBitmap } from './trace'
import type { GreyBitmap, InkMask, TraceGrid, TraceOptions } from './types'

/**
 * The synthetic fixtures F-059's acceptance criteria call for: a thick straight stroke (FR-1,
 * centreline not outline) and a drawn T and X (FR-2, junctions survive). Generated in code so the
 * intent is legible from the test, per the fixtures README.
 */

// --- Drawing helpers --------------------------------------------------------------------------

interface Canvas {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

function blank(width: number, height: number): Canvas {
  const data = new Uint8Array(width * height)
  data.fill(235) // paper
  return { width, height, data }
}

/** Stamp a `widthPx`-wide near-black stroke from `a` to `b` (a marker line, not a pencil one). */
function stroke(canvas: Canvas, a: Vec2, b: Vec2, widthPx: number, luma = 30): void {
  const half = widthPx / 2
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - half - 1))
  const maxX = Math.min(canvas.width - 1, Math.ceil(Math.max(a.x, b.x) + half + 1))
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - half - 1))
  const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(a.y, b.y) + half + 1))
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const t =
        lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / lenSq))
      const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
      if (d <= half) canvas.data[y * canvas.width + x] = luma
    }
  }
}

/** Stamp an annulus: a clean drawn circle of stroke width `widthPx` (no stamping seams). */
function ring(canvas: Canvas, c: Vec2, radius: number, widthPx: number, luma = 30): void {
  const half = widthPx / 2
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y)
      if (Math.abs(d - radius) <= half) canvas.data[y * canvas.width + x] = luma
    }
  }
}

function bitmap(canvas: Canvas): GreyBitmap {
  return { width: canvas.width, height: canvas.height, data: canvas.data }
}

/** A grid where one pixel is exactly one millimetre, so pixel maths reads directly as mm. */
function unitGrid(canvas: Canvas): TraceGrid {
  return { width: canvas.width, height: canvas.height, origin: { x: 0, y: 0 }, mmPerPx: 1 }
}

function options(overrides: Partial<TraceOptions> = {}): TraceOptions {
  return {
    ...defaultTraceOptions(),
    // Synthetic strokes are small and crisp; a 150 px blob floor would delete them.
    minBlobPx: 20,
    adaptiveRadiusPx: 8,
    // These fixtures are drawn at 1 px = 1 mm so pixel coordinates read straight as millimetres —
    // a deliberately coarse "scan". The geometric tolerances are scaled to match, otherwise the
    // ±0.5 px staircase of a rasterised diagonal reads as real curvature.
    simplifyMm: 0.8,
    fitMm: 1.2,
    ...overrides,
  }
}

function endpointsOf(draft: SegmentDraft): readonly [Vec2, Vec2] {
  const g = draft.geometry
  if (g.kind === 'line') return [g.a, g.b]
  if (g.kind === 'cubic') return [g.p0, g.p3]
  return [arcStart(g), arcEnd(g)]
}

function toPieceSegments(drafts: readonly SegmentDraft[]): PieceSegment[] {
  return drafts.map((d, i) => ({
    id: `s${i}`,
    geometry: d.geometry,
    role: d.role,
    endpoints: [`${i}a`, `${i}b`],
  }))
}

function inkCount(mask: InkMask): number {
  let n = 0
  for (const v of mask.data) if (v === 1) n++
  return n
}

// --- FR-1: centreline, not outline -----------------------------------------------------------

describe('FR-1 centreline, not outline', () => {
  it('traces a 6 px-wide straight stroke to one segment on its centre axis', () => {
    const canvas = blank(120, 40)
    stroke(canvas, { x: 20, y: 20 }, { x: 100, y: 20 }, 6)
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())

    // One line, not two edges of a loop around the stroke — this is the whole point of thinning.
    expect(result.segments).toHaveLength(1)
    const [a, b] = endpointsOf(result.segments[0]!)
    // The stroke's centre axis is y = 20; both endpoints sit on it (within half a pixel).
    expect(Math.abs(a.y - 20)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(b.y - 20)).toBeLessThanOrEqual(0.5)
    // And it spans nearly the drawn length (thinning nibbles a couple of pixels off each blunt end).
    expect(curveLength(result.segments[0]!.geometry)).toBeGreaterThan(70)
    expect(curveLength(result.segments[0]!.geometry)).toBeLessThanOrEqual(80)
  })

  it('gives one centreline whatever the stroke width', () => {
    for (const width of [3, 6, 11, 16]) {
      const canvas = blank(120, 60)
      stroke(canvas, { x: 20, y: 30 }, { x: 100, y: 30 }, width)
      const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())
      expect(result.segments, `stroke width ${width}`).toHaveLength(1)
      const [a] = endpointsOf(result.segments[0]!)
      expect(Math.abs(a.y - 30), `stroke width ${width}`).toBeLessThanOrEqual(1)
    }
  })

  it('thins a solid block to a one-pixel-wide skeleton', () => {
    const canvas = blank(60, 60)
    stroke(canvas, { x: 12, y: 30 }, { x: 48, y: 30 }, 14)
    const mask = despeckle(binarise(bitmap(canvas), 110, 8, 12), 20).mask
    const before = inkCount(mask)
    const after = inkCount(thin(mask))
    expect(before).toBeGreaterThan(400)
    // A 36×14 block reduces to a ~36 px line: an order of magnitude fewer pixels.
    expect(after).toBeLessThan(before / 5)
  })
})

// --- FR-2: junctions survive ------------------------------------------------------------------

describe('FR-2 junctions survive', () => {
  /** Distance from `p` to the nearest traced endpoint. */
  function nearestEndpoint(drafts: readonly SegmentDraft[], p: Vec2): number {
    let best = Infinity
    for (const d of drafts) {
      for (const e of endpointsOf(d)) {
        best = Math.min(best, Math.hypot(e.x - p.x, e.y - p.y))
      }
    }
    return best
  }

  it('breaks a drawn T into three branches meeting at one point', () => {
    const canvas = blank(140, 100)
    stroke(canvas, { x: 20, y: 30 }, { x: 120, y: 30 }, 6) // the bar
    stroke(canvas, { x: 70, y: 30 }, { x: 70, y: 90 }, 6) // the stem
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())

    expect(result.segments).toHaveLength(3)
    // All three meet at the drawn junction, not near it.
    expect(nearestEndpoint(result.segments, { x: 70, y: 30 })).toBeLessThanOrEqual(2)
    const junction = { x: 70, y: 30 }
    const touching = result.segments.filter((d) =>
      endpointsOf(d).some((e) => Math.hypot(e.x - junction.x, e.y - junction.y) <= 2),
    )
    expect(touching).toHaveLength(3)
  })

  it('breaks a drawn X into four branches and reports no dangling or near-miss at the crossing', () => {
    const canvas = blank(140, 140)
    stroke(canvas, { x: 20, y: 20 }, { x: 120, y: 120 }, 6)
    stroke(canvas, { x: 120, y: 20 }, { x: 20, y: 120 }, 6)
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())

    expect(result.segments).toHaveLength(4)
    const centre = { x: 70, y: 70 }
    const touching = result.segments.filter((d) =>
      endpointsOf(d).some((e) => Math.hypot(e.x - centre.x, e.y - centre.y) <= 3),
    )
    expect(touching).toHaveLength(4)

    // The only diagnostics are the four genuinely free ends of the X; nothing at the crossing.
    const { diagnostics } = detectPieces(toPieceSegments(result.segments))
    expect(diagnostics.filter((d) => d.kind === 'near-miss')).toHaveLength(0)
    expect(diagnostics.filter((d) => d.kind === 'duplicate-segment')).toHaveLength(0)
    for (const d of diagnostics) {
      expect(d.kind).toBe('dangling-end')
      expect(Math.hypot(d.at.x - centre.x, d.at.y - centre.y)).toBeGreaterThan(30)
    }
  })

  it('closes a drawn rectangle into exactly one detected piece with no diagnostics', () => {
    const canvas = blank(160, 120)
    const corners: Vec2[] = [
      { x: 20, y: 20 },
      { x: 140, y: 20 },
      { x: 140, y: 100 },
      { x: 20, y: 100 },
    ]
    for (let i = 0; i < 4; i++) stroke(canvas, corners[i]!, corners[(i + 1) % 4]!, 6)
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())

    expect(result.pieceCount).toBe(1)
    const { diagnostics } = detectPieces(toPieceSegments(result.segments))
    expect(diagnostics).toEqual([])
  })

  it('detects the two regions of a rectangle split by a bar', () => {
    const canvas = blank(160, 120)
    const corners: Vec2[] = [
      { x: 20, y: 20 },
      { x: 140, y: 20 },
      { x: 140, y: 100 },
      { x: 20, y: 100 },
    ]
    for (let i = 0; i < 4; i++) stroke(canvas, corners[i]!, corners[(i + 1) % 4]!, 6)
    stroke(canvas, { x: 80, y: 20 }, { x: 80, y: 100 }, 6)
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())
    expect(result.pieceCount).toBe(2)
  })
})

// --- Closed loops, annotations, determinism ----------------------------------------------------

describe('trace pipeline', () => {
  it('traces a drawn circle as a closed loop that detects as one piece', () => {
    const canvas = blank(140, 140)
    ring(canvas, { x: 70, y: 70 }, 50, 5)
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())
    expect(result.pieceCount).toBe(1)
  })

  it('keeps a mid-grey pencil annotation out at the recommended threshold (FR-8)', () => {
    const canvas = blank(160, 120)
    for (let i = 0; i < 4; i++) {
      const corners: Vec2[] = [
        { x: 20, y: 20 },
        { x: 140, y: 20 },
        { x: 140, y: 100 },
        { x: 20, y: 100 },
      ]
      stroke(canvas, corners[i]!, corners[(i + 1) % 4]!, 6)
    }
    // A pencil "1" in the middle: mid-grey (luma 150), as tall as a short lead segment, so no
    // size filter could tell it from geometry — only the luminance threshold can.
    stroke(canvas, { x: 80, y: 45 }, { x: 80, y: 75 }, 4, 150)
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())

    expect(result.pieceCount).toBe(1)
    // Nothing traced inside the annotation's box.
    for (const d of result.segments) {
      for (const e of endpointsOf(d)) {
        const inside = e.x > 70 && e.x < 90 && e.y > 40 && e.y < 80
        expect(inside).toBe(false)
      }
    }
    // Raising the threshold past the pencil does pick it up — the control is what separates them.
    const greedy = traceBitmap(bitmap(canvas), unitGrid(canvas), options({ thresholdLuma: 190 }))
    expect(greedy.segments.length).toBeGreaterThan(result.segments.length)
  })

  it('is deterministic for the same image and settings (FR-6)', () => {
    const canvas = blank(140, 100)
    stroke(canvas, { x: 20, y: 30 }, { x: 120, y: 30 }, 6)
    stroke(canvas, { x: 70, y: 30 }, { x: 70, y: 90 }, 6)
    const a = traceBitmap(bitmap(canvas), unitGrid(canvas), options())
    const b = traceBitmap(bitmap(canvas), unitGrid(canvas), options())
    expect(b.segments).toEqual(a.segments)
    expect(b.summary).toEqual(a.summary)
    expect(b.pieceCount).toEqual(a.pieceCount)
  })

  it('lands geometry at true scale through the grid mapping (FR-3)', () => {
    // 2 px per mm, offset 100 mm right and 50 mm down: a stroke drawn 80 px long is 40 mm.
    const canvas = blank(120, 40)
    stroke(canvas, { x: 20, y: 20 }, { x: 100, y: 20 }, 6)
    const grid: TraceGrid = {
      width: canvas.width,
      height: canvas.height,
      origin: { x: 100, y: 50 },
      mmPerPx: 0.5,
    }
    const result = traceBitmap(bitmap(canvas), grid, options())
    expect(result.segments).toHaveLength(1)
    const [a] = endpointsOf(result.segments[0]!)
    expect(Math.abs(a.y - (50 + 20 * 0.5))).toBeLessThanOrEqual(0.5)
    const length = curveLength(result.segments[0]!.geometry)
    // 80 px at 0.5 mm/px = 40 mm, less the couple of pixels thinning takes off each end.
    expect(length).toBeGreaterThan(35)
    expect(length).toBeLessThanOrEqual(40)
  })

  it('finds nothing in a blank sheet', () => {
    const canvas = blank(80, 80)
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())
    expect(result.segments).toEqual([])
    expect(result.pieceCount).toBe(0)
    expect(result.summary.inkPx).toBe(0)
  })

  it('emits no ids — the document mints its own on merge', () => {
    const canvas = blank(120, 40)
    stroke(canvas, { x: 20, y: 20 }, { x: 100, y: 20 }, 6)
    const result = traceBitmap(bitmap(canvas), unitGrid(canvas), options())
    for (const draft of result.segments) {
      expect(Object.keys(draft).sort()).toEqual(['geometry', 'role'])
    }
  })
})

// --- Skeleton walking in isolation -------------------------------------------------------------

describe('walkSkeleton', () => {
  function maskOf(canvas: Canvas): InkMask {
    return thin(despeckle(binarise(bitmap(canvas), 110, 8, 12), 20).mask)
  }

  it('finds one run with two free ends for a lone stroke', () => {
    const canvas = blank(100, 40)
    stroke(canvas, { x: 15, y: 20 }, { x: 85, y: 20 }, 5)
    const runs = pruneSpurs(walkSkeleton(maskOf(canvas)), 4)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.closed).toBe(false)
    expect(runs[0]!.startsAtJunction).toBe(false)
    expect(runs[0]!.endsAtJunction).toBe(false)
  })

  it('finds three runs sharing a junction for a T', () => {
    const canvas = blank(140, 100)
    stroke(canvas, { x: 20, y: 30 }, { x: 120, y: 30 }, 5)
    stroke(canvas, { x: 70, y: 30 }, { x: 70, y: 90 }, 5)
    const runs = pruneSpurs(walkSkeleton(maskOf(canvas)), 4)
    expect(runs).toHaveLength(3)
    expect(runs.filter((r) => r.startsAtJunction || r.endsAtJunction)).toHaveLength(3)
  })

  it('reports a lone ring as a closed run whose first point repeats last', () => {
    const canvas = blank(120, 120)
    ring(canvas, { x: 60, y: 60 }, 40, 5)
    const runs = pruneSpurs(walkSkeleton(maskOf(canvas)), 4)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.closed).toBe(true)
    expect(runs[0]!.points[0]).toEqual(runs[0]!.points[runs[0]!.points.length - 1])
  })
})

describe('traceGridFor', () => {
  it('covers the quad at the requested resolution', () => {
    const grid = traceGridFor(
      [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 70 },
        { x: 10, y: 70 },
      ],
      0.25,
    )
    expect(grid.origin).toEqual({ x: 10, y: 20 })
    expect(grid.mmPerPx).toBe(0.25)
    expect(grid.width).toBe(400)
    expect(grid.height).toBe(200)
  })

  it('coarsens rather than crops when the cap is hit', () => {
    const grid = traceGridFor(
      [
        { x: 0, y: 0 },
        { x: 2000, y: 0 },
        { x: 2000, y: 1000 },
        { x: 0, y: 1000 },
      ],
      0.1,
      500,
    )
    expect(grid.width).toBe(500)
    expect(grid.height).toBe(250)
    expect(grid.mmPerPx).toBeCloseTo(4, 6)
  })

  it('rejects a non-positive resolution', () => {
    expect(() =>
      traceGridFor(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        0,
      ),
    ).toThrow(/mmPerPx/)
  })
})
