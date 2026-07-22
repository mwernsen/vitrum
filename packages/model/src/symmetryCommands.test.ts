import { line, pointAt, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { bakeSymmetry, setSymmetry } from './commands'
import { createSegment, weldSegments } from './factory'
import { addSegments } from './commands'
import { createEmptyProject, type Project, type Segment } from './types'

/** Apply a command to a doc (helper mirroring the store's execute for unit scope). */
function apply(doc: Project, command: ReturnType<typeof setSymmetry>): Project {
  return command.apply(doc)
}

describe('setSymmetry (F-052 FR-4)', () => {
  it('patches the setup and inverts exactly', () => {
    const doc = createEmptyProject()
    const command = setSymmetry({ mode: 'radial', count: 6, mirror: true })
    const next = apply(doc, command)
    expect(next.symmetry.mode).toBe('radial')
    expect(next.symmetry.count).toBe(6)
    expect(next.symmetry.mirror).toBe(true)
    // Center/angle untouched by the partial patch.
    expect(next.symmetry.center).toEqual(doc.symmetry.center)

    const restored = command.invert(doc).apply(next)
    expect(restored.symmetry).toEqual(doc.symmetry)
  })

  it('is a single undo entry that restores the whole prior setup', () => {
    const base = apply(createEmptyProject(), setSymmetry({ mode: 'mirror', angle: 0 }))
    const command = setSymmetry({ mode: 'radial', count: 8 })
    const next = command.apply(base)
    expect(command.invert(base).apply(next).symmetry).toEqual(base.symmetry)
  })
})

describe('bakeSymmetry (F-052 FR-3)', () => {
  // A source line plus its (already welded) replica, as the shell would compute it.
  function docWithSource(): { doc: Project; source: Segment } {
    const source = createSegment(line(vec2(120, 100), vec2(140, 130)))
    const doc = {
      ...addSegments([source]).apply(createEmptyProject()),
      symmetry: {
        mode: 'radial' as const,
        center: vec2(100, 100),
        angle: 0,
        count: 4,
        mirror: false,
      },
    }
    return { doc, source }
  }

  it('materializes replicas as stored segments and turns the mode off', () => {
    const { doc } = docWithSource()
    // Two replica segments (as the shell would weld them) with fresh ids.
    const replicas = weldSegments([
      { geometry: line(vec2(100, 120), vec2(70, 140)), role: 'lead' },
      { geometry: line(vec2(80, 100), vec2(60, 70)), role: 'lead' },
    ]).segments
    const command = bakeSymmetry(replicas)
    const baked = command.apply(doc)

    expect(Object.keys(baked.segments)).toHaveLength(3) // source + 2 replicas
    expect(baked.symmetry.mode).toBe('none')
    for (const r of replicas) expect(baked.segments[r.id]).toEqual(r)
  })

  it('undoes as one step, restoring the source-only network and prior setup', () => {
    const { doc } = docWithSource()
    const replicas = weldSegments([
      { geometry: line(vec2(100, 120), vec2(70, 140)), role: 'lead' },
    ]).segments
    const command = bakeSymmetry(replicas)
    const baked = command.apply(doc)
    const undone = command.invert(doc).apply(baked)

    expect(undone.segments).toEqual(doc.segments)
    expect(undone.symmetry).toEqual(doc.symmetry)
    // Redo reproduces the same baked ids (determinism).
    const redone = command.invert(doc).invert(baked).apply(undone)
    expect(Object.keys(redone.segments).sort()).toEqual(Object.keys(baked.segments).sort())
  })

  it('keeps baked geometry equal to what was handed in (sampled points, FR-3)', () => {
    const { doc } = docWithSource()
    const geom = line(vec2(100, 120), vec2(70, 140))
    const replicas = weldSegments([{ geometry: geom, role: 'lead' }]).segments
    const baked = bakeSymmetry(replicas).apply(doc)
    const stored = baked.segments[replicas[0]!.id]!.geometry
    for (const t of [0, 0.5, 1]) {
      const a = pointAt(stored, t)
      const b = pointAt(geom, t)
      expect(a.x).toBeCloseTo(b.x, 9)
      expect(a.y).toBeCloseTo(b.y, 9)
    }
  })
})
