import { unzlibSync } from 'fflate'

import type { GreyBitmap } from '../types'

/**
 * A minimal 8-bit greyscale PNG reader, for the committed autotrace fixture.
 *
 * The pipeline needs *pixels*, and pure `core` has no image decoder (and must not grow node or DOM
 * types to get one — the F-050 `?raw` lesson). PNG is the one format readable here in a few dozen
 * lines: un-filtering the scanlines is spelled out in the spec, and inflating the `IDAT` stream is
 * the only part worth a dependency.
 *
 * **On that dependency.** `fflate` is a **devDependency** of `@vitrum/core`, and this file is only
 * ever reached from a `*.test.ts` — the package's shipped runtime graph is still `@vitrum/geometry`
 * alone, and `src/index.ts` does not export anything from `fixtures/`. It is already a runtime
 * dependency of `@vitrum/model` (the `.vitrum` zip container), pure JS with no dependencies of its
 * own, so it adds nothing new to the workspace. The alternatives were worse: committing raw pixel
 * data makes the fixture ~578 kB of bytes no human can open (a reviewer cannot see what the trace is
 * being asked to do, which is half the value of a real fixture); an uncompressed-PNG variant needs
 * bespoke tooling to produce and is no longer the format the rest of the world writes; and hand-
 * rolling inflate is ~150 lines of fiddly, security-relevant code to avoid one test-only dependency.
 *
 * Deliberately narrow: 8-bit greyscale (colour type 0), no interlacing. That is exactly what
 * `rectify.py` writes, and anything else should fail loudly rather than decode to something
 * plausible.
 */
export function decodeGreyPng(bytes: Uint8Array): GreyBitmap {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) throw new Error('decodeGreyPng: not a PNG')
  }

  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = readU32(bytes, at)
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    const start = at + 8
    if (type === 'IHDR') {
      width = readU32(bytes, start)
      height = readU32(bytes, start + 4)
      const depth = bytes[start + 8]
      const colourType = bytes[start + 9]
      const interlace = bytes[start + 12]
      if (depth !== 8 || colourType !== 0 || interlace !== 0) {
        throw new Error(
          `decodeGreyPng: expected 8-bit non-interlaced greyscale, got depth ${depth} colour type ${colourType} interlace ${interlace}`,
        )
      }
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }
    at = start + length + 4 // + CRC
  }
  if (width === 0 || height === 0) throw new Error('decodeGreyPng: no IHDR')

  // IDAT is a zlib stream, not a bare deflate one — `inflateSync` would read the 2-byte header as data.
  const raw = unzlibSync(concat(idat))
  const data = new Uint8Array(width * height)
  // Each scanline is prefixed by its filter type and reconstructed against the previous line.
  let src = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]!
    const row = y * width
    const prior = row - width
    for (let x = 0; x < width; x++) {
      const value = raw[src + x]!
      const a = x > 0 ? data[row + x - 1]! : 0
      const b = y > 0 ? data[prior + x]! : 0
      const c = x > 0 && y > 0 ? data[prior + x - 1]! : 0
      let out: number
      switch (filter) {
        case 0:
          out = value
          break
        case 1:
          out = value + a
          break
        case 2:
          out = value + b
          break
        case 3:
          out = value + ((a + b) >> 1)
          break
        case 4:
          out = value + paeth(a, b, c)
          break
        default:
          throw new Error(`decodeGreyPng: unknown filter ${filter}`)
      }
      data[row + x] = out & 0xff
    }
    src += width
  }
  return { width, height, data }
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  )
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** The PNG Paeth predictor. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}
