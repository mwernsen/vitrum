# F-052: Live symmetry

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-011, F-013                         |
| **Complexity** | L                                    |

## Summary

Draw one half (or one wedge) and see the whole design mirror live — Diafane's
signature feature for rose windows, lancets and medallions, extended CAD-style:
mirror across one or two axes, plus radial repetition (N-fold rotation) which
Diafane doesn't have.

## Scope

- Symmetry setup on the project: none / mirror (1 axis) / double mirror (2 axes) /
  radial N-fold (with optional mirror) around a center point; axes placeable and
  editable as construction-like guides.
- While active: drawing and editing inside the "source" sector reflects live to all
  other sectors; edits to any replica map back to the source (edit anywhere).
- Replicated geometry is _derived_ until **bake**: an explicit "bake symmetry"
  command materializes replicas into ordinary segments (with weld-up at seams) for
  asymmetric finishing. Un-baked symmetric documents store only the source + setup
  (smaller files, always-perfect symmetry).
- Piece detection, DRC and outputs operate on the _full_ (replicated) network.
- Seam handling: geometry crossing the axis/sector boundary is clipped/welded
  coherently — this is the hard part; specify in the expansion pass.

## Functional requirements (sketch — refine at expansion)

- FR-1: With 6-fold radial symmetry, drawing one line yields 6 (or 12 with mirror)
  live replicas; undo removes all together.
- FR-2: Replica networks weld exactly at seams; piece detection sees one coherent
  network with no near-miss violations at the axis.
- FR-3: Bake is one undo step and produces geometry byte-identical to the derived
  replicas.

## Open questions

1. Interaction with F-050 import and F-013 mirror transform (they overlap in use
   cases) — position symmetry as project-level, transforms as ad-hoc; confirm.
