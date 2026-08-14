import { describe, expect, it } from 'vitest'

import type { CameRibbonInput } from './glass-gl'
import { cameJoints } from './joints'

const run = (
  points: readonly { x: number; y: number }[],
  widthMm = 5,
  kind: CameRibbonInput['kind'] = 'lead',
): CameRibbonInput => ({ points, widthMm, kind })

describe('cameJoints', () => {
  it('finds a joint where two runs share an endpoint', () => {
    const joints = cameJoints([
      run([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      run([
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ])
    expect(joints).toHaveLength(1)
    expect(joints[0]!.at).toEqual({ x: 10, y: 0 })
  })

  it('leaves a lone run end unsoldered', () => {
    expect(
      cameJoints([
        run([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ]),
      ]),
    ).toEqual([])
  })

  it('sizes and tints the joint from the widest came meeting there', () => {
    const joints = cameJoints([
      run(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        5,
      ),
      run(
        [
          { x: 5, y: 0 },
          { x: 9, y: 0 },
        ],
        12,
        'border',
      ),
      run(
        [
          { x: 5, y: 0 },
          { x: 5, y: 4 },
        ],
        7,
      ),
    ])
    expect(joints).toHaveLength(1)
    expect(joints[0]!.widthMm).toBe(12)
    expect(joints[0]!.kind).toBe('border')
  })

  it('keeps a lead joint lead-kinded so it is not tinted as bright solder', () => {
    const joints = cameJoints([
      run(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        6,
      ),
      run(
        [
          { x: 5, y: 0 },
          { x: 5, y: 5 },
        ],
        5,
      ),
    ])
    expect(joints[0]!.kind).toBe('lead')
  })

  it('matches endpoints through sub-0.01mm float drift', () => {
    expect(
      cameJoints([
        run([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ]),
        run([
          { x: 10.000003, y: 0 },
          { x: 10, y: 10 },
        ]),
      ]),
    ).toHaveLength(1)
  })

  it('ignores interior vertices, which are curve detail rather than nodes', () => {
    // The second run passes through (10,0) mid-polyline; that is not a soldered joint.
    expect(
      cameJoints([
        run([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ]),
        run([
          { x: 5, y: -5 },
          { x: 10, y: 0 },
          { x: 15, y: 5 },
        ]),
      ]),
    ).toEqual([])
  })

  it('finds every crossing of a two-by-two lattice', () => {
    // A plus-shaped node in the middle of a grid: four runs meeting at one point.
    const joints = cameJoints([
      run([
        { x: 0, y: 5 },
        { x: 5, y: 5 },
      ]),
      run([
        { x: 5, y: 5 },
        { x: 10, y: 5 },
      ]),
      run([
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ]),
      run([
        { x: 5, y: 5 },
        { x: 5, y: 10 },
      ]),
    ])
    expect(joints).toHaveLength(1)
    expect(joints[0]!.at).toEqual({ x: 5, y: 5 })
  })

  it('skips degenerate runs', () => {
    expect(cameJoints([run([{ x: 0, y: 0 }]), run([])])).toEqual([])
  })
})
