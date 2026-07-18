import { bboxOfPoints, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import {
  CSS_PX_PER_MM,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  fitBounds,
  gridStep,
  makeViewport,
  niceStep,
  panByScreen,
  rulerStepMm,
  screenToWorld,
  ticksInRange,
  visibleWorldBounds,
  worldToScreen,
  zoomBy,
} from './index'

const vp = (scale: number, x: number, y: number) => makeViewport(scale, vec2(x, y))

describe('worldToScreen / screenToWorld', () => {
  it('are inverses (round-trip) to < 0.01 px across 0.01×–1000× (FR-1)', () => {
    const offsets = [vec2(0, 0), vec2(133.7, -42.2), vec2(-1000, 5000)]
    const scales = [0.01, 0.1, 1, CSS_PX_PER_MM, 37.5, 250, 1000]
    for (const scale of scales) {
      for (const offset of offsets) {
        const view = makeViewport(scale, offset)
        for (const p of [vec2(0, 0), vec2(300, 400), vec2(-125.5, 987.25), vec2(1e5, -1e5)]) {
          const round = screenToWorld(view, worldToScreen(view, p))
          const back = worldToScreen(view, screenToWorld(view, worldToScreen(view, p)))
          const forward = worldToScreen(view, p)
          expect(Math.hypot(round.x - p.x, round.y - p.y) * scale).toBeLessThan(0.01)
          expect(Math.hypot(back.x - forward.x, back.y - forward.y)).toBeLessThan(0.01)
        }
      }
    }
  })

  it('is Y-down: increasing world Y moves down the screen', () => {
    const view = vp(2, 0, 0)
    expect(worldToScreen(view, vec2(0, 10)).y).toBeGreaterThan(worldToScreen(view, vec2(0, 0)).y)
  })
})

describe('panByScreen', () => {
  it('shifts the offset without changing scale', () => {
    const panned = panByScreen(vp(3, 10, 20), 5, -7)
    expect(panned.scale).toBe(3)
    expect(panned.offset).toEqual(vec2(15, 13))
  })
})

describe('scaleAround / zoomBy (FR-2: cursor-anchored)', () => {
  it('keeps the world point under the anchor fixed', () => {
    const view = vp(2, 50, 50)
    const anchor = vec2(300, 220)
    const worldBefore = screenToWorld(view, anchor)
    const zoomed = zoomBy(view, 2.5, anchor)
    const worldAfter = screenToWorld(zoomed, anchor)
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6)
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6)
    expect(zoomed.scale).toBeCloseTo(5, 6)
  })

  it('clamps to the scale bounds', () => {
    expect(zoomBy(vp(MAX_SCALE, 0, 0), 10, vec2(0, 0)).scale).toBe(MAX_SCALE)
    expect(zoomBy(vp(MIN_SCALE, 0, 0), 0.001, vec2(0, 0)).scale).toBe(MIN_SCALE)
    expect(clampScale(0)).toBe(MIN_SCALE)
  })
})

describe('fitBounds (FR-5)', () => {
  it('frames the bounds centred with a 5% margin', () => {
    const bounds = bboxOfPoints([vec2(0, 0), vec2(300, 400)])
    const view = { width: 800, height: 600 }
    const fitted = fitBounds(bounds, view)

    // Limiting axis here is height: 400 mm into 600·0.9 = 540 px ⇒ 1.35 px/mm.
    expect(fitted.scale).toBeCloseTo((600 * 0.9) / 400, 6)

    // The document's centre lands at the view centre.
    const center = worldToScreen(fitted, vec2(150, 200))
    expect(center.x).toBeCloseTo(400, 6)
    expect(center.y).toBeCloseTo(300, 6)

    // Content fits with margin to spare on the non-limiting axis.
    const topLeft = worldToScreen(fitted, vec2(0, 0))
    const bottomRight = worldToScreen(fitted, vec2(300, 400))
    expect(topLeft.y).toBeGreaterThanOrEqual(600 * 0.05 - 0.01)
    expect(bottomRight.y).toBeLessThanOrEqual(600 * 0.95 + 0.01)
  })

  it('falls back to physical scale for a degenerate (single-point) bound', () => {
    const bounds = bboxOfPoints([vec2(42, 42)])
    const fitted = fitBounds(bounds, { width: 800, height: 600 })
    expect(fitted.scale).toBeCloseTo(CSS_PX_PER_MM, 6)
    expect(worldToScreen(fitted, vec2(42, 42)).x).toBeCloseTo(400, 6)
  })
})

describe('visibleWorldBounds', () => {
  it('reports the world rectangle under the viewport', () => {
    const bounds = visibleWorldBounds(vp(2, 0, 0), { width: 200, height: 100 })
    expect(bounds.min).toEqual(vec2(0, 0))
    expect(bounds.max).toEqual(vec2(100, 50))
  })
})

describe('niceStep / gridStep', () => {
  it('snaps to the 1/5/10 ladder', () => {
    expect(niceStep(0.3)).toBeCloseTo(0.5, 12)
    expect(niceStep(3)).toBe(5)
    expect(niceStep(7)).toBe(10)
    expect(niceStep(40)).toBe(50)
    expect(niceStep(1)).toBe(1)
  })

  it('produces the 1/5/10/50/100 mm ladder with sensible majors', () => {
    // At 100 px/mm, 8 px ⇒ 0.08 mm ⇒ minor 0.1, major 0.5.
    expect(gridStep(100)).toEqual({ minor: 0.1, major: 0.5 })
    // ~1 px/mm ⇒ minor 10, major 50.
    expect(gridStep(1)).toEqual({ minor: 10, major: 50 })
    // 5 px/mm ⇒ 1.6 mm ⇒ minor 5, major 10.
    expect(gridStep(5)).toEqual({ minor: 5, major: 10 })
  })

  it('keeps minor lines at least the minimum spacing apart', () => {
    for (const scale of [0.02, 0.5, 3, 17, 240, 900]) {
      expect(gridStep(scale, 8).minor * scale).toBeGreaterThanOrEqual(8 - 1e-9)
    }
  })
})

describe('rulerStepMm', () => {
  it('uses round mm steps in mm mode', () => {
    // 2 px/mm, 56 px ⇒ 28 mm ⇒ 50 mm.
    expect(rulerStepMm(2, 'mm', 56)).toBe(50)
  })

  it('uses natural inch fractions in inch mode', () => {
    // 10 px/mm ⇒ 56 px = 5.6 mm ≈ 0.22" ⇒ 1/4" = 6.35 mm.
    expect(rulerStepMm(10, 'in', 56)).toBeCloseTo(6.35, 6)
    // Fine zoom, 200 px/mm ⇒ 0.28 mm ≈ 0.011" ⇒ 1/32" = 0.79375 mm.
    expect(rulerStepMm(200, 'in', 56)).toBeCloseTo(0.79375, 6)
  })
})

describe('ticksInRange', () => {
  it('lists the multiples of step within an inclusive range', () => {
    expect(ticksInRange(-10, 20, 10)).toEqual([-10, 0, 10, 20])
    expect(ticksInRange(1, 9, 10)).toEqual([])
    expect(ticksInRange(0, 5, 0)).toEqual([])
  })
})
