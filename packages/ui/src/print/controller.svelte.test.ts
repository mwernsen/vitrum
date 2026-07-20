import { vec2, type BBox } from '@vitrum/geometry'
import type { PrintScene } from '@vitrum/paper'
import { describe, expect, it, vi } from 'vitest'

import { PrintController } from './controller.svelte'

const BOUNDS: BBox = { min: vec2(0, 0), max: vec2(600, 800) }

const scene: PrintScene = {
  contentBounds: BOUNDS,
  network: [{ points: [vec2(0, 400), vec2(600, 400)], role: 'lead', widthMm: 1.2 }],
  cutLines: [],
  pieces: [
    {
      ring: [vec2(10, 10), vec2(200, 10), vec2(200, 200), vec2(10, 200)],
      holeRings: [],
      fillColor: '#336699',
      label: 'A1',
      labelAt: vec2(100, 100),
      labelRadiusMm: 20,
    },
  ],
  legend: [{ code: 'A', name: 'Blue', color: '#336699', count: 1 }],
}

describe('PrintController (F-041)', () => {
  it('defaults to A4 portrait, 10 mm margin, 15 mm overlap, cartoon', () => {
    const c = new PrintController()
    const opts = c.optionsFor('Panel')
    expect(opts.paper.id).toBe('a4')
    expect(opts.orientation).toBe('portrait')
    expect(opts.marginMm).toBe(10)
    expect(opts.overlapMm).toBe(15)
    expect(opts.content).toBe('cartoon')
    expect(opts.include.calibrationRuler).toBe(true)
  })

  it('resolves a custom paper size from its dimensions', () => {
    const c = new PrintController()
    c.paperId = 'custom'
    c.customWidthMm = 500
    c.customHeightMm = 700
    expect(c.paper).toMatchObject({ id: 'custom', widthMm: 500, heightMm: 700 })
  })

  it('computes a multi-tile grid for a large panel', () => {
    const c = new PrintController()
    const tiling = c.tilingFor(BOUNDS)
    expect(tiling).not.toBeNull()
    expect(tiling!.tiles.length).toBeGreaterThan(1)
  })

  it('returns null tiling when margins swallow the sheet', () => {
    const c = new PrintController()
    c.marginMm = 200
    expect(c.tilingFor(BOUNDS)).toBeNull()
  })

  it('exports valid vector PDF bytes to the host and records the path', async () => {
    const c = new PrintController()
    const saved: { name: string; bytes: Uint8Array }[] = []
    const savePdf = vi.fn(async (name: string, bytes: Uint8Array) => {
      saved.push({ name, bytes })
      return `/tmp/${name}`
    })
    const path = await c.export(scene, 'My Panel', savePdf)
    expect(path).toBe('/tmp/My-Panel-1to1.pdf')
    expect(c.lastSavedPath).toBe(path)
    expect(c.errorMessage).toBeNull()
    expect(saved).toHaveLength(1)
    const header = Array.from(saved[0]!.bytes.slice(0, 5), (b) => String.fromCharCode(b)).join('')
    expect(header).toBe('%PDF-')
  })

  it('captures export errors instead of throwing', async () => {
    const c = new PrintController()
    const path = await c.export(scene, 'Panel', async () => {
      throw new Error('disk full')
    })
    expect(path).toBeNull()
    expect(c.errorMessage).toBe('disk full')
    expect(c.exporting).toBe(false)
  })
})
