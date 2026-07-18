import { line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { addSegments, replaceSegments } from './commands'
import { createSegment } from './factory'
import { DocumentStore } from './store'

/** A completed drawing gesture (F-011) is one `addSegments` command: one undo entry. */
describe('addSegments (compound gesture command)', () => {
  const spans = () => [
    createSegment(line(vec2(0, 0), vec2(100, 0))),
    createSegment(line(vec2(100, 0), vec2(100, 80))),
    createSegment(line(vec2(100, 80), vec2(0, 80))),
  ]

  it('adds every segment and is a single undo entry', () => {
    const store = new DocumentStore()
    const segs = spans()
    store.execute(addSegments(segs))

    expect(Object.keys(store.document.segments)).toHaveLength(3)
    for (const s of segs) expect(store.document.segments[s.id]).toEqual(s)

    // One undo removes the whole gesture, not one span (FR-1).
    store.undo()
    expect(Object.keys(store.document.segments)).toHaveLength(0)

    store.redo()
    expect(Object.keys(store.document.segments)).toHaveLength(3)
  })

  it('rejects a gesture whose id already exists', () => {
    const store = new DocumentStore()
    const seg = createSegment(line(vec2(0, 0), vec2(1, 0)))
    store.execute(addSegments([seg]))
    expect(() => store.execute(addSegments([seg]))).toThrow(/already exists/)
  })

  it('undo of an empty gesture is a no-op round-trip', () => {
    const store = new DocumentStore()
    const before = store.document
    store.execute(addSegments([]))
    store.undo()
    expect(store.document).toEqual(before)
  })
})

describe('replaceSegments (border contour swap)', () => {
  it('removes some segments and adds others atomically, reversibly', () => {
    const store = new DocumentStore()
    const oldBorder = [
      createSegment(line(vec2(0, 0), vec2(100, 0)), 'border'),
      createSegment(line(vec2(100, 0), vec2(100, 80)), 'border'),
    ]
    store.execute(addSegments(oldBorder))
    const afterFirst = store.document

    const newBorder = [createSegment(line(vec2(0, 0), vec2(50, 0)), 'border')]
    store.execute(
      replaceSegments(
        oldBorder.map((s) => s.id),
        newBorder,
      ),
    )
    const ids = Object.keys(store.document.segments)
    expect(ids).toEqual([newBorder[0]!.id])

    // One undo restores the exact previous state (FR-2 exactness).
    store.undo()
    expect(store.document).toEqual(afterFirst)
  })

  it('tolerates removing ids that are absent', () => {
    const store = new DocumentStore()
    const seg = createSegment(line(vec2(0, 0), vec2(1, 0)))
    store.execute(replaceSegments(['ghost-id'], [seg]))
    expect(Object.keys(store.document.segments)).toEqual([seg.id])
    store.undo()
    expect(Object.keys(store.document.segments)).toHaveLength(0)
  })
})
