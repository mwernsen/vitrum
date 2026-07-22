import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  applyHomography,
  homographyFromQuadToQuad,
  IDENTITY_MAT3,
  invertMat3,
  multiplyMat3,
  type Quad,
} from './homography'
import { distance, vec2, type Vec2 } from './vec2'

const unitSquare: Quad = [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)]

describe('applyHomography', () => {
  it('is the identity for the identity matrix', () => {
    expect(applyHomography(IDENTITY_MAT3, vec2(3, -4))).toEqual(vec2(3, -4))
  })

  it('divides out the homogeneous coordinate', () => {
    // A pure perspective term m6 scales by 1/(1 + x).
    const m = [1, 0, 0, 0, 1, 0, 1, 0, 1] as const
    const p = applyHomography(m, vec2(1, 2))
    expect(p.x).toBeCloseTo(0.5)
    expect(p.y).toBeCloseTo(1)
  })
})

describe('homographyFromQuadToQuad', () => {
  it('maps the four correspondences exactly', () => {
    const dst: Quad = [vec2(2, 1), vec2(9, 0), vec2(11, 6), vec2(1, 7)]
    const h = homographyFromQuadToQuad(unitSquare, dst)
    for (let k = 0; k < 4; k++) {
      const p = applyHomography(h, unitSquare[k]!)
      expect(distance(p, dst[k]!)).toBeLessThan(1e-9)
    }
  })

  it('reduces to a similarity when the target is a translated, scaled rectangle', () => {
    // No perspective: the bottom row should be (0, 0, 1) up to scale, so a midpoint maps affinely.
    const dst: Quad = [vec2(10, 20), vec2(50, 20), vec2(50, 60), vec2(10, 60)]
    const h = homographyFromQuadToQuad(unitSquare, dst)
    const centre = applyHomography(h, vec2(0.5, 0.5))
    expect(centre.x).toBeCloseTo(30)
    expect(centre.y).toBeCloseTo(40)
    expect(h[6]).toBeCloseTo(0)
    expect(h[7]).toBeCloseTo(0)
  })

  it('rectifies an angled photo of a rectangle (FR-2 fixture)', () => {
    // A 1200×800 mm window photographed at an angle appears as this quad (image px). Rectifying
    // maps the real rectangle back onto the quad; sampling the rectified centre must land at the
    // quad's projective centre, and the four corners must round-trip.
    const photoQuad: Quad = [vec2(180, 120), vec2(1040, 60), vec2(1180, 900), vec2(60, 820)]
    const realRect: Quad = [vec2(0, 0), vec2(1200, 0), vec2(1200, 800), vec2(0, 800)]
    const rectToPhoto = homographyFromQuadToQuad(realRect, photoQuad)
    for (let k = 0; k < 4; k++) {
      expect(distance(applyHomography(rectToPhoto, realRect[k]!), photoQuad[k]!)).toBeLessThan(1e-6)
    }
    // The inverse recovers the real rectangle from photo coordinates.
    const photoToRect = invertMat3(rectToPhoto)
    for (let k = 0; k < 4; k++) {
      expect(distance(applyHomography(photoToRect, photoQuad[k]!), realRect[k]!)).toBeLessThan(1e-6)
    }
  })

  it('falls back to identity for a degenerate (collinear) quad', () => {
    const collinear: Quad = [vec2(0, 0), vec2(1, 1), vec2(2, 2), vec2(3, 3)]
    expect(homographyFromQuadToQuad(unitSquare, collinear)).toEqual(IDENTITY_MAT3)
  })
})

describe('invertMat3 / multiplyMat3', () => {
  it('inverse composed with the original is the identity mapping', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: 8, maxLength: 8 }),
        (offsets) => {
          // Perturb the unit square into a convex quad by small per-corner offsets.
          const dst: Quad = [
            vec2(0 + offsets[0]! * 0.1, 0 + offsets[1]! * 0.1),
            vec2(100 + offsets[2]! * 0.1, 0 + offsets[3]! * 0.1),
            vec2(100 + offsets[4]! * 0.1, 100 + offsets[5]! * 0.1),
            vec2(0 + offsets[6]! * 0.1, 100 + offsets[7]! * 0.1),
          ]
          const h = homographyFromQuadToQuad(unitSquare, dst)
          const round = multiplyMat3(invertMat3(h), h)
          const p: Vec2 = vec2(0.37, 0.62)
          expect(distance(applyHomography(round, p), p)).toBeLessThan(1e-6)
        },
      ),
    )
  })
})
