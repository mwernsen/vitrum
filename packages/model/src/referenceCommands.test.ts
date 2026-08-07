import { vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import {
  addReferenceLayer,
  removeReferenceLayer,
  reorderReferenceLayers,
  updateReferenceLayer,
} from './commands'
import { DocumentStore } from './store'
import type { ReferenceLayer } from './types'

/** Reference-image layer commands (F-051): add / patch / remove / reorder, each one undo entry. */
const layer = (id: string, over: Partial<ReferenceLayer> = {}): ReferenceLayer => ({
  id,
  name: 'photo',
  assetId: `asset-${id}`,
  naturalWidthPx: 1000,
  naturalHeightPx: 600,
  srcQuad: [vec2(0, 0), vec2(1000, 0), vec2(1000, 600), vec2(0, 600)],
  dstQuad: [vec2(0, 0), vec2(500, 0), vec2(500, 300), vec2(0, 300)],
  opacity: 0.8,
  desaturate: false,
  visible: true,
  locked: false,
  rectified: false,
  calibrated: true,
  ...over,
})

describe('addReferenceLayer / removeReferenceLayer', () => {
  it('adds a layer, is one undo entry, and rejects duplicate ids', () => {
    const store = new DocumentStore()
    store.execute(addReferenceLayer(layer('l1')))
    expect(store.document.layers).toHaveLength(1)
    expect(() => store.execute(addReferenceLayer(layer('l1')))).toThrow(/already exists/)

    store.undo()
    expect(store.document.layers).toHaveLength(0)
    store.redo()
    expect(store.document.layers).toHaveLength(1)
  })

  it('removes a layer and restores it exactly on undo', () => {
    const store = new DocumentStore()
    store.execute(addReferenceLayer(layer('l1', { opacity: 0.42 })))
    store.execute(removeReferenceLayer('l1'))
    expect(store.document.layers).toHaveLength(0)
    store.undo()
    expect(store.document.layers[0]!.opacity).toBe(0.42)
  })
})

describe('updateReferenceLayer', () => {
  it('patches only the given fields and restores them on undo', () => {
    const store = new DocumentStore()
    store.execute(addReferenceLayer(layer('l1')))
    store.execute(updateReferenceLayer('l1', { opacity: 0.3, desaturate: true }))
    expect(store.document.layers[0]!.opacity).toBe(0.3)
    expect(store.document.layers[0]!.desaturate).toBe(true)
    expect(store.document.layers[0]!.visible).toBe(true) // untouched

    store.undo()
    expect(store.document.layers[0]!.opacity).toBe(0.8)
    expect(store.document.layers[0]!.desaturate).toBe(false)
  })

  it('coalesces a drag (same layer, same fields) into one undo entry', () => {
    const store = new DocumentStore()
    store.execute(addReferenceLayer(layer('l1')))
    for (let x = 10; x <= 50; x += 10) {
      const dst: ReferenceLayer['dstQuad'] = [
        vec2(x, 0),
        vec2(500 + x, 0),
        vec2(500 + x, 300),
        vec2(x, 300),
      ]
      store.execute(updateReferenceLayer('l1', { dstQuad: dst }), { coalesceKey: 'drag-l1' })
    }
    expect(store.document.layers[0]!.dstQuad[0]).toEqual(vec2(50, 0))
    // One undo returns to the layer as first added, not an intermediate drag frame.
    store.undo()
    expect(store.document.layers[0]!.dstQuad[0]).toEqual(vec2(0, 0))
  })

  it('does not coalesce edits of different fields', () => {
    const store = new DocumentStore()
    store.execute(addReferenceLayer(layer('l1')))
    store.execute(updateReferenceLayer('l1', { opacity: 0.5 }), { coalesceKey: 'edit' })
    store.execute(updateReferenceLayer('l1', { locked: true }), { coalesceKey: 'edit' })
    // Two separate undo entries: undo the lock, then the opacity.
    store.undo()
    expect(store.document.layers[0]!.locked).toBe(false)
    expect(store.document.layers[0]!.opacity).toBe(0.5)
    store.undo()
    expect(store.document.layers[0]!.opacity).toBe(0.8)
  })

  it('throws for an unknown layer', () => {
    const store = new DocumentStore()
    expect(() => store.execute(updateReferenceLayer('nope', { opacity: 0.1 }))).toThrow(
      /does not exist/,
    )
  })
})

describe('reorderReferenceLayers', () => {
  it('reorders the stack and is reversible', () => {
    const store = new DocumentStore()
    store.execute(addReferenceLayer(layer('a')))
    store.execute(addReferenceLayer(layer('b')))
    store.execute(addReferenceLayer(layer('c')))
    store.execute(reorderReferenceLayers(['c', 'a', 'b']))
    expect(store.document.layers.map((l) => l.id)).toEqual(['c', 'a', 'b'])
    store.undo()
    expect(store.document.layers.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('rejects a non-permutation', () => {
    const store = new DocumentStore()
    store.execute(addReferenceLayer(layer('a')))
    store.execute(addReferenceLayer(layer('b')))
    expect(() => store.execute(reorderReferenceLayers(['a']))).toThrow(/permutation/)
    expect(() => store.execute(reorderReferenceLayers(['a', 'x']))).toThrow(/unknown layer/)
  })
})
