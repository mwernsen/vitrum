import { pieceKey, type Piece } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import { addSegments, setGlassAssignments, weldSegments, type GlassId } from '@vitrum/model'
import { afterEach, describe, expect, it } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'
import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'
import { PaintController } from '../tools/paint.svelte'
import { SymmetryController } from '../tools/symmetry.svelte'

import { AssignmentController } from './assignment.svelte'

/**
 * Removing a glass takes effect immediately (F-023 FR-1, fix of 2026-08-16).
 *
 * The bug this pins down: with the geometry unchanged, a re-detection's lineage maps every piece to
 * *itself*, so a resolver that carried resolved **values** forward handed a piece back the colour the
 * user had just cleared. Unassigning looked like it did nothing, undoing a paint left the colour on
 * screen, and the save-time normaliser then wrote the resurrected colour back as a direct assignment —
 * making the removal permanent. Both user paths are covered here, through the real seams: document →
 * detection → resolution → paint.
 */

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

const GLASS = 'glass-amber' as GlassId

/** A wired-up editor: document + assignment resolution + paint, sharing one document. */
function editor() {
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  const assignments = new AssignmentController()
  let pieces: readonly Piece[] = []
  const paint = new PaintController({
    viewport: new ViewportController(),
    assignments,
    getPieces: () => pieces,
    execute: (command) => ctrl.execute(command),
  })
  const symmetry = new SymmetryController({
    getDoc: () => ctrl.doc,
    execute: (command) => ctrl.execute(command),
    defaultCenter: () => vec2(0, 0),
  })

  /** Re-run what the shell's effects do after every document change: detect, then resolve. */
  const refresh = (): readonly Piece[] => {
    const detection = ctrl.detect()
    pieces = detection.pieces
    assignments.update(detection, pieces, detection.lineage, ctrl.doc.assignments)
    return pieces
  }

  /** The shell's save-time normaliser: materialise live pieces, drop vanished ones (FR-5). */
  const normalizeForSave = (): void => {
    const stored = ctrl.doc.assignments
    const patch: Record<string, GlassId | null> = {}
    const live: Record<string, true> = {}
    for (const piece of pieces) {
      const key = pieceKey(piece)
      live[key] = true
      const glass = assignments.glassFor(piece)
      if (glass && stored[key] !== glass) patch[key] = glass
    }
    for (const key of Object.keys(stored)) if (!live[key]) patch[key] = null
    if (Object.keys(patch).length > 0) ctrl.execute(setGlassAssignments(patch))
  }

  /** Paint one piece the way the inspector's bulk assign does (one command). */
  const paintPiece = (piece: Piece, glass: GlassId = GLASS): void => {
    assignments.setSelectedGlass(glass)
    paint.selectedPieces.clear()
    paint.selectedPieces.add(pieceKey(piece))
    paint.assignSelected(glass)
    refresh()
  }

  /** Unassign one piece the way the inspector's "Unassign" button does (one command). */
  const unassignPiece = (piece: Piece): void => {
    paint.selectedPieces.clear()
    paint.selectedPieces.add(pieceKey(piece))
    paint.unassignSelected()
    refresh()
  }

  return {
    ctrl,
    assignments,
    paint,
    symmetry,
    refresh,
    normalizeForSave,
    paintPiece,
    unassignPiece,
    pieces: () => pieces,
  }
}

/** Draw a closed square in the first quadrant (valid as a symmetry source sector too). */
function drawSquare(ctrl: DocumentController): void {
  const corners = [vec2(40, 40), vec2(100, 40), vec2(100, 100), vec2(40, 100)]
  const { segments } = weldSegments(
    corners.map((a, i) => ({
      geometry: line(a, corners[(i + 1) % corners.length]!),
      role: 'lead',
    })),
  )
  ctrl.execute(addSegments(segments))
}

/** Add a vertical divider that splits the square into two pieces. */
function drawDivider(ctrl: DocumentController, x: number): void {
  const { segments } = weldSegments([{ geometry: line(vec2(x, 40), vec2(x, 100)), role: 'lead' }])
  ctrl.execute(addSegments(segments))
}

describe('removing a glass takes effect immediately (F-023 FR-1)', () => {
  it('clears the colour on unassign, with no geometry change and no reload', () => {
    const e = editor()
    drawSquare(e.ctrl)
    const piece = e.refresh()[0]!
    e.paintPiece(piece)
    expect(e.assignments.glassFor(e.pieces()[0]!)).toBe(GLASS)

    e.unassignPiece(e.pieces()[0]!)
    expect(e.assignments.glassFor(e.pieces()[0]!)).toBeUndefined()
    expect(e.ctrl.doc.assignments).toEqual({})
  })

  it('clears the colour when a paint is undone', () => {
    const e = editor()
    drawSquare(e.ctrl)
    e.paintPiece(e.refresh()[0]!)
    expect(e.assignments.glassFor(e.pieces()[0]!)).toBe(GLASS)

    e.ctrl.undo()
    e.refresh()
    expect(e.assignments.glassFor(e.pieces()[0]!)).toBeUndefined()

    // And redo brings it back, so undo/redo of a paint is symmetric.
    e.ctrl.redo()
    e.refresh()
    expect(e.assignments.glassFor(e.pieces()[0]!)).toBe(GLASS)
  })

  it('does not let the save-time normaliser write a removed colour back', () => {
    // The normaliser materialises every live piece's effective glass. While the resolver resurrected
    // a cleared colour, saving after an unassign filed it again as a direct assignment — permanently.
    const e = editor()
    drawSquare(e.ctrl)
    e.paintPiece(e.refresh()[0]!)
    e.unassignPiece(e.pieces()[0]!)

    e.normalizeForSave()
    e.refresh()
    expect(e.ctrl.doc.assignments).toEqual({})
    expect(e.assignments.glassFor(e.pieces()[0]!)).toBeUndefined()
  })

  it('keeps split inheritance alive: clearing the parent entry clears both fragments (FR-2)', () => {
    const e = editor()
    drawSquare(e.ctrl)
    e.paintPiece(e.refresh()[0]!)

    drawDivider(e.ctrl, 70)
    const split = e.refresh()
    expect(split).toHaveLength(2)
    // Inheritance still works — the fragments have no entry of their own.
    expect(split.every((p) => e.assignments.glassFor(p) === GLASS)).toBe(true)
    expect(Object.keys(e.ctrl.doc.assignments)).toHaveLength(1)

    // Undoing the paint (two undos back through the divider) removes the colour from both.
    e.ctrl.undo() // the divider
    e.ctrl.undo() // the paint
    e.refresh()
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === undefined)).toBe(true)
  })

  it('still cannot clear an inherited colour piece-by-piece (known limitation)', () => {
    // Pins the one case the fix does *not* reach, so the follow-up has something to flip. A split
    // fragment has no stored entry of its own — its colour is read from the (now vanished) parent key,
    // which its sibling reads too. Unassigning it can only be expressed by dropping that shared entry,
    // and doing so leaves the transient provenance out of step with the undo stack. The clean answer
    // is to persist inheritance when the edit re-keys the piece; see F-023's follow-ups.
    const e = editor()
    drawSquare(e.ctrl)
    e.paintPiece(e.refresh()[0]!)
    drawDivider(e.ctrl, 70)
    const split = e.refresh()
    const [left] = [...split].sort((a, b) => a.centroid.x - b.centroid.x)
    expect(e.assignments.isDirect(pieceKey(left!))).toBe(false)

    e.unassignPiece(left!)
    expect(e.assignments.glassFor(e.pieces()[0]!)).toBe(GLASS)
    // Saving first materialises each fragment's own entry, and then the unassign does clear it.
    e.normalizeForSave()
    e.refresh()
    const materialised = [...e.pieces()].sort((a, b) => a.centroid.x - b.centroid.x)[0]!
    expect(e.assignments.isDirect(pieceKey(materialised))).toBe(true)
    e.unassignPiece(materialised)
    const cleared = e.pieces().find((p) => pieceKey(p) === pieceKey(materialised))!
    const kept = e.pieces().find((p) => pieceKey(p) !== pieceKey(materialised))!
    expect(e.assignments.glassFor(cleared)).toBeUndefined()
    expect(e.assignments.glassFor(kept)).toBe(GLASS)
  })

  it('clears the whole orbit when a symmetric piece is unassigned (F-052)', () => {
    const e = editor()
    drawSquare(e.ctrl)
    e.symmetry.setMode('radial')
    e.symmetry.setCount(4)
    e.refresh()
    const source = e.pieces().find((p) => !e.assignments.isReplica(pieceKey(p)))!
    e.paintPiece(source)
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === GLASS)).toBe(true)

    // Unassign through a *replica*: the write routes to the source, and every sector clears.
    e.unassignPiece(e.pieces().find((p) => e.assignments.isReplica(pieceKey(p)))!)
    expect(e.ctrl.doc.assignments).toEqual({})
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === undefined)).toBe(true)
  })
})
