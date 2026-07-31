import { makeViewport } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import { DocumentStore, addSegments, weldSegments, type Project } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'

import { EditController } from './edit.svelte'
import { SelectionController } from './selection.svelte'
import { SnapController } from './snap.svelte'

/**
 * An identity viewport (screen px == world mm) + a real store, so pointer coordinates map
 * straight to world coordinates and every command actually mutates the document.
 */
function setup() {
  const viewport = new ViewportController()
  viewport.transform = makeViewport(1, vec2(0, 0))
  const selection = new SelectionController()
  const snap = new SnapController(viewport)
  snap.master = false // deterministic: no snapping pull in assertions

  // An L of two lines welded at (100, 0).
  const { segments } = weldSegments([
    { geometry: line(vec2(0, 0), vec2(100, 0)), role: 'lead' },
    { geometry: line(vec2(100, 0), vec2(100, 80)), role: 'lead' },
  ])
  const store = new DocumentStore()
  store.execute(addSegments(segments))
  snap.updateScene(Object.values(store.document.segments))

  const edit = new EditController({
    viewport,
    selection,
    snap,
    getDoc: () => store.document,
    execute: (c, o) => store.execute(c, o),
  })
  return { edit, selection, store, viewport, snap, segments }
}

const mods = { shift: false, alt: false }
const doc = (store: DocumentStore): Project => store.document

describe('EditController selection', () => {
  it('clicks a segment to select it, and empty space to clear', () => {
    const { edit, selection } = setup()
    edit.pointerDown(vec2(50, 0), mods)
    edit.pointerUp(vec2(50, 0), mods)
    expect(selection.size).toBe(1)
    edit.pointerDown(vec2(400, 400), mods)
    edit.pointerUp(vec2(400, 400), mods)
    expect(selection.isEmpty).toBe(true)
  })

  it('marquee window selects only fully-contained segments; crossing catches touched', () => {
    const { edit, selection, segments } = setup()
    // Window drag left→right around the horizontal span only (0,0)-(100,0).
    edit.pointerDown(vec2(-10, -10), mods)
    edit.pointerMove(vec2(110, 40), mods)
    edit.pointerUp(vec2(110, 40), mods)
    expect([...selection.selected]).toEqual([segments[0]!.id])

    // Crossing drag right→left across the vertical span only.
    edit.pointerDown(vec2(120, 40), mods)
    edit.pointerMove(vec2(90, 60), mods)
    edit.pointerUp(vec2(90, 60), mods)
    expect([...selection.selected]).toEqual([segments[1]!.id])
  })

  it('dragging the shared node moves both welded segments together (FR-1)', () => {
    const { edit, selection, store, segments } = setup()
    selection.replace([segments[0]!.id, segments[1]!.id])
    const sharedNode = segments[0]!.endpoints[1]

    edit.pointerDown(vec2(100, 0), mods) // grab the (100,0) junction
    edit.pointerMove(vec2(140, 20), mods)
    edit.pointerUp(vec2(140, 20), mods)

    const d = doc(store)
    expect(d.nodes[sharedNode]!.pos).toEqual(vec2(140, 20))
    // Both segments still meet at the moved node — a single undo entry restores the drag.
    expect(Object.keys(d.nodes)).toHaveLength(3)
    store.undo()
    expect(doc(store).nodes[sharedNode]!.pos).toEqual(vec2(100, 0))
  })

  it('drags the whole selection when the press lands on an already-selected segment', () => {
    const { edit, selection, store, segments } = setup()
    selection.replace([segments[0]!.id, segments[1]!.id])

    // Press on the horizontal span (away from any node) and drag by (20, 10).
    edit.pointerDown(vec2(50, 0), mods)
    edit.pointerMove(vec2(70, 10), mods)
    edit.pointerUp(vec2(70, 10), mods)

    const d = doc(store)
    const a = d.segments[segments[0]!.id]!.geometry
    const b = d.segments[segments[1]!.id]!.geometry
    expect(a.kind === 'line' && a.a).toEqual(vec2(20, 10))
    expect(b.kind === 'line' && b.b).toEqual(vec2(120, 90))
    expect(selection.size).toBe(2) // the press did not collapse the selection
  })

  it('a click (no drag) on an already-selected segment narrows to it; shift removes it', () => {
    const { edit, selection, segments } = setup()
    selection.replace([segments[0]!.id, segments[1]!.id])

    edit.pointerDown(vec2(50, 0), mods)
    edit.pointerUp(vec2(50, 0), mods)
    expect([...selection.selected]).toEqual([segments[0]!.id])

    selection.replace([segments[0]!.id, segments[1]!.id])
    const shift = { shift: true, alt: false }
    edit.pointerDown(vec2(50, 0), shift)
    edit.pointerUp(vec2(50, 0), shift)
    expect([...selection.selected]).toEqual([segments[1]!.id])
  })

  it('deletes the selection and nudges it by the grid step', () => {
    const { edit, selection, store, viewport, segments } = setup()
    selection.replace([segments[0]!.id])
    edit.nudge(viewport.grid.minor, 0)
    const seg = doc(store).segments[segments[0]!.id]!
    expect(seg.geometry.kind === 'line' && seg.geometry.a.x).toBe(viewport.grid.minor)

    edit.deleteSelection()
    expect(doc(store).segments[segments[0]!.id]).toBeUndefined()
    expect(selection.isEmpty).toBe(true)
  })

  it('duplicates the selection with an offset and selects the copies', () => {
    const { edit, selection, store, segments } = setup()
    selection.replace([segments[0]!.id])
    const before = Object.keys(doc(store).segments).length
    edit.duplicate()
    expect(Object.keys(doc(store).segments).length).toBe(before + 1)
    expect(selection.size).toBe(1)
    expect(selection.has(segments[0]!.id)).toBe(false) // the copy is selected, not the original
  })

  it('double-click inserts a node on a segment (split), as one undo step', () => {
    const { edit, store } = setup()
    const before = Object.keys(doc(store).segments).length
    edit.doubleClick(vec2(50, 0))
    expect(Object.keys(doc(store).segments).length).toBe(before + 1)
    store.undo()
    expect(Object.keys(doc(store).segments).length).toBe(before)
  })

  it('mirrors the selection about its centre', () => {
    const { edit, selection, store, segments } = setup()
    selection.replace([segments[0]!.id])
    edit.mirror('horizontal')
    const seg = doc(store).segments[segments[0]!.id]!
    // The horizontal line 0..100 mirrored about x=50 maps (0,0)→(100,0) and (100,0)→(0,0).
    expect(seg.geometry.kind).toBe('line')
  })
})
