import { describe, expect, it } from 'vitest'

import { downscaleSize, REFERENCE_IMAGE_MAX_PX } from './image'

describe('downscaleSize (F-051 FR-4)', () => {
  it('leaves an image within the cap unchanged', () => {
    expect(downscaleSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(downscaleSize(4096, 2000)).toEqual({ width: 4096, height: 2000 })
  })

  it('scales the longest edge down to the cap, preserving aspect ratio', () => {
    const out = downscaleSize(8000, 4000)
    expect(out.width).toBe(REFERENCE_IMAGE_MAX_PX)
    expect(out.height).toBe(2048)
  })

  it('handles a tall image (height is the longest edge)', () => {
    const out = downscaleSize(3000, 9000)
    expect(out.height).toBe(REFERENCE_IMAGE_MAX_PX)
    expect(out.width).toBe(1365) // round(3000 * 4096/9000)
  })

  it('never upscales and never returns a zero dimension', () => {
    expect(downscaleSize(10, 10, 4096)).toEqual({ width: 10, height: 10 })
    expect(downscaleSize(1, 100000, 4096).width).toBeGreaterThanOrEqual(1)
    expect(downscaleSize(0, 0)).toEqual({ width: 0, height: 0 })
  })

  it('respects a custom cap', () => {
    expect(downscaleSize(4000, 2000, 2048)).toEqual({ width: 2048, height: 1024 })
  })
})
