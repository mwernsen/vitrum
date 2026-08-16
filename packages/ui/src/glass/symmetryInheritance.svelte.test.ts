import { pieceKey, type Piece } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import { addSegments, setGlassAssignments, weldSegments, type GlassId } from '@vitrum/model'
import { afterEach, describe, expect, it } from 'vitest'

import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'
import { PaintController } from '../tools/paint.svelte'
import { SymmetryController } from '../tools/symmetry.svelte'
import { ViewportController } from '../canvas/viewport.svelte'

import { AssignmentController } from './assignment.svelte'

/**
 * Glass across live symmetry replicas (F-052 [S2], user-test run `docs/testing/runs/2026-08-16-a`),
 * end to end through the real seams: document → expansion → detection → orbits → resolution → paint.
 *
 * The load-bearing behaviours are (a) painting the source sector colours every replica, (b) painting a
 * replica writes **through** to its source rather than creating a hidden local override, and (c) the
 * colours the user was looking at survive **bake**, when replicas become ordinary stored segments.
 */

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

const GLASS = 'glass-amber' as GlassId

/** A wired-up editor: document + symmetry + assignment resolution + paint, sharing one document. */
function editor() {
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  const symmetry = new SymmetryController({
    getDoc: () => ctrl.doc,
    execute: (command) => ctrl.execute(command),
    defaultCenter: () => vec2(0, 0),
  })
  const assignments = new AssignmentController()
  let pieces: readonly Piece[] = []
  const paint = new PaintController({
    viewport: new ViewportController(),
    assignments,
    getPieces: () => pieces,
    execute: (command) => ctrl.execute(command),
  })

  /** Re-run what the shell's effects do: detect, then resolve the effective glass. */
  const refresh = (): readonly Piece[] => {
    const detection = ctrl.detect()
    pieces = detection.pieces
    assignments.update(detection, pieces, detection.lineage, ctrl.doc.assignments)
    return pieces
  }

  /** Materialise every live piece's effective glass, as the shell's save-time normaliser does. */
  const normalizeForSave = (): void => {
    const stored = ctrl.doc.assignments
    const patch: Record<string, GlassId | null> = {}
    for (const piece of pieces) {
      const key = pieceKey(piece)
      const glass = assignments.glassFor(piece)
      if (glass && stored[key] !== glass) patch[key] = glass
    }
    if (Object.keys(patch).length > 0) ctrl.execute(setGlassAssignments(patch))
  }

  return { ctrl, symmetry, assignments, paint, refresh, normalizeForSave, pieces: () => pieces }
}

/** Draw a closed square in the source sector (x > 0, y > 0 — the domain for a vertical mirror). */
function drawSourceSquare(ctrl: DocumentController): void {
  const corners = [vec2(40, 40), vec2(100, 40), vec2(100, 100), vec2(40, 100)]
  const { segments } = weldSegments(
    corners.map((a, i) => ({
      geometry: line(a, corners[(i + 1) % corners.length]!),
      role: 'lead',
    })),
  )
  ctrl.execute(addSegments(segments))
}

/** The single stored assignment entries, for asserting the document stays minimal. */
function storedEntries(ctrl: DocumentController): [string, GlassId][] {
  return Object.entries(ctrl.doc.assignments)
}

describe('glass across live symmetry replicas (F-052 [S2])', () => {
  it('paints the source sector once and colours every replica', () => {
    const e = editor()
    drawSourceSquare(e.ctrl)
    e.symmetry.setMode('radial')
    e.symmetry.setCount(4)

    const pieces = e.refresh()
    expect(pieces).toHaveLength(4)
    expect(pieces.filter((p) => e.assignments.glassFor(p))).toHaveLength(0)

    // Paint the source-sector piece (the one the orbit map names as the source).
    e.assignments.setSelectedGlass(GLASS)
    const source = pieces.find((p) => !e.assignments.isReplica(pieceKey(p)))!
    e.paint.setMode('select')
    e.paint.selectedPieces.add(pieceKey(source))
    e.paint.assignSelected(GLASS)

    e.refresh()
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === GLASS)).toBe(true)
    // One stored entry for four coloured pieces: replicas stay derived (F-052 Decision §2).
    expect(storedEntries(e.ctrl)).toEqual([[pieceKey(source), GLASS]])
  })

  it('writes a paint on a replica through to its source, in one undo step', () => {
    const e = editor()
    drawSourceSquare(e.ctrl)
    e.symmetry.setMode('radial')
    e.symmetry.setCount(4)
    const pieces = e.refresh()

    const source = pieces.find((p) => !e.assignments.isReplica(pieceKey(p)))!
    const replica = pieces.find((p) => e.assignments.isReplica(pieceKey(p)))!

    e.assignments.setSelectedGlass(GLASS)
    e.paint.selectedPieces.add(pieceKey(replica))
    e.paint.assignSelected(GLASS)
    e.refresh()

    // The write landed on the source, not on the clicked replica, and the whole orbit shows it.
    expect(storedEntries(e.ctrl)).toEqual([[pieceKey(source), GLASS]])
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === GLASS)).toBe(true)

    // One undo entry for the whole orbit (the document is back to no assignments at all).
    e.ctrl.undo()
    expect(storedEntries(e.ctrl)).toEqual([])
  })

  it('unassigning a replica clears the orbit, not just that sector', () => {
    const e = editor()
    drawSourceSquare(e.ctrl)
    e.symmetry.setMode('radial')
    e.symmetry.setCount(4)
    e.refresh()

    const source = e.pieces().find((p) => !e.assignments.isReplica(pieceKey(p)))!
    e.assignments.setSelectedGlass(GLASS)
    e.paint.selectedPieces.add(pieceKey(source))
    e.paint.assignSelected(GLASS)
    e.refresh()
    expect(storedEntries(e.ctrl)).toHaveLength(1)

    e.paint.selectedPieces.clear()
    e.paint.selectedPieces.add(
      pieceKey(e.pieces().find((p) => e.assignments.isReplica(pieceKey(p)))!),
    )
    e.paint.unassignSelected()
    expect(storedEntries(e.ctrl)).toEqual([])
  })

  it('clears a stale per-replica entry so a repaint is never invisible', () => {
    // The state a saved file (or the save-time normaliser) leaves behind: a direct entry on every
    // replica. Those entries outrank the source, so painting must clear the orbit's siblings.
    const e = editor()
    drawSourceSquare(e.ctrl)
    e.symmetry.setMode('radial')
    e.symmetry.setCount(4)
    e.refresh()

    const source = e.pieces().find((p) => !e.assignments.isReplica(pieceKey(p)))!
    e.assignments.setSelectedGlass(GLASS)
    e.paint.selectedPieces.add(pieceKey(source))
    e.paint.assignSelected(GLASS)
    e.refresh()
    e.normalizeForSave() // materialises all four, as a save does
    e.refresh()
    expect(storedEntries(e.ctrl)).toHaveLength(4)

    // Repaint in a different glass: the source entry is rewritten and the three stale ones dropped.
    const other = 'glass-ruby' as GlassId
    e.assignments.setSelectedGlass(other)
    e.paint.selectedPieces.clear()
    e.paint.selectedPieces.add(
      pieceKey(e.pieces().find((p) => e.assignments.isReplica(pieceKey(p)))!),
    )
    e.paint.assignSelected(other)
    e.refresh()

    expect(storedEntries(e.ctrl)).toEqual([[pieceKey(source), other]])
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === other)).toBe(true)
  })

  it('keeps every colour the user saw when the symmetry is baked (FR-3)', () => {
    const e = editor()
    drawSourceSquare(e.ctrl)
    e.symmetry.setMode('radial')
    e.symmetry.setCount(4)
    e.refresh()

    const source = e.pieces().find((p) => !e.assignments.isReplica(pieceKey(p)))!
    e.assignments.setSelectedGlass(GLASS)
    e.paint.selectedPieces.add(pieceKey(source))
    e.paint.assignSelected(GLASS)
    e.refresh()
    const beforeBake = e.pieces().map((p) => ({ at: p.centroid, glass: e.assignments.glassFor(p) }))
    expect(beforeBake.every(({ glass }) => glass === GLASS)).toBe(true)

    // Bake: the replicas become ordinary segments and the mode turns off, so the orbit map is gone.
    e.symmetry.bake()
    e.refresh()
    expect(e.ctrl.doc.symmetry.mode).toBe('none')
    expect(e.pieces()).toHaveLength(4)
    expect(e.pieces().every((p) => e.assignments.isReplica(pieceKey(p)))).toBe(false)

    // Every region the user was looking at keeps its colour. Matching is by position, because bake
    // re-mints segment ids and F-020 canonicalizes a ring's start span by segment id — so a baked
    // replica gets a *new* content id even though its geometry is unchanged. F-023's edit lineage is
    // what carries the colour across that re-key.
    for (const { at, glass } of beforeBake) {
      const now = e
        .pieces()
        .find((p) => Math.hypot(p.centroid.x - at.x, p.centroid.y - at.y) < 1e-6)
      expect(now).toBeDefined()
      expect(e.assignments.glassFor(now!)).toBe(glass)
    }

    // And they persist: the save-time normaliser now materialises all four under their own keys.
    e.normalizeForSave()
    e.refresh()
    expect(storedEntries(e.ctrl)).toHaveLength(4)
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === GLASS)).toBe(true)

    // Undoing the bake restores the derived replicas, still coloured.
    e.ctrl.undo() // the normalisation
    e.ctrl.undo() // the bake
    e.refresh()
    expect(e.ctrl.doc.symmetry.mode).toBe('radial')
    expect(e.pieces()).toHaveLength(4)
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === GLASS)).toBe(true)
  })

  it('follows the setup: raising the fold count colours the new sectors too', () => {
    const e = editor()
    drawSourceSquare(e.ctrl)
    e.symmetry.setMode('radial')
    e.symmetry.setCount(4)
    e.refresh()

    const source = e.pieces().find((p) => !e.assignments.isReplica(pieceKey(p)))!
    e.assignments.setSelectedGlass(GLASS)
    e.paint.selectedPieces.add(pieceKey(source))
    e.paint.assignSelected(GLASS)
    e.refresh()

    e.symmetry.setCount(6)
    e.refresh()
    expect(e.pieces()).toHaveLength(6)
    expect(e.pieces().every((p) => e.assignments.glassFor(p) === GLASS)).toBe(true)
  })

  it('leaves an asymmetric document exactly as F-023 had it', () => {
    const e = editor()
    drawSourceSquare(e.ctrl)
    const pieces = e.refresh()
    expect(pieces).toHaveLength(1)
    expect(e.assignments.isReplica(pieceKey(pieces[0]!))).toBe(false)

    e.assignments.setSelectedGlass(GLASS)
    e.paint.selectedPieces.add(pieceKey(pieces[0]!))
    e.paint.assignSelected(GLASS)
    e.refresh()
    expect(storedEntries(e.ctrl)).toEqual([[pieceKey(pieces[0]!), GLASS]])
  })
})
