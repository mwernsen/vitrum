import { detectPieces, makeViewport, pieceKey, type PieceSegment } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import { createEmptyProject, type Command, type Project } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import type { ViewportController } from '../canvas/viewport.svelte'
import { AssignmentController } from '../glass/assignment.svelte'

import { PaintController } from './paint.svelte'

/** A unit square divided vertically at x=50 → a left and a right rectangle. */
function splitSquare(): PieceSegment[] {
  const n = { a: vec2(0, 0), b: vec2(100, 0), c: vec2(100, 100), d: vec2(0, 100) }
  return [
    { id: 's0', geometry: line(n.a, n.b), role: 'lead', endpoints: ['a', 'b'] },
    { id: 's1', geometry: line(n.b, n.c), role: 'lead', endpoints: ['b', 'c'] },
    { id: 's2', geometry: line(n.c, n.d), role: 'lead', endpoints: ['c', 'd'] },
    { id: 's3', geometry: line(n.d, n.a), role: 'lead', endpoints: ['d', 'a'] },
    { id: 'div', geometry: line(vec2(50, 0), vec2(50, 100)), role: 'lead', endpoints: ['e', 'f'] },
  ]
}

function setup() {
  const pieces = detectPieces(splitSquare()).pieces
  const left = pieces.find((p) => p.centroid.x < 50)!
  const right = pieces.find((p) => p.centroid.x > 50)!

  const assignments = new AssignmentController()
  const commands: Command[] = []
  // A viewport with scale 1 and no offset → screen coordinates equal world coordinates.
  const viewport = { transform: makeViewport(1, vec2(0, 0)) } as unknown as ViewportController

  const paint = new PaintController({
    viewport,
    assignments,
    getPieces: () => pieces,
    execute: (c) => commands.push(c),
  })

  // Apply every captured command onto an empty project to read the resulting assignments.
  const result = (): Project =>
    commands.reduce<Project>((doc, c) => c.apply(doc), createEmptyProject())

  return { paint, assignments, commands, pieces, left, right, result }
}

const mods = { shift: false, alt: false }

describe('PaintController (F-023)', () => {
  it('paints the piece under the cursor with the selected glass in one command', () => {
    const { paint, assignments, left, commands, result } = setup()
    paint.setMode('paint')
    assignments.setSelectedGlass('glass-1')
    paint.pointerDown(left.centroid, mods)
    paint.pointerUp()
    expect(commands).toHaveLength(1)
    expect(result().assignments).toEqual({ [pieceKey(left)]: 'glass-1' })
  })

  it('drag-paints across several pieces as a single undo step', () => {
    const { paint, assignments, left, right, commands, result } = setup()
    paint.setMode('paint')
    assignments.setSelectedGlass('glass-1')
    paint.pointerDown(left.centroid, mods)
    paint.pointerMove(right.centroid)
    paint.pointerUp()
    expect(commands).toHaveLength(1)
    expect(result().assignments).toEqual({
      [pieceKey(left)]: 'glass-1',
      [pieceKey(right)]: 'glass-1',
    })
  })

  it('does nothing when no glass is selected', () => {
    const { paint, left, commands } = setup()
    paint.setMode('paint')
    paint.pointerDown(left.centroid, mods)
    paint.pointerUp()
    expect(commands).toHaveLength(0)
  })

  it('Alt-click eyedrops the piece glass into the selection', () => {
    const { paint, assignments, left, pieces, commands } = setup()
    // Prime the effective map so the left piece resolves to a glass.
    assignments.update({}, pieces, {}, { [pieceKey(left)]: 'glass-7' })
    paint.setMode('paint')
    paint.pointerDown(left.centroid, { shift: false, alt: true })
    paint.pointerUp()
    expect(assignments.selectedGlassId).toBe('glass-7')
    expect(commands).toHaveLength(0) // eyedrop never assigns
  })

  it('fills every unassigned piece in one command', () => {
    const { paint, assignments, commands, result, pieces } = setup()
    paint.setMode('paint')
    assignments.setSelectedGlass('glass-1')
    paint.paintAllUnassigned()
    expect(commands).toHaveLength(1)
    expect(Object.keys(result().assignments)).toHaveLength(pieces.length)
  })

  it('select mode picks pieces and shift-adds to the selection', () => {
    const { paint, left, right } = setup()
    paint.setMode('select')
    paint.pointerDown(left.centroid, mods)
    expect([...paint.selectedPieces]).toEqual([pieceKey(left)])
    paint.pointerDown(right.centroid, { shift: true, alt: false })
    expect(paint.selectedPieces.size).toBe(2)
    // A plain click on empty space clears.
    paint.pointerDown(vec2(999, 999), mods)
    expect(paint.selectedPieces.size).toBe(0)
  })

  it('bulk-assigns the selected pieces in one command', () => {
    const { paint, left, right, commands, result } = setup()
    paint.setMode('select')
    paint.pointerDown(left.centroid, mods)
    paint.pointerDown(right.centroid, { shift: true, alt: false })
    paint.assignSelected('glass-2')
    expect(commands).toHaveLength(1)
    expect(result().assignments).toEqual({
      [pieceKey(left)]: 'glass-2',
      [pieceKey(right)]: 'glass-2',
    })
  })

  it('switching away from select mode clears the piece selection', () => {
    const { paint, left } = setup()
    paint.setMode('select')
    paint.pointerDown(left.centroid, mods)
    expect(paint.selectedPieces.size).toBe(1)
    paint.setMode('paint')
    expect(paint.selectedPieces.size).toBe(0)
  })
})

describe('PaintController — live symmetry (F-052)', () => {
  /** The same two rectangles, but the right one is a live replica of the left (the source). */
  function mirrored(stored: Record<string, string> = {}) {
    const s = setup()
    const detection = detectPieces(splitSquare())
    s.assignments.update(
      { ...detection, symLineage: { [pieceKey(s.right)]: pieceKey(s.left) } },
      s.pieces,
      detection.lineage,
      stored,
    )
    return s
  }

  it('routes a paint on a replica to its source piece', () => {
    const { paint, assignments, right, left, commands, result } = mirrored()
    paint.setMode('paint')
    assignments.setSelectedGlass('glass-1')
    paint.pointerDown(right.centroid, mods)
    paint.pointerUp()
    expect(commands).toHaveLength(1)
    expect(result().assignments).toEqual({ [pieceKey(left)]: 'glass-1' })
  })

  it('drag-painting both sectors still writes one source entry', () => {
    const { paint, assignments, left, right, commands, result } = mirrored()
    paint.setMode('paint')
    assignments.setSelectedGlass('glass-1')
    paint.pointerDown(right.centroid, mods)
    paint.pointerMove(left.centroid)
    paint.pointerUp()
    expect(commands).toHaveLength(1)
    expect(result().assignments).toEqual({ [pieceKey(left)]: 'glass-1' })
  })

  /** The replica (right-hand) piece's content key, before a scenario is built. */
  function replicaKey(): string {
    return pieceKey(detectPieces(splitSquare()).pieces.find((p) => p.centroid.x > 50)!)
  }

  it('clears a stale direct entry on the replica so the source colour is what shows', () => {
    const { paint, assignments, left, right, commands, result } = mirrored({
      [replicaKey()]: 'glass-old',
    })
    paint.setMode('paint')
    assignments.setSelectedGlass('glass-1')
    paint.pointerDown(right.centroid, mods)
    paint.pointerUp()
    expect(commands).toHaveLength(1)
    // Applied over a document that already holds the stale entry, the patch removes it.
    const doc = commands.reduce((d, c) => c.apply(d), {
      ...createEmptyProject(),
      assignments: { [pieceKey(right)]: 'glass-old' },
    })
    expect(doc.assignments).toEqual({ [pieceKey(left)]: 'glass-1' })
    expect(result().assignments).toEqual({ [pieceKey(left)]: 'glass-1' })
  })

  it('unassigning a replica clears the source entry too', () => {
    const { paint, right, left, commands, result } = mirrored()
    paint.setMode('select')
    paint.pointerDown(right.centroid, mods)
    paint.unassignSelected()
    expect(commands).toHaveLength(1)
    const doc = commands.reduce((d, c) => c.apply(d), {
      ...createEmptyProject(),
      assignments: { [pieceKey(left)]: 'glass-1' },
    })
    expect(doc.assignments).toEqual({})
    expect(result().assignments).toEqual({})
  })
})
