import { describe, expect, it } from 'vitest'

import cartoonJpeg from './fixtures/cartoon-photo-workbench.jpg?inline'
import { orientRgba, orientationSwapsAxes, readExifOrientation, type ExifOrientation } from './exif'
import { decodeDataUrl } from './fixtures/dataUrl'

/**
 * EXIF orientation gets its own tests, built from synthesised JPEG headers, because the committed
 * reference photo can only demonstrate the trap — not exercise the eight cases. (It demonstrates it
 * well: upright pixels plus a stale `orientation = 6`. See the last test here and the fixtures README.)
 */

/** A minimal JPEG: SOI, an APP1/Exif segment carrying only the orientation tag, then SOS. */
function jpegWithOrientation(value: number, little = false): Uint8Array {
  const tiff: number[] = []
  const u16 = (v: number): void => {
    if (little) tiff.push(v & 0xff, (v >> 8) & 0xff)
    else tiff.push((v >> 8) & 0xff, v & 0xff)
  }
  const u32 = (v: number): void => {
    if (little) tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
    else tiff.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)
  }
  // TIFF header: byte order, magic 42, offset to IFD0.
  if (little) tiff.push(0x49, 0x49)
  else tiff.push(0x4d, 0x4d)
  u16(42)
  u32(8)
  u16(1) // one entry
  u16(0x0112) // orientation
  u16(3) // SHORT
  u32(1) // one value
  u16(value)
  u16(0) // padding of the 4-byte value field
  u32(0) // next IFD

  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff] // "Exif\0\0" + TIFF
  const length = app1.length + 2
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe1, // APP1
    (length >> 8) & 0xff,
    length & 0xff,
    ...app1,
    0xff,
    0xda, // SOS
    0x00,
    0x02,
  ])
}

describe('readExifOrientation', () => {
  it('reads every orientation, big-endian and little-endian', () => {
    for (let value = 1; value <= 8; value++) {
      expect(readExifOrientation(jpegWithOrientation(value, false))).toBe(value)
      expect(readExifOrientation(jpegWithOrientation(value, true))).toBe(value)
    }
  })

  it('falls back to upright for a file with no EXIF, a non-JPEG, or an out-of-range value', () => {
    expect(readExifOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBe(1)
    // A PNG signature: no orientation concept at all.
    expect(readExifOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1)
    expect(readExifOrientation(new Uint8Array(0))).toBe(1)
    expect(readExifOrientation(jpegWithOrientation(99))).toBe(1)
  })

  it('does not walk off the end of a truncated APP1 segment', () => {
    const full = jpegWithOrientation(6)
    for (let cut = 4; cut < full.length; cut++) {
      expect(() => readExifOrientation(full.slice(0, cut))).not.toThrow()
    }
  })

  it('reads the committed reference photo — whose tag is stale, and says so', () => {
    // The fixture is a real specimen of the trap, and worth knowing about: its rotation is baked into
    // its pixels (they are upright), and it *also* still carries `orientation = 6`, "rotate 90°
    // clockwise" — `sips` rotated the pixels on the downscale and left the tag behind. So a decoder
    // that honours EXIF turns this already-upright photo on its side.
    //
    // That is not a bug to patch out of the fixture: it is exactly why F-059 reads the tag itself
    // rather than trusting a decoder default. What the app must guarantee is that the trace sees the
    // *same* orientation the F-051 layer displays — the user places the calibration and the four
    // rectification corners on what they can see. Consistency, not absolute uprightness, is the
    // requirement, and `reference/prepare.ts` secures it by applying this reader's answer once, at
    // import, and baking the result into the stored asset both of them read.
    expect(readExifOrientation(decodeDataUrl(cartoonJpeg))).toBe(6)
  })
})

describe('orientRgba', () => {
  /** A 3×2 image whose pixels encode their own coordinates in red/green. */
  function probe(): { data: Uint8ClampedArray; width: number; height: number } {
    const width = 3
    const height = 2
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4
        data[o] = 10 * x
        data[o + 1] = 10 * y
        data[o + 2] = 0
        data[o + 3] = 255
      }
    }
    return { data, width, height }
  }

  function at(
    img: { data: Uint8ClampedArray; width: number },
    x: number,
    y: number,
  ): [number, number] {
    const o = (y * img.width + x) * 4
    return [img.data[o]!, img.data[o + 1]!]
  }

  it('leaves an upright image alone', () => {
    const p = probe()
    const out = orientRgba(p.data, p.width, p.height, 1)
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    expect(at(out, 0, 0)).toEqual([0, 0])
    expect(at(out, 2, 1)).toEqual([20, 10])
  })

  it('rotates 90° clockwise for orientation 6, swapping the axes', () => {
    const p = probe()
    const out = orientRgba(p.data, p.width, p.height, 6)
    expect(out.width).toBe(2)
    expect(out.height).toBe(3)
    // The source's top-left pixel ends up top-right.
    expect(at(out, 1, 0)).toEqual([0, 0])
    // And the source's bottom-right ends up bottom-left.
    expect(at(out, 0, 2)).toEqual([20, 10])
  })

  it('mirrors, rotates and transposes the remaining cases without losing a pixel', () => {
    const p = probe()
    for (let o = 1; o <= 8; o++) {
      const orientation = o as ExifOrientation
      const out = orientRgba(p.data, p.width, p.height, orientation)
      const swap = orientationSwapsAxes(orientation)
      expect(out.width).toBe(swap ? 2 : 3)
      expect(out.height).toBe(swap ? 3 : 2)
      // Every pixel is opaque, so the mapping is a bijection with no gaps.
      for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255)
    }
  })

  it('applied twice for 180° returns the original', () => {
    const p = probe()
    const once = orientRgba(p.data, p.width, p.height, 3)
    const twice = orientRgba(once.data, once.width, once.height, 3)
    expect([...twice.data]).toEqual([...p.data])
  })

  it('rotating 90° clockwise then anti-clockwise returns the original', () => {
    const p = probe()
    const cw = orientRgba(p.data, p.width, p.height, 6)
    const back = orientRgba(cw.data, cw.width, cw.height, 8)
    expect(back.width).toBe(p.width)
    expect(back.height).toBe(p.height)
    expect([...back.data]).toEqual([...p.data])
  })
})
