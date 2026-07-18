import { line, vec2 } from '@vitrum/geometry'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { geometryArb, roleArb, settingsArb } from './arbitraries'
import {
  addSegment,
  removeSegment,
  setSegmentRole,
  updateSegmentGeometry,
  updateSettings,
} from './commands'
import { createSegment } from './factory'
import { DocumentStore } from './store'
import { createEmptyProject } from './types'

/** An abstract, JSON-safe description of one store operation, resolved against the
 *  live document at execution time so it is always valid (e.g. no removing from empty). */
const opArb = fc.oneof(
  fc.record({ t: fc.constant('add' as const), geometry: geometryArb, role: roleArb }),
  fc.record({ t: fc.constant('remove' as const), pick: fc.nat() }),
  fc.record({
    t: fc.constant('update' as const),
    pick: fc.nat(),
    geometry: geometryArb,
    key: fc.option(fc.constantFrom('k1', 'k2'), { nil: undefined }),
  }),
  fc.record({ t: fc.constant('role' as const), pick: fc.nat(), role: roleArb }),
  fc.record({ t: fc.constant('settings' as const), settings: settingsArb }),
)
type Op = ReturnType<(typeof opArb)['generate']>['value']

function run(store: DocumentStore, ops: readonly Op[]): void {
  for (const op of ops) {
    const ids = Object.keys(store.document.segments)
    if (op.t === 'add') {
      store.execute(addSegment(createSegment(op.geometry, op.role)))
    } else if (op.t === 'settings') {
      store.execute(updateSettings(op.settings))
    } else if (ids.length === 0) {
      store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 1)))))
    } else {
      const id = ids[op.pick % ids.length]!
      if (op.t === 'remove') store.execute(removeSegment(id))
      else if (op.t === 'update')
        store.execute(updateSegmentGeometry(id, op.geometry), op.key ? { coalesceKey: op.key } : {})
      else store.execute(setSegmentRole(id, op.role))
    }
  }
}

describe('DocumentStore undo/redo (FR-2)', () => {
  it('undo-all returns a document deep-equal to the initial one', () => {
    fc.assert(
      fc.property(settingsArb, fc.array(opArb, { maxLength: 40 }), (settings, ops) => {
        const start = createEmptyProject(settings)
        const store = new DocumentStore(start)

        run(store, ops)
        const after = store.document

        while (store.canUndo) store.undo()
        expect(store.document).toEqual(start)

        while (store.canRedo) store.redo()
        expect(store.document).toEqual(after)
      }),
    )
  })

  it('add then undo removes the segment; redo restores it', () => {
    const store = new DocumentStore()
    const seg = createSegment(line(vec2(0, 0), vec2(10, 0)))
    store.execute(addSegment(seg))
    expect(store.document.segments[seg.id]).toEqual(seg)

    store.undo()
    expect(store.document.segments[seg.id]).toBeUndefined()
    expect(store.canRedo).toBe(true)

    store.redo()
    expect(store.document.segments[seg.id]).toEqual(seg)
  })

  it('executing after an undo clears the redo stack', () => {
    const store = new DocumentStore()
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    store.undo()
    expect(store.canRedo).toBe(true)
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(0, 1)))))
    expect(store.canRedo).toBe(false)
  })
})

describe('DocumentStore drag coalescing (merge)', () => {
  it('collapses consecutive geometry updates that share a coalesce key into one entry', () => {
    const store = new DocumentStore()
    const seg = createSegment(line(vec2(0, 0), vec2(1, 0)))
    store.execute(addSegment(seg))

    const g1 = line(vec2(0, 0), vec2(2, 0))
    const g2 = line(vec2(0, 0), vec2(3, 0))
    const g3 = line(vec2(0, 0), vec2(4, 0))
    store.execute(updateSegmentGeometry(seg.id, g1), { coalesceKey: 'drag' })
    store.execute(updateSegmentGeometry(seg.id, g2), { coalesceKey: 'drag' })
    store.execute(updateSegmentGeometry(seg.id, g3), { coalesceKey: 'drag' })

    expect(store.document.segments[seg.id]?.geometry).toEqual(g3)

    // One undo reverts the whole drag back to the pre-drag geometry.
    store.undo()
    expect(store.document.segments[seg.id]?.geometry).toEqual(seg.geometry)

    // The add is still a separate, earlier entry.
    store.undo()
    expect(store.document.segments[seg.id]).toBeUndefined()
  })

  it('does not merge updates with different coalesce keys', () => {
    const store = new DocumentStore()
    const seg = createSegment(line(vec2(0, 0), vec2(1, 0)))
    store.execute(addSegment(seg))
    store.execute(updateSegmentGeometry(seg.id, line(vec2(0, 0), vec2(2, 0))), { coalesceKey: 'a' })
    store.execute(updateSegmentGeometry(seg.id, line(vec2(0, 0), vec2(3, 0))), { coalesceKey: 'b' })
    store.undo()
    expect(store.document.segments[seg.id]?.geometry).toEqual(line(vec2(0, 0), vec2(2, 0)))
  })
})

describe('DocumentStore dirty state and subscriptions', () => {
  it('is clean initially, dirty after a mutation, clean after markSaved', () => {
    const store = new DocumentStore()
    expect(store.isDirty).toBe(false)
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    expect(store.isDirty).toBe(true)
    store.markSaved()
    expect(store.isDirty).toBe(false)
  })

  it('load replaces the document, clears history and dirty flag', () => {
    const store = new DocumentStore()
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    const loaded = createEmptyProject({ name: 'Loaded' })
    store.load(loaded)
    expect(store.document).toEqual(loaded)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
    expect(store.isDirty).toBe(false)
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const store = new DocumentStore()
    let calls = 0
    const unsubscribe = store.subscribe(() => {
      calls += 1
    })
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(1, 0)))))
    expect(calls).toBe(1)
    unsubscribe()
    store.execute(addSegment(createSegment(line(vec2(0, 0), vec2(2, 0)))))
    expect(calls).toBe(1)
  })
})
