# F-013: Selection, node editing & transforms

|                |              |
| -------------- | ------------ |
| **Phase**      | 1 — Sketcher |
| **Status**     | draft        |
| **Depends on** | F-011        |
| **Complexity** | L            |

## Summary

Making drawn geometry editable: click/marquee selection, moving and deleting segments,
dragging nodes (with welded junctions staying welded), bézier handle editing, and
whole-selection transforms (move/rotate/scale/mirror). Plus an inspector panel showing
exact numeric coordinates/dimensions for the selection — editable, CAD-style.

## Scope

- **Selection model**: click (with cycle-through on overlapping candidates), Shift-add,
  marquee (window vs crossing semantics like AutoCAD: left→right selects contained,
  right→left selects touched), select-all, invert. Selection state lives outside the
  document (not undoable), highlighted on the overlay layer.
- **Node editing**: dragging a node moves the endpoints of _all_ segments welded there
  (junction integrity — the network must not tear); bézier control handles shown and
  draggable for selected curves, with smooth/corner toggle per node; double-click a
  segment to insert a node (split via F-010); delete node re-joins or removes spans.
- **Segment operations**: delete selection; move by drag or arrow-key nudge (with unit
  step); duplicate (Cmd-D, offset paste).
- **Transforms**: move/rotate/scale/mirror for a multi-selection with interactive
  handles (bounding-box handles + rotation pivot) and numeric entry variants; mirror
  is critical for symmetric panel workflows pre-F-052.
- Inspector panel: shows and allows editing of exact endpoint coordinates, length,
  angle for a single selected segment; shows counts/bbox for multi-selection.
- All edits snap (F-012) and emit merged commands (a drag = one undo step).

### Non-goals

- Persistent parametric constraints (perpendicularity that survives edits). This is
  the classic CAD next step; record as backlog `F-06x constraint solver` — do not
  design for it now beyond keeping node welding explicit.
- Copy/paste across documents; text objects.

## Design

Inspector panel per the Editor screen's inspector in `ui_kits/studio` (F-004), built
from `Input`/`Select` core components; numeric fields in Geist Mono. Selection
highlight and transform handles use the cobalt action accent tokens; marquee and
node glyphs from the semantic overlay tokens.

## Functional requirements

- FR-1: Dragging a welded node never separates coincident endpoints; after any edit
  sequence, endpoint coincidence relations are preserved exactly.
- FR-2: Hit-testing tolerance is zoom-independent (screen px) and uses the F-012
  spatial index; correct for curves, not just their bboxes.
- FR-3: Marquee window/crossing semantics as specified.
- FR-4: Every edit is one undoable command; drag previews don't touch the document
  until pointer-up (or use merge — but undo granularity must be per-gesture).
- FR-5: Numeric edits in the inspector round-trip exactly (typed 62.5 → stored 62.5 mm).

## Technical guidance

- Welding: recommend deriving welds from exact coordinate equality maintained by
  snapping, with a `Node` index computed alongside the document (not stored) —
  the same index F-020 needs. Alternatively store explicit shared nodes in the model;
  spike briefly and discuss with supervisor (this is the biggest structural decision
  in Phase 1 and affects F-020 directly).

## Acceptance criteria

- Unit tests: welded-drag integrity, marquee semantics, hit-testing on curves.
- Manual: take the panel drawn in F-011's acceptance session and rework it heavily
  (move junctions, reshape curves, mirror half) without ever producing a torn network
  — verified by F-020's checker once available, by a debug coincidence-checker until then.

## Open questions

1. Shared-node in the model vs derived-by-coincidence (see Technical guidance) —
   supervisor decision after the spike, since F-020/F-021 build on it.
