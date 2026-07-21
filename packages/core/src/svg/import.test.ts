import { describe, expect, it } from 'vitest'

import { buildImportPreview, readSvg, toDrafts } from './import'

describe('readSvg', () => {
  it('parses and resolves an unambiguous real-unit file', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200">' +
      '<rect x="0" y="0" width="100" height="100"/></svg>'
    const source = readSvg(svg)
    expect(source.unit.ambiguous).toBe(false)
    expect(source.unit.userUnitMm).toBeCloseTo(1, 9)
    expect(source.parsed.geometries).toHaveLength(4)
  })

  it('flags an ambiguous unitless file for the scale dialog', () => {
    const source = readSvg('<svg viewBox="0 0 100 100"><rect x="0" y="0" width="50" height="50"/></svg>')
    expect(source.unit.ambiguous).toBe(true)
    expect(source.unit.userUnitMm).toBe(1)
    expect(source.unit.artworkWidthUser).toBe(100)
  })
})

describe('buildImportPreview', () => {
  it('scales, heals and counts the pieces a closed rectangle yields', () => {
    const svg = '<svg viewBox="0 0 100 80"><rect x="10" y="10" width="80" height="60"/></svg>'
    const source = readSvg(svg)
    const preview = buildImportPreview(source, { userUnitMm: 2, toleranceMm: 0, role: 'lead' })
    expect(preview.pieceCount).toBe(1)
    // Scaled by 2: the rect spans 160 mm wide.
    const drafts = toDrafts(preview.segments)
    expect(drafts).toHaveLength(4)
    expect(drafts.every((d) => d.role === 'lead')).toBe(true)
  })

  it('surfaces dropped content kinds in the preview', () => {
    const svg = '<svg viewBox="0 0 10 10"><text x="0" y="0">a</text><rect x="0" y="0" width="5" height="5"/></svg>'
    const preview = buildImportPreview(readSvg(svg), {
      userUnitMm: 1,
      toleranceMm: 0,
      role: 'lead',
    })
    expect(preview.dropped).toContain('text')
  })
})
