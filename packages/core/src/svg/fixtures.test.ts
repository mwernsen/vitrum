import { bboxOf, bboxUnion, type BBox } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import illustratorPanel from './fixtures/illustrator-panel.svg?raw'
import inkscapePanel from './fixtures/inkscape-panel.svg?raw'
import messyNetwork from './fixtures/messy-network.svg?raw'
import { buildImportPreview, readSvg } from './import'
import type { PathGeometry } from './path'

/**
 * FR-1 / FR-2 committed reference fixtures. Real-world exports from Inkscape and Illustrator import
 * with correct geometry and scale (real mm units honoured through the viewBox), and a curated messy
 * network heals — at a reasonable tolerance — to the regions a person would see. These exercise the
 * whole pipeline (XML → CTM → shapes → unit map → heal → detect) on files, not synthetic inputs.
 * Fixtures load via Vite `?raw` so pure `core` never pulls in node:fs.
 */

const fixtures: Record<string, string> = {
  'inkscape-panel.svg': inkscapePanel,
  'illustrator-panel.svg': illustratorPanel,
  'messy-network.svg': messyNetwork,
}

function fixture(name: string): string {
  const content = fixtures[name]
  if (content === undefined) throw new Error(`unknown fixture: ${name}`)
  return content
}

function healedBounds(segments: readonly { geometry: PathGeometry }[]): BBox {
  let box: BBox | null = null
  for (const s of segments) box = box ? bboxUnion(box, bboxOf(s.geometry)) : bboxOf(s.geometry)
  if (!box) throw new Error('no geometry')
  return box
}

describe('FR-1 — Inkscape reference import', () => {
  const source = readSvg(fixture('inkscape-panel.svg'))

  it('honours the real mm scale (1 user unit = 1 mm) and drops text + gradients', () => {
    expect(source.unit.ambiguous).toBe(false)
    expect(source.unit.userUnitMm).toBeCloseTo(1, 9)
  })

  it('places the transformed square at true size and detects the two pieces', () => {
    const preview = buildImportPreview(source, {
      userUnitMm: source.unit.userUnitMm,
      toleranceMm: 0.1,
      role: 'lead',
    })
    // translate(10,10) applied to a 100×100 mm square → bounds (10,10)–(110,110).
    const box = healedBounds(preview.segments)
    expect(box.min.x).toBeCloseTo(10, 6)
    expect(box.max.x).toBeCloseTo(110, 6)
    // Border + diagonal → two triangles.
    expect(preview.pieceCount).toBe(2)
    expect(preview.dropped).toContain('text')
    expect(preview.dropped).toContain('gradients')
  })
})

describe('FR-1 — Illustrator reference import', () => {
  const source = readSvg(fixture('illustrator-panel.svg'))

  it('honours the real mm scale', () => {
    expect(source.unit.ambiguous).toBe(false)
    expect(source.unit.userUnitMm).toBeCloseTo(1, 9)
  })

  it('imports the matrix-transformed square + inscribed circle as an annulus and a disc', () => {
    const preview = buildImportPreview(source, {
      userUnitMm: source.unit.userUnitMm,
      toleranceMm: 0.1,
      role: 'lead',
    })
    expect(preview.pieceCount).toBe(2)
  })
})

describe('FR-2 — messy network heals to the apparent regions', () => {
  const source = readSvg(fixture('messy-network.svg'))

  it('is ambiguous (no physical units) and defaults to 1 unit = 1 mm', () => {
    expect(source.unit.ambiguous).toBe(true)
    expect(source.unit.userUnitMm).toBe(1)
  })

  it('finds nothing raw but the two triangles once healed', () => {
    const raw = buildImportPreview(source, { userUnitMm: 1, toleranceMm: 0, role: 'lead' })
    expect(raw.pieceCount).toBe(0)

    const healed = buildImportPreview(source, { userUnitMm: 1, toleranceMm: 1, role: 'lead' })
    expect(healed.pieceCount).toBe(2)
    expect(healed.heal.summary.dropped).toBeGreaterThan(0) // duplicate + zero-length removed
  })
})
