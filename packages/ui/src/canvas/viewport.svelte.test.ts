import { CSS_PX_PER_MM, screenToWorld } from '@vitrum/core'
import { vec2 } from '@vitrum/geometry'
import { afterEach, describe, expect, it } from 'vitest'

import { ViewportController } from './viewport.svelte'

afterEach(() => {
  localStorage.clear()
})

describe('ViewportController', () => {
  it('starts at 1:1 physical scale in millimetres', () => {
    const vp = new ViewportController()
    expect(vp.unit).toBe('mm')
    expect(vp.pxPerMm).toBeCloseTo(CSS_PX_PER_MM, 6)
    expect(vp.zoomFactor).toBeCloseTo(1, 6)
    expect(vp.cursorWorld).toBeNull()
  })

  it('frames the default panel region on first resize (FR-5)', () => {
    const vp = new ViewportController()
    vp.resize(800, 600, 2)
    expect(vp.devicePixelRatio).toBe(2)
    // Default bounds are 300×400 mm; height limits: 400 into 600·0.9 = 540 ⇒ 1.35 px/mm.
    expect(vp.transform.scale).toBeCloseTo(1.35, 6)
  })

  it('pans by a screen delta without changing scale', () => {
    const vp = new ViewportController()
    const before = vp.transform
    vp.pan(10, -5)
    expect(vp.transform.scale).toBe(before.scale)
    expect(vp.transform.offset).toEqual(vec2(before.offset.x + 10, before.offset.y - 5))
  })

  it('zooms anchored at a screen point (FR-2)', () => {
    const vp = new ViewportController()
    const anchor = vec2(120, 90)
    const worldBefore = screenToWorld(vp.transform, anchor)
    const scaleBefore = vp.transform.scale
    vp.zoomAt(2, anchor)
    const worldAfter = screenToWorld(vp.transform, anchor)
    expect(vp.transform.scale).toBeCloseTo(scaleBefore * 2, 6)
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6)
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6)
  })

  it('snaps to exact 1:1 physical size', () => {
    const vp = new ViewportController()
    vp.resize(800, 600, 1)
    vp.zoomToActualSize()
    expect(vp.transform.scale).toBeCloseTo(vp.pxPerMm, 6)
    expect(vp.zoomFactor).toBeCloseTo(1, 6)
  })

  it('reports the cursor position in world millimetres', () => {
    const vp = new ViewportController()
    vp.resize(800, 600, 1)
    vp.setCursor(vec2(200, 150))
    const expected = screenToWorld(vp.transform, vec2(200, 150))
    expect(vp.cursorWorld).not.toBeNull()
    expect(vp.cursorWorld!.x).toBeCloseTo(expected.x, 6)
    vp.setCursor(null)
    expect(vp.cursorWorld).toBeNull()
  })

  it('toggles unit and grid visibility', () => {
    const vp = new ViewportController()
    expect(vp.gridVisible).toBe(true)
    vp.toggleGrid()
    expect(vp.gridVisible).toBe(false)
    vp.toggleUnit()
    expect(vp.unit).toBe('in')
    vp.toggleUnit()
    expect(vp.unit).toBe('mm')
  })

  it('applies a calibration, changing the reported zoom factor', () => {
    const vp = new ViewportController()
    vp.zoomToActualSize()
    vp.setCalibration(vp.pxPerMm / 2)
    // Same transform, half the px/mm ⇒ it now reads as 2× physical size.
    expect(vp.zoomFactor).toBeCloseTo(2, 6)
    vp.setCalibration(-1)
    expect(vp.zoomFactor).toBeCloseTo(2, 6) // invalid input ignored
  })
})
