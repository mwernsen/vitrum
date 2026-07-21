import { line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import type { ExportScene } from './exportScene'
import { buildExportPdfDocument } from './exportPdf'
import { forEachOp, type DrawOp } from './page'
import { renderPdf } from './pdf'
import { paperSize } from './units'

const A4 = paperSize('a4')!

function scene(): ExportScene {
  return {
    contentBounds: { min: vec2(0, 0), max: vec2(100, 80) },
    segments: [
      { id: 's1', geometry: line(vec2(0, 0), vec2(100, 0)), role: 'border', widthMm: 2 },
      { id: 's2', geometry: line(vec2(50, 0), vec2(50, 80)), role: 'lead', widthMm: 1 },
    ],
    pieces: [
      {
        key: 'A1',
        ring: [vec2(0, 0), vec2(50, 0), vec2(50, 80), vec2(0, 80)],
        holeRings: [],
        fillColor: '#cc2244',
        label: 'A1',
        labelAt: vec2(25, 40),
      },
    ],
    reinforcements: [],
    legend: [],
  }
}

const BASE = {
  scaleMode: 'actual' as const,
  look: 'render' as const,
  includeNumbers: true,
  paper: A4,
  orientation: 'portrait' as const,
  marginMm: 10,
  projectName: 'Panel',
}

function collect(doc: ReturnType<typeof buildExportPdfDocument>): DrawOp[] {
  const ops: DrawOp[] = []
  forEachOp(doc.pages[0]!.ops, (op) => ops.push(op))
  return ops
}

describe('buildExportPdfDocument', () => {
  it('actual size: one page sized to the panel plus margins, 1:1', () => {
    const doc = buildExportPdfDocument(scene(), BASE)
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0]!.widthMm).toBeCloseTo(120, 6) // 100 + 2×10
    expect(doc.pages[0]!.heightMm).toBeCloseTo(100, 6) // 80 + 2×10
    const captions = collect(doc).filter(
      (o): o is Extract<DrawOp, { kind: 'text' }> => o.kind === 'text',
    )
    expect(captions.some((t) => t.text.includes('actual size'))).toBe(true)
  })

  it('fit mode: one page at the chosen paper size with a printed scale factor', () => {
    const doc = buildExportPdfDocument(scene(), { ...BASE, scaleMode: 'fit' })
    expect(doc.pages[0]!.widthMm).toBeCloseTo(A4.widthMm, 6)
    expect(doc.pages[0]!.heightMm).toBeCloseTo(A4.heightMm, 6)
    const texts = collect(doc).filter(
      (o): o is Extract<DrawOp, { kind: 'text' }> => o.kind === 'text',
    )
    expect(texts.some((t) => t.text.includes('scale'))).toBe(true)
  })

  it('render look fills pieces; cartoon look does not', () => {
    const render = collect(buildExportPdfDocument(scene(), BASE)).filter(
      (o) => o.kind === 'polygon',
    )
    expect(render.length).toBeGreaterThan(0)
    const cartoon = collect(buildExportPdfDocument(scene(), { ...BASE, look: 'cartoon' })).filter(
      (o) => o.kind === 'polygon',
    )
    expect(cartoon.length).toBe(0)
  })

  it('renders to valid vector PDF bytes', async () => {
    const bytes = await renderPdf(buildExportPdfDocument(scene(), BASE))
    expect(bytes.byteLength).toBeGreaterThan(500)
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-')
  })
})
