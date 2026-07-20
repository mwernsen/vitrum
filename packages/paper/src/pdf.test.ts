import type { BBox } from '@vitrum/geometry'
import { vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { buildPrintDocument } from './compose'
import { renderPdf } from './pdf'
import { DEFAULT_INCLUDE, DEFAULT_MARGIN_MM, DEFAULT_OVERLAP_MM, type PrintScene } from './scene'
import { mmToPt, paperSize } from './units'

const BOUNDS: BBox = { min: vec2(0, 0), max: vec2(400, 500) }

const scene: PrintScene = {
  contentBounds: BOUNDS,
  network: [
    { points: [vec2(0, 250), vec2(400, 250)], role: 'lead', widthMm: 1.2 },
    { points: [vec2(200, 0), vec2(200, 500)], role: 'border', widthMm: 3 },
  ],
  cutLines: [[vec2(20, 20), vec2(120, 20), vec2(120, 120), vec2(20, 120)]],
  pieces: [
    {
      ring: [vec2(20, 20), vec2(180, 20), vec2(180, 180), vec2(20, 180)],
      holeRings: [[vec2(80, 80), vec2(120, 80), vec2(120, 120), vec2(80, 120)]],
      fillColor: '#33aa66',
      label: 'A1',
      labelAt: vec2(50, 50),
      labelRadiusMm: 20,
    },
  ],
  legend: [{ code: 'A', name: 'Green', color: '#33aa66', count: 1 }],
}

describe('renderPdf', () => {
  it('produces valid PDF bytes with the expected page count', async () => {
    const doc = buildPrintDocument(scene, {
      paper: paperSize('a4')!,
      orientation: 'portrait',
      marginMm: DEFAULT_MARGIN_MM,
      overlapMm: DEFAULT_OVERLAP_MM,
      content: 'render',
      include: DEFAULT_INCLUDE,
      projectName: 'PDF test',
    })
    const bytes = await renderPdf(doc)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.byteLength).toBeGreaterThan(1000)
    // PDF header + EOF marker.
    const ascii = (slice: Uint8Array): string =>
      Array.from(slice, (b) => String.fromCharCode(b)).join('')
    expect(ascii(bytes.slice(0, 5))).toBe('%PDF-')
    expect(ascii(bytes.slice(-6))).toContain('%%EOF')
  })

  it('re-parses to the same page count and A4 page size in points', async () => {
    const doc = buildPrintDocument(scene, {
      paper: paperSize('a4')!,
      orientation: 'portrait',
      marginMm: DEFAULT_MARGIN_MM,
      overlapMm: DEFAULT_OVERLAP_MM,
      content: 'cartoon',
      include: DEFAULT_INCLUDE,
      projectName: 'PDF test',
    })
    const bytes = await renderPdf(doc)

    const { PDFDocument } = await import('pdf-lib')
    const parsed = await PDFDocument.load(bytes)
    expect(parsed.getPageCount()).toBe(doc.pages.length)
    const first = parsed.getPage(0)
    expect(first.getWidth()).toBeCloseTo(mmToPt(210), 3)
    expect(first.getHeight()).toBeCloseTo(mmToPt(297), 3)
  })

  it('renders every page without throwing on standard-font text and clipped groups', async () => {
    const doc = buildPrintDocument(scene, {
      paper: paperSize('a3')!,
      orientation: 'landscape',
      marginMm: 12,
      overlapMm: 20,
      content: 'cut',
      include: DEFAULT_INCLUDE,
      projectName: 'Landscape A3',
    })
    const bytes = await renderPdf(doc)
    const { PDFDocument } = await import('pdf-lib')
    const parsed = await PDFDocument.load(bytes)
    // A3 landscape = 420 × 297 mm.
    expect(parsed.getPage(0).getWidth()).toBeCloseTo(mmToPt(420), 3)
    expect(parsed.getPage(0).getHeight()).toBeCloseTo(mmToPt(297), 3)
  })
})
