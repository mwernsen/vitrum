import type { ResolveContext } from '@vitrum/core'
import { vec2 } from '@vitrum/geometry'
import { createSegment } from '@vitrum/model'
import { line } from '@vitrum/geometry'
import { flushSync } from 'svelte'
import { describe, expect, it } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'

import { SnapController } from './snap.svelte'

const CTX: ResolveContext = { toolId: 'line', anchors: [] }

/** A viewport at 1 px/mm so screen px and world mm coincide, simplifying the radius maths. */
function viewportAt1to1(): ViewportController {
  const vp = new ViewportController()
  vp.transform = { scale: 1, offset: vec2(0, 0) }
  return vp
}

describe('SnapController', () => {
  it('resolves an endpoint snap and records the hit for the overlay', () => {
    const cleanup = $effect.root(() => {
      const vp = viewportAt1to1()
      const snap = new SnapController(vp)
      snap.updateScene([createSegment(line(vec2(0, 0), vec2(100, 0)))])
      snap.setPointer('mouse', false)

      // 2 mm from the node, inside the 8 px (= 8 mm here) mouse radius.
      const resolved = snap.resolver(vec2(2, 1), CTX)
      flushSync()
      expect(resolved.snap?.kind).toBe('endpoint')
      expect(resolved.world.x).toBe(0)
      expect(resolved.world.y).toBe(0)
      expect(snap.hit?.kind).toBe('endpoint')
    })
    cleanup()
  })

  it('passes the pointer through unchanged when the temporary-disable modifier is held (FR-3)', () => {
    const cleanup = $effect.root(() => {
      const vp = viewportAt1to1()
      const snap = new SnapController(vp)
      snap.updateScene([createSegment(line(vec2(0, 0), vec2(100, 0)))])
      snap.setPointer('mouse', true) // modifier held ⇒ snapping suspended

      const resolved = snap.resolver(vec2(2, 1), CTX)
      flushSync()
      expect(resolved.snap).toBeUndefined()
      expect(resolved.world).toEqual(vec2(2, 1))
      expect(snap.hit).toBeNull()
    })
    cleanup()
  })

  it('respects a disabled per-kind toggle', () => {
    const cleanup = $effect.root(() => {
      const vp = viewportAt1to1()
      const snap = new SnapController(vp)
      snap.updateScene([createSegment(line(vec2(0, 0), vec2(100, 0)))])
      snap.setPointer('mouse', false)
      // Turn off every kind that could catch a point 2 mm off the node's line.
      snap.toggle('endpoint')
      snap.toggle('on-curve')
      snap.toggle('grid')
      snap.toggle('midpoint')
      flushSync()

      const resolved = snap.resolver(vec2(2, 1), CTX)
      expect(resolved.snap).toBeUndefined()
    })
    cleanup()
  })

  it('uses the wider radius for pen input', () => {
    const cleanup = $effect.root(() => {
      const vp = viewportAt1to1()
      const snap = new SnapController(vp)
      snap.updateScene([createSegment(line(vec2(0, 0), vec2(100, 0)))])
      snap.toggle('grid') // off, so only the node governs the radius comparison
      flushSync()
      // 10 mm from the node: outside the 8 px mouse radius, inside the 12 px pen radius.
      snap.setPointer('mouse', false)
      expect(snap.resolver(vec2(0, 10), CTX).snap).toBeUndefined()
      snap.setPointer('pen', false)
      expect(snap.resolver(vec2(0, 10), CTX).snap?.kind).toBe('endpoint')
    })
    cleanup()
  })
})
