import type { BBox } from '@vitrum/geometry'
import { arc, cubic, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { marqueeMode, marqueeSelect } from './marquee'
import type { PickTarget } from './pick'

const rect = (minx: number, miny: number, maxx: number, maxy: number): BBox => ({
  min: vec2(minx, miny),
  max: vec2(maxx, maxy),
})

const targets: PickTarget[] = [
  { id: 'inside', geometry: line(vec2(10, 10), vec2(20, 20)) }, // fully inside 0..50
  { id: 'crossing', geometry: line(vec2(-20, 25), vec2(120, 25)) }, // passes through, no endpoint inside
  { id: 'outside', geometry: line(vec2(200, 200), vec2(260, 260)) },
  { id: 'partial', geometry: line(vec2(40, 40), vec2(80, 80)) }, // one end inside
]

describe('marqueeMode (drag direction)', () => {
  it('left-to-right is window, right-to-left is crossing', () => {
    expect(marqueeMode(vec2(0, 0), vec2(50, 50))).toBe('window')
    expect(marqueeMode(vec2(50, 0), vec2(0, 50))).toBe('crossing')
  })
})

describe('marqueeSelect (FR-3 window vs crossing)', () => {
  const box = rect(0, 0, 50, 50)

  it('window selects only fully-contained targets', () => {
    expect(marqueeSelect(targets, box, 'window').sort()).toEqual(['inside'])
  })

  it('crossing selects contained + touched (incl. a line passing straight through)', () => {
    expect(marqueeSelect(targets, box, 'crossing').sort()).toEqual([
      'crossing',
      'inside',
      'partial',
    ])
  })

  it('excludes a curve whose bbox overlaps but whose path stays outside the box', () => {
    // A bump arc above the box: bbox dips into the box but the arc path stays at y>=60.
    const bump: PickTarget = {
      id: 'bump',
      geometry: arc(vec2(25, 100), 40, Math.PI, Math.PI * 2, true),
    }
    // The arc spans y∈[60,100]; box is 0..50, no overlap in y at all → not selected either mode.
    expect(marqueeSelect([bump], box, 'crossing')).toEqual([])
  })

  it('a curved segment fully inside is a window hit; dipping out is only a crossing hit', () => {
    const curve: PickTarget = {
      id: 'c',
      geometry: cubic(vec2(10, 10), vec2(20, 60), vec2(30, 60), vec2(40, 10)),
    }
    // The cubic bulges to ~y=47 (inside 0..50) → window hit.
    expect(marqueeSelect([curve], rect(0, 0, 50, 50), 'window')).toEqual(['c'])
    // Against a shorter box it dips out the top → not a window hit, but still crossing.
    expect(marqueeSelect([curve], rect(0, 0, 50, 30), 'window')).toEqual([])
    expect(marqueeSelect([curve], rect(0, 0, 50, 30), 'crossing')).toEqual(['c'])
  })
})
