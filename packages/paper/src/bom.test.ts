import { describe, expect, it } from 'vitest'

import { buildBomDocument } from './bom'
import { sampleBomReport, sampleFoilReport } from './bomFixture'
import { forEachOp, type DrawOp } from './page'
import { renderPdf } from './pdf'
import { PT_PER_MM } from './units'

/** F-042 PDF: cutting list (one glass per section, swatch + dims in display units, FR-4) + BOM. */

function allOps(doc: ReturnType<typeof buildBomDocument>): DrawOp[] {
  const ops: DrawOp[] = []
  for (const page of doc.pages) forEachOp(page.ops, (op) => ops.push(op))
  return ops
}

function texts(doc: ReturnType<typeof buildBomDocument>): string[] {
  return allOps(doc)
    .filter((op): op is Extract<DrawOp, { kind: 'text' }> => op.kind === 'text')
    .map((op) => op.text)
}

describe('buildBomDocument', () => {
  it('produces an A4 page with the project title', () => {
    const doc = buildBomDocument(sampleBomReport(), { projectName: 'My panel', unit: 'mm' })
    expect(doc.pages.length).toBeGreaterThanOrEqual(1)
    const page = doc.pages[0]!
    expect(page.widthMm).toBeCloseTo(210, 1)
    expect(page.heightMm).toBeCloseTo(297, 1)
    expect(texts(doc)).toContain('My panel')
  })

  it('renders one section per glass with its code and a printed swatch (FR-4)', () => {
    const doc = buildBomDocument(sampleBomReport(), { projectName: 'P', unit: 'mm' })
    const t = texts(doc)
    // Both glass codes appear as section headings.
    expect(t).toContain('A')
    expect(t).toContain('?')
    expect(t).toContain('Ruby, red · Aurora')
    // The swatch is a filled rect in the glass's colour.
    const swatch = allOps(doc).some((op) => op.kind === 'rect' && op.fill?.color === '#c0392b')
    expect(swatch).toBe(true)
  })

  it('prints piece dimensions in the display unit (mm vs inch, FR-4)', () => {
    const mm = texts(buildBomDocument(sampleBomReport(), { projectName: 'P', unit: 'mm' }))
    expect(mm.some((s) => s.includes('98.1 mm'))).toBe(true)
    expect(mm.some((s) => s.includes('cm²'))).toBe(true)
    const inch = texts(buildBomDocument(sampleBomReport(), { projectName: 'P', unit: 'in' }))
    // 98.1 mm ÷ 25.4 = 3.86 in.
    expect(inch.some((s) => s.includes('3.86 in'))).toBe(true)
    expect(inch.some((s) => s.includes('in²'))).toBe(true)
    // No mm/cm² *unit* tokens leak into inch mode (came profile names like "H 5 mm" are text, not units).
    expect(inch.some((s) => s.includes('cm²'))).toBe(false)
    expect(inch.some((s) => / mm\b/.test(s.replace(/H \d+ mm/g, '')))).toBe(false)
  })

  it('includes the BOM sections: glass, came, reinforcement, weight and documented factors', () => {
    const t = texts(buildBomDocument(sampleBomReport(), { projectName: 'P', unit: 'mm' }))
    expect(t).toContain('Bill of materials')
    expect(t.some((s) => s.includes('LEAD CAME'.toUpperCase()) || s === 'LEAD CAME')).toBe(true)
    expect(t.some((s) => s.includes('20 g per metre'))).toBe(true)
    expect(t.some((s) => s.includes('Glass waste +30%'))).toBe(true)
  })

  it('switches the came section to a foil/solder section in foil technique', () => {
    const t = texts(buildBomDocument(sampleFoilReport(), { projectName: 'P', unit: 'mm' }))
    expect(t).toContain('COPPER FOIL')
    expect(t.some((s) => s.includes('g/m of seam'))).toBe(true)
  })

  it('can omit the cutting list or the BOM', () => {
    const noCut = texts(
      buildBomDocument(sampleBomReport(), {
        projectName: 'P',
        unit: 'mm',
        includeCuttingList: false,
      }),
    )
    expect(noCut).not.toContain('Cutting list')
    expect(noCut).toContain('Bill of materials')
  })

  it('renders to valid vector PDF bytes (encodes ² and × safely)', async () => {
    const doc = buildBomDocument(sampleBomReport(), { projectName: 'Ünïcode × m²', unit: 'mm' })
    const bytes = await renderPdf(doc)
    const ascii = (slice: Uint8Array): string =>
      Array.from(slice, (b) => String.fromCharCode(b)).join('')
    expect(ascii(bytes.slice(0, 5))).toBe('%PDF-')
    expect(ascii(bytes.slice(-6))).toContain('%%EOF')
  })

  it('paginates a long cutting list across multiple pages', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      contentId: `k${i}`,
      pieceId: `p${i}`,
      label: `A${i + 1}`,
      widthMm: 50,
      heightMm: 50,
      areaMm2: 2500,
      degenerate: false,
    }))
    const report = sampleBomReport({
      cutting: [
        {
          glassId: 'g1',
          code: 'A',
          name: 'Ruby',
          color: '#c0392b',
          rows,
          count: rows.length,
          netAreaMm2: 300000,
          buyAreaMm2: 390000,
          pieceIds: rows.map((r) => r.pieceId),
        },
      ],
    })
    const doc = buildBomDocument(report, { projectName: 'P', unit: 'mm' })
    expect(doc.pages.length).toBeGreaterThan(1)
  })
})

describe('PT_PER_MM sanity', () => {
  it('is the shared unit constant (guards against a private copy)', () => {
    expect(PT_PER_MM).toBeCloseTo(72 / 25.4, 6)
  })
})
