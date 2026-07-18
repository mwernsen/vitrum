import { describe, expect, it } from 'vitest'

import {
  add,
  angle,
  cross,
  distance,
  distanceSq,
  dot,
  equals,
  leftNormal,
  length,
  lengthSq,
  lerp,
  negate,
  normalize,
  rightNormal,
  rotate,
  scale,
  sub,
  vec2,
} from './vec2'

describe('vec2 arithmetic', () => {
  it('adds, subtracts, scales and lerps componentwise', () => {
    expect(add(vec2(1, 2), vec2(3, 4))).toEqual(vec2(4, 6))
    expect(sub(vec2(3, 4), vec2(1, 2))).toEqual(vec2(2, 2))
    expect(scale(vec2(2, -3), 2)).toEqual(vec2(4, -6))
    expect(lerp(vec2(0, 0), vec2(10, 20), 0.25)).toEqual(vec2(2.5, 5))
  })

  it('negates', () => {
    expect(negate(vec2(2, -3))).toEqual(vec2(-2, 3))
  })
})

describe('vec2 products and lengths', () => {
  it('computes dot and cross products', () => {
    expect(dot(vec2(1, 0), vec2(0, 1))).toBe(0)
    expect(dot(vec2(2, 3), vec2(4, 5))).toBe(23)
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1)
    expect(cross(vec2(1, 0), vec2(1, 0))).toBe(0)
  })

  it('computes length, lengthSq and distances', () => {
    expect(length(vec2(3, 4))).toBe(5)
    expect(lengthSq(vec2(3, 4))).toBe(25)
    expect(distance(vec2(0, 0), vec2(3, 4))).toBe(5)
    expect(distanceSq(vec2(0, 0), vec2(3, 4))).toBe(25)
  })
})

describe('vec2 directions', () => {
  it('normalizes and returns zero for a zero vector', () => {
    expect(normalize(vec2(10, 0))).toEqual(vec2(1, 0))
    expect(normalize(vec2(0, 0))).toEqual(vec2(0, 0))
  })

  it('produces left and right normals', () => {
    const l = leftNormal(vec2(1, 0))
    expect(l.x).toBeCloseTo(0)
    expect(l.y).toBeCloseTo(1)
    const r = rightNormal(vec2(1, 0))
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(-1)
    // Normal of a 45° direction is perpendicular and unit-length after normalize.
    expect(leftNormal(vec2(2, 2))).toEqual(vec2(-2, 2))
  })

  it('rotates about the origin', () => {
    const r = rotate(vec2(1, 0), Math.PI / 2)
    expect(r.x).toBeCloseTo(0, 12)
    expect(r.y).toBeCloseTo(1, 12)
  })

  it('reports the angle from +x', () => {
    expect(angle(vec2(1, 0))).toBeCloseTo(0)
    expect(angle(vec2(0, 1))).toBeCloseTo(Math.PI / 2)
  })
})

describe('vec2 equality', () => {
  it('treats points within tolerance as equal', () => {
    expect(equals(vec2(1, 1), vec2(1 + 1e-9, 1))).toBe(true)
    expect(equals(vec2(1, 1), vec2(1.1, 1))).toBe(false)
  })
})
