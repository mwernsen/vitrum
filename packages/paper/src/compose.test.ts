import type { BBox } from '@vitrum/geometry'
import { vec2, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { clipPolyline } from './clip'
import { buildPrintDocument } from './compose'
import { forEachOp, type DrawOp, type PageContent, type PdfDoc } from './page'
import {
  DEFAULT_INCLUDE,
  DEFAULT_MARGIN_MM,
  DEFAULT_OVERLAP_MM,
  type PrintOptions,
  type PrintScene,
} from './scene'
import { computeTiling } from './tiling'
import { paperSize } from './units'

const A4 = paperSize('a4')!
const BOUNDS: BBox = { min: vec2(0, 0), max: vec2(500, 200) }

function scene(overrides: Partial<PrintScene> = {}): PrintScene {
  return {
    contentBounds: BOUNDS,
    // One long horizontal lead line spanning the whole panel, crossing every vertical seam.
    network: [{ points: [vec2(0, 100), vec2(500, 100)], role: 'lead', widthMm: 1.2 }],
    cutLines: [],
    pieces: [
      {
        ring: [vec2(20, 20), vec2(120, 20), vec2(120, 120), vec2(20, 120)],
        holeRings: [],
        fillColor: '#cc3344',
        label: 'A1',
        labelAt: vec2(70, 70),
        labelRadiusMm: 20,
      },
    ],
    reinforcements: [],
    legend: [{ code: 'A', name: 'Ruby', manufacturer: 'Spectrum', color: '#cc3344', count: 1 }],
    ...overrides,
  }
}

function options(overrides: Partial<PrintOptions> = {}): PrintOptions {
  return {
    paper: A4,
    orientation: 'portrait',
    marginMm: DEFAULT_MARGIN_MM,
    overlapMm: DEFAULT_OVERLAP_MM,
    content: 'cartoon',
    include: DEFAULT_INCLUDE,
    projectName: 'Test panel',
    ...overrides,
  }
}

/** All polyline ops inside a page's first top-level content group (excludes margin chrome). */
function contentPolylines(page: PageContent): Vec2[][] {
  const group = page.ops.find((o): o is Extract<DrawOp, { kind: 'group' }> => o.kind === 'group')
  const out: Vec2[][] = []
  if (group) forEachOp(group.ops, (op) => op.kind === 'polyline' && out.push([...op.points]))
  return out
}

/** Content polylines with their stroke, so the dashed reference overlays can be picked out. */
function contentStrokes(page: PageContent): { points: Vec2[]; dash?: readonly number[] }[] {
  const group = page.ops.find((o): o is Extract<DrawOp, { kind: 'group' }> => o.kind === 'group')
  const out: { points: Vec2[]; dash?: readonly number[] }[] = []
  if (group) {
    forEachOp(
      group.ops,
      (op) =>
        op.kind === 'polyline' && out.push({ points: [...op.points], dash: op.stroke.dashMm }),
    )
  }
  return out
}

/** The runs drawn with a given dash pattern (the overlays' identifying mark on a mono sheet). */
function dashed(page: PageContent, pattern: readonly number[]): Vec2[][] {
  return contentStrokes(page)
    .filter((r) => r.dash?.length === pattern.length && r.dash.every((v, i) => v === pattern[i]))
    .map((r) => r.points)
}

function textStrings(page: PageContent): string[] {
  const out: string[] = []
  forEachOp(page.ops, (op) => {
    if (op.kind === 'text') out.push(op.text)
  })
  return out
}

describe('buildPrintDocument', () => {
  it('emits an overview page plus one page per tile, all at the sheet size', () => {
    const t = computeTiling({
      contentBounds: BOUNDS,
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginMm: DEFAULT_MARGIN_MM,
      overlapMm: DEFAULT_OVERLAP_MM,
    })
    const doc = buildPrintDocument(scene(), options())
    expect(doc.pages).toHaveLength(1 + t.tiles.length)
    expect(doc.pages[0]!.label).toBe('overview')
    for (const page of doc.pages) {
      expect(page.widthMm).toBeCloseTo(210, 9)
      expect(page.heightMm).toBeCloseTo(297, 9)
    }
  })

  it('omits the overview page when not requested', () => {
    const doc = buildPrintDocument(
      scene(),
      options({ include: { ...DEFAULT_INCLUDE, overviewMap: false } }),
    )
    expect(doc.pages[0]!.label).toBe('A1')
  })

  it('FR-3: every part of the panel content appears on a tile (nothing clipped away)', () => {
    // Isolate the network line by disabling marks, then reconstruct its world extent across tiles.
    const opts = options({ include: { ...DEFAULT_INCLUDE, alignmentMarks: false } })
    const t = computeTiling({
      contentBounds: BOUNDS,
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginMm: opts.marginMm,
      overlapMm: opts.overlapMm,
    })
    const doc = buildPrintDocument(scene(), opts)
    let minX = Infinity
    let maxX = -Infinity
    doc.pages.slice(1).forEach((page, i) => {
      const tile = t.tiles[i]!
      for (const run of contentPolylines(page)) {
        for (const p of run) {
          const worldX = p.x - opts.marginMm + tile.worldRect.x
          minX = Math.min(minX, worldX)
          maxX = Math.max(maxX, worldX)
        }
      }
    })
    expect(minX).toBeCloseTo(0, 6)
    expect(maxX).toBeCloseTo(500, 6)
  })

  it('FR-2: the overlap band geometry is identical on both adjacent tiles', () => {
    const opts = options({ include: { ...DEFAULT_INCLUDE, alignmentMarks: false } })
    const t = computeTiling({
      contentBounds: BOUNDS,
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginMm: opts.marginMm,
      overlapMm: opts.overlapMm,
    })
    const doc = buildPrintDocument(scene(), opts)
    const tileA = t.tiles.find((x) => x.col === 0 && x.row === 0)!
    const tileB = t.tiles.find((x) => x.col === 1 && x.row === 0)!
    const pageA = doc.pages[1 + t.tiles.indexOf(tileA)]!
    const pageB = doc.pages[1 + t.tiles.indexOf(tileB)]!

    // Reconstruct each page's content to world space, then re-clip to the shared band. The band
    // geometry must be bit-for-bit identical on both sheets (that is what makes them tape together).
    const band = {
      x: tileB.worldRect.x,
      y: BOUNDS.min.y - 10,
      w: tileA.worldRect.x + tileA.worldRect.w - tileB.worldRect.x,
      h: BOUNDS.max.y - BOUNDS.min.y + 20,
    }
    const bandGeometry = (page: PageContent, tile: typeof tileA): Vec2[][] =>
      contentPolylines(page).flatMap((run) =>
        clipPolyline(
          run.map((p) =>
            vec2(p.x - opts.marginMm + tile.worldRect.x, p.y - opts.marginMm + tile.worldRect.y),
          ),
          band,
        ),
      )

    const inA = bandGeometry(pageA, tileA)
    const inB = bandGeometry(pageB, tileB)
    expect(inA.length).toBeGreaterThan(0)
    expect(inA).toEqual(inB)
  })

  it('FR-4: the overview page labels every tile in the grid', () => {
    const doc = buildPrintDocument(scene(), options())
    const overviewText = textStrings(doc.pages[0]!)
    for (const tile of doc.pages.slice(1)) expect(overviewText).toContain(tile.label)
  })

  it('includes a calibration ruler caption on each tile', () => {
    const doc = buildPrintDocument(scene(), options())
    for (const page of doc.pages.slice(1)) {
      expect(textStrings(page).some((s) => s.includes('100 mm'))).toBe(true)
    }
  })

  it('render content emits glass-coloured polygon fills; cartoon does not', () => {
    const render = buildPrintDocument(scene(), options({ content: 'render' }))
    const cartoon = buildPrintDocument(scene(), options({ content: 'cartoon' }))
    const fills = (page: PageContent): number => {
      let n = 0
      forEachOp(page.ops, (op) => {
        if (op.kind === 'polygon' && op.fill?.color === '#cc3344') n++
      })
      return n
    }
    expect(fills(render.pages[1]!)).toBeGreaterThan(0)
    expect(fills(cartoon.pages[1]!)).toBe(0)
  })

  // --- Assembly overlays: the finished panel outline and reinforcement bars ------------------
  //
  // Both exist for the bench, where the cartoon is laid on a platen and the panel is built on top
  // of it. A single-tile panel keeps the page mapping trivial: world + marginMm == page.
  describe('assembly overlays', () => {
    const PANEL: BBox = { min: vec2(0, 0), max: vec2(150, 150) }
    const PANEL_DASH = [8, 4]
    const BAR_DASH = [3, 2]
    const M = DEFAULT_MARGIN_MM

    /** A panel that fits one A4 tile, so there is exactly one content page to inspect. */
    function small(overrides: Partial<PrintScene> = {}): PrintScene {
      return scene({
        contentBounds: PANEL,
        network: [{ points: [vec2(0, 75), vec2(150, 75)], role: 'lead', widthMm: 1.2 }],
        pieces: [],
        ...overrides,
      })
    }

    const tilePage = (doc: PdfDoc): PageContent => doc.pages[1]!

    it('draws the finished panel outline as a closed dashed ring at the assembled size', () => {
      const doc = buildPrintDocument(small({ panelFrame: PANEL }), options())
      const runs = dashed(tilePage(doc), PANEL_DASH)
      expect(runs.length).toBeGreaterThan(0)
      const xs = runs.flat().map((p) => p.x)
      const ys = runs.flat().map((p) => p.y)
      // The ring traces the *finished* rectangle, offset onto the page by the sheet margin.
      expect(Math.min(...xs)).toBeCloseTo(M, 6)
      expect(Math.max(...xs)).toBeCloseTo(M + 150, 6)
      expect(Math.min(...ys)).toBeCloseTo(M, 6)
      expect(Math.max(...ys)).toBeCloseTo(M + 150, 6)
    })

    it('omits the panel outline when the toggle is off', () => {
      const doc = buildPrintDocument(
        small({ panelFrame: PANEL }),
        options({ include: { ...DEFAULT_INCLUDE, panelOutline: false } }),
      )
      expect(dashed(tilePage(doc), PANEL_DASH)).toHaveLength(0)
    })

    it('omits the panel outline when the project has no panel size', () => {
      const doc = buildPrintDocument(small(), options())
      expect(dashed(tilePage(doc), PANEL_DASH)).toHaveLength(0)
    })

    it('draws a bar as its true-width footprint, not a bare centreline', () => {
      const doc = buildPrintDocument(
        small({ reinforcements: [{ a: vec2(10, 75), b: vec2(140, 75), widthMm: 20 }] }),
        options(),
      )
      const runs = dashed(tilePage(doc), BAR_DASH)
      expect(runs.length).toBeGreaterThan(0)
      const ys = runs.flat().map((p) => p.y)
      // Both band edges are drawn, 20 mm apart and straddling the centreline — never the axis alone.
      expect(Math.min(...ys)).toBeCloseTo(M + 65, 6)
      expect(Math.max(...ys)).toBeCloseTo(M + 85, 6)
      expect(ys.some((y) => Math.abs(y - (M + 75)) < 1e-6)).toBe(false)
    })

    it('omits bars when the toggle is off, and skips a degenerate bar', () => {
      const bar = { a: vec2(10, 75), b: vec2(140, 75), widthMm: 20 }
      const off = buildPrintDocument(
        small({ reinforcements: [bar] }),
        options({ include: { ...DEFAULT_INCLUDE, reinforcements: false } }),
      )
      expect(dashed(tilePage(off), BAR_DASH)).toHaveLength(0)

      // Zero length and zero width each leave no footprint to draw.
      const degenerate = buildPrintDocument(
        small({
          reinforcements: [
            { a: vec2(50, 75), b: vec2(50, 75), widthMm: 20 },
            { a: vec2(10, 90), b: vec2(140, 90), widthMm: 0 },
          ],
        }),
        options(),
      )
      expect(dashed(tilePage(degenerate), BAR_DASH)).toHaveLength(0)
    })

    it('shows bars on the overview map, and drops them with the same toggle', () => {
      const withBars = small({
        reinforcements: [{ a: vec2(10, 75), b: vec2(140, 75), widthMm: 20 }],
      })
      const on = buildPrintDocument(withBars, options())
      const off = buildPrintDocument(
        withBars,
        options({ include: { ...DEFAULT_INCLUDE, reinforcements: false } }),
      )
      const overviewBars = (page: PageContent): number => {
        let n = 0
        forEachOp(page.ops, (op) => {
          if (op.kind === 'polyline' && op.stroke.dashMm?.[0] === BAR_DASH[0]) n++
        })
        return n
      }
      expect(overviewBars(on.pages[0]!)).toBeGreaterThan(0)
      expect(overviewBars(off.pages[0]!)).toBe(0)
    })
  })
})
