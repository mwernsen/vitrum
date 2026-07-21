import { line, vec2, type BBox } from '@vitrum/geometry'
import type { ExportScene } from '@vitrum/paper'
import { describe, expect, it, vi } from 'vitest'

import { ExportController } from './controller.svelte'

const BOUNDS: BBox = { min: vec2(0, 0), max: vec2(100, 80) }

const scene: ExportScene = {
  contentBounds: BOUNDS,
  segments: [
    { id: 's1', geometry: line(vec2(0, 0), vec2(100, 0)), role: 'border', widthMm: 2 },
    { id: 's2', geometry: line(vec2(50, 0), vec2(50, 80)), role: 'lead', widthMm: 1 },
  ],
  pieces: [
    {
      key: 'A1',
      ring: [vec2(0, 0), vec2(50, 0), vec2(50, 80), vec2(0, 80)],
      holeRings: [],
      cutRing: [vec2(1, 1), vec2(49, 1), vec2(49, 79), vec2(1, 79)],
      cutHoleRings: [],
      fillColor: '#336699',
      label: 'A1',
      labelAt: vec2(25, 40),
    },
  ],
  reinforcements: [],
  legend: [],
}

describe('ExportController (F-043)', () => {
  it('defaults to the design sheet, SVG linework file option', () => {
    const c = new ExportController()
    expect(c.docType).toBe('design-sheet')
    expect(c.designFileFormat).toBe('svg')
    expect(c.svgFlavor).toBe('linework')
  })

  it('applies technique-aware defaults (foil spreads cut contours on a grid)', () => {
    const c = new ExportController()
    c.applyTechniqueDefaults('foil')
    expect(c.cutLayout).toBe('grid')
    c.applyTechniqueDefaults('lead')
    expect(c.cutLayout).toBe('in-place')
  })

  it('exports an SVG design file through saveText with a .svg name', async () => {
    const c = new ExportController()
    c.docType = 'design-files'
    const saveText = vi.fn(async (name: string) => name)
    const path = await c.run(scene, 'My Panel', { saveText })
    expect(saveText).toHaveBeenCalledWith('My-Panel.svg', expect.stringContaining('<svg'))
    expect(saveText).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('width="100mm"'),
    )
    expect(path).toBe('My-Panel.svg')
  })

  it('exports a DXF design file through saveText with a .dxf name', async () => {
    const c = new ExportController()
    c.docType = 'design-files'
    c.designFileFormat = 'dxf'
    const saveText = vi.fn(async (name: string) => name)
    await c.run(scene, 'Panel', { saveText })
    expect(saveText).toHaveBeenCalledWith('Panel.dxf', expect.stringContaining('AC1009'))
  })

  it('exports the design sheet as PDF bytes through savePdf', async () => {
    const c = new ExportController()
    // docType defaults to 'design-sheet'.
    const savePdf = vi.fn(async (name: string) => name)
    await c.run(scene, 'Panel', { savePdf })
    expect(savePdf).toHaveBeenCalledWith('Panel.pdf', expect.any(Uint8Array))
  })

  it('captures an error when the document type has no host writer', async () => {
    const c = new ExportController()
    c.docType = 'design-files'
    const path = await c.run(scene, 'Panel', {})
    expect(path).toBeNull()
    expect(c.errorMessage).toMatch(/unavailable/)
  })

  it('saves a PNG snapshot through savePng', async () => {
    const c = new ExportController()
    const savePng = vi.fn(async (name: string) => name)
    const bytes = new Uint8Array([1, 2, 3])
    await c.runPng(bytes, 'Panel', savePng)
    expect(savePng).toHaveBeenCalledWith('Panel.png', bytes)
  })

  it('reports a capture failure when the snapshot is null', async () => {
    const c = new ExportController()
    const savePng = vi.fn(async (name: string) => name)
    const path = await c.runPng(null, 'Panel', savePng)
    expect(path).toBeNull()
    expect(savePng).not.toHaveBeenCalled()
    expect(c.errorMessage).toMatch(/capture/)
  })
})
