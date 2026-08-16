import type { Viewport } from '@vitrum/core'
import { vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { drawPanelFrame, readCanvasPalette } from './render'

/**
 * A recording stand-in for the 2D context. jsdom has no canvas backend, so the real drawing code
 * only ever sees `null` there (every draw call tolerates it) — this records the calls instead, which
 * is what lets the panel frame's geometry be asserted without a screenshot.
 */
function recorder() {
  const calls: string[] = []
  const state = { strokeStyle: '', lineWidth: 0, dash: [] as number[] }
  const ctx = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    setLineDash: (d: number[]) => {
      state.dash = d
      calls.push(`setLineDash(${d.join(',')})`)
    },
    strokeRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`strokeRect(${x},${y},${w},${h})`),
    set strokeStyle(v: string) {
      state.strokeStyle = v
    },
    set lineWidth(v: number) {
      state.lineWidth = v
    },
  }
  return { calls, state, ctx: ctx as unknown as CanvasRenderingContext2D }
}

const vp: Viewport = { scale: 2, offset: vec2(10, 20) }

describe('drawPanelFrame (F-058)', () => {
  it('strokes the panel rectangle in screen space', () => {
    const { calls, ctx } = recorder()
    drawPanelFrame(
      ctx,
      vp,
      { min: vec2(0, 0), max: vec2(300, 400) },
      readCanvasPalette(document.body),
    )
    // (0,0) → (10,20) and (300,400) → (610,820) at scale 2; crisp() puts the edges on half-pixels.
    expect(calls).toContain('strokeRect(10.5,20.5,600,800)')
  })

  it('draws a solid line, so it never reads as a construction guide or a symmetry axis', () => {
    const { state, ctx } = recorder()
    drawPanelFrame(
      ctx,
      vp,
      { min: vec2(0, 0), max: vec2(100, 100) },
      readCanvasPalette(document.body),
    )
    expect(state.dash).toEqual([])
    expect(state.lineWidth).toBe(1)
  })

  it('draws in the frame token, distinct from the grid, guide and axis colours', () => {
    const { state, ctx } = recorder()
    const palette = readCanvasPalette(document.body)
    drawPanelFrame(ctx, vp, { min: vec2(0, 0), max: vec2(100, 100) }, palette)
    expect(state.strokeStyle).toBe(palette.panelFrame)
    expect(state.strokeStyle).not.toBe(palette.gridMajor)
    expect(state.strokeStyle).not.toBe(palette.axis)
    expect(state.strokeStyle).not.toBe(palette.cursor)
  })

  it('draws nothing without a panel size, and nothing for a degenerate rectangle', () => {
    const withoutPanel = recorder()
    drawPanelFrame(withoutPanel.ctx, vp, null, readCanvasPalette(document.body))
    expect(withoutPanel.calls).toEqual([])

    const degenerate = recorder()
    drawPanelFrame(
      degenerate.ctx,
      vp,
      { min: vec2(0, 0), max: vec2(0, 400) },
      readCanvasPalette(document.body),
    )
    expect(degenerate.calls.filter((c) => c.startsWith('strokeRect'))).toEqual([])
  })

  it('tolerates a missing context, like every other draw call', () => {
    expect(() =>
      drawPanelFrame(
        null,
        vp,
        { min: vec2(0, 0), max: vec2(10, 10) },
        readCanvasPalette(document.body),
      ),
    ).not.toThrow()
  })
})
