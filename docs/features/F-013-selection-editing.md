# F-013: Selection, node editing & transforms

|                |              |
| -------------- | ------------ |
| **Phase**      | 1 — Sketcher |
| **Status**     | done         |
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

_Resolved 2026-07-18 (spike run; Mathieu delegated the call to the coordinator):_

1. **Shared-node in the model vs derived-by-coincidence → Option B, stored nodes.**
   The spike showed the F-011/F-012 "bit-identical by reference" weld is a construction-time
   convenience, not a durable invariant (JSON has no references; the first `updateSegmentGeometry`
   rebuilds geometry), so coincidence must be re-established durably regardless. Bare derived +
   exact equality tears arc-adjacent junctions on the first rotate (arc endpoints are computed from
   centre/radius/angle → ~7e-15 mm drift). Stored nodes make FR-1 a **structural invariant**, the
   migration is cheapest now (schema v1, no user data), and it matches the product's CAD-discipline
   principles and the likely F-06x constraint future.

   **Model change:** add `NodeId` and `nodes: Record<NodeId, { pos: Vec2 }>` to `Project`; `Line`
   `a`/`b` and `CubicBezier` `p0`/`p3` carry endpoint node-refs (handles stay free); welded = same
   node id. New commands `moveNode` (mergeable — one drag = one undo, mirroring the existing
   `updateSegmentGeometry` merge pattern), `splitSegmentAtNode`, `mergeNodes`, `deleteNode`. Bump
   `schemaVersion` + one migration synthesising nodes from existing value-equal endpoints.

   **Arc containment:** to avoid rippling a new arc representation through F-010/F-011/F-012 now,
   arcs keep centre/radius/angle for drawing and snapping; on transform or node-edit they **demote
   to cubic béziers** with node-referenced endpoints (mirror already requires this — `transformArc`
   throws on reflection). A native endpoint-node + bulge arc primitive is a possible later
   refinement. FR-1 is guarded by a property test: no edit sequence (incl. mirror) ever separates
   a shared node.

## Implementation notes

_Delivered on branch `f-013-selection-editing` (off `main`); Phase-1 node model reviewed and
approved by the coordinator at the checkpoint, with the arc-demotion override below. Not merged._

**Phase 1 — the stored-node model (`@vitrum/model`, Option B).** `Node = { pos: Vec2 }` + `NodeId`
added to `Project.nodes`; `Segment.endpoints: [NodeId, NodeId]` (Line a/b, Cubic p0/p3, Arc
computed ends; bézier handles stay free). Welded = same node id. Three structural invariants,
enforced in `nodes.ts` and asserted by the property test: no dangling refs, node position
bit-identical to the geometry endpoint (I2), no orphan nodes. `nodes` is always exactly the
referenced set — add/remove/replace reconcile it — so every pre-existing F-002 undo/round-trip
test still passes unchanged. New commands: `moveNode` (mergeable), `splitSegmentAtNode`,
`mergeNodes`, `deleteNode`, plus `transformSegments` (move/rotate/scale/mirror) and a mergeable
`updateSegmentsGeometry` (multi-segment handle edit). All exactly invertible via an internal
`patchNetwork` primitive that self-inverts from the pre-state. `schemaVersion` 1 → 2 with one
migration synthesising nodes from value-equal endpoints.

**Arc demotion — adaptive multi-cubic (coordinator override of the spike's single-cubic
recommendation).** When an arc must stop being circular (an endpoint moves, or a reflection /
non-uniform transform), it demotes to `N = ceil(sweep / 90°)` welded cubic spans (quarter = 1,
semicircle = 2, full circle = 4) so arched tops and circular motifs stay visually faithful on the
mirror workflow. Interior joins are fresh **welded** nodes with deterministic ids (`${segId}~cN` /
`~nN`) so re-application on redo reproduces the drag and undo restores the original single `Arc`
exactly. New geometry helper `isSimilarity`; the single-cubic `arcToCubic` was removed in favour of
the existing `arcToCubics`.

**Phase 2 — selection & editing.** Pure hit-testing in `@vitrum/core/select`: `pickSegments`
reuses the F-012 `GridIndex` and measures true curve distance (`closestPoint`), not bbox (FR-2);
`marqueeSelect` does AutoCAD window/crossing via flattened-polyline containment + Liang–Barsky
edge-crossing (FR-3). `SelectionController` (outside the document, not undoable — click-cycle,
Shift-add, marquee, select-all/invert) and `EditController` (node drag with welded junctions moving
together, bézier-handle drag with live merged commands, double-click-to-split, delete, arrow-nudge,
Cmd-D duplicate, and whole-selection move/rotate/scale/mirror with interactive bbox handles + a
rotate handle, plus inspector numeric variants). All edit drags snap through a new
`SnapController.buildEditResolver` that excludes the dragged segments (no self-snap) and reuses the
F-012 engine; each gesture is one merged command (FR-4). The drawing-tool commit path now welds via
`segmentsFromDrafts` (gesture-internal coincidence + welding onto existing junctions), so drawn
networks are editable without tearing.

**Design.** Selection highlight, node glyphs, bézier + transform handles, marquee (solid = window,
dashed = crossing) and the transform preview are drawn on the overlay layer through tokens only
(`selectionRender.ts`). The inspector gained a selection editor (net-new; note for back-port to the
Claude Design project): per-endpoint x/y, length/angle for a line, count/bbox for a multi-selection,
all in Geist Mono, plus mirror/rotate/duplicate/delete actions built from `Button`/`Input` core
primitives.

**Verification.**

- Model: FR-1 property test (`nodes.test.ts`, 300 runs of random move/split/merge/delete/mirror over
  welded networks — invariants hold after every step and undo-all restores the initial doc exactly)
  plus an arc-demotion property test (200 runs) and welded-drag integrity units (L-junction drag,
  drag coalescing, arc-demote-then-undo-restores-the-arc, split, merge, delete, mirror).
- Core: `pick.test.ts` (true-curve-distance hit-testing incl. bbox-contains-but-curve-far negatives,
  overlap cycling) and `marquee.test.ts` (window/crossing, pass-through crossing, curve in/out).
- UI: `selection.svelte.test.ts` (cycle, shift-add, invert) and `edit.svelte.test.ts` (select,
  marquee window/crossing, welded node drag one-undo, delete, nudge, duplicate, split, mirror).
- E2E: `apps/desktop/e2e/editing.spec.ts` — draw a welded L, select all, mirror via the inspector,
  delete and undo; the debug palette's distinct-node count stays at 3 through the edits (the
  coincidence checker the spec names — a tear would push it to 4).
- Gates green from the repo root: `pnpm lint`, `format:check`, `check`, `test` (384), `test:e2e`
  (12). Drove `pnpm dev:ui`: selection highlight, endpoint node glyphs, the transform handle, and the
  inspector's exact numeric coordinate fields (FR-5) all render per the design system.

**Deviations / recorded decisions.**

- Node refs live on the model `Segment` (`endpoints`), not inside the `@vitrum/geometry` `Line`/
  `Cubic` primitives, keeping the geometry kernel document-free (the boundary rule). This realises
  the spike's "Line a/b / Cubic p0/p3 carry node-refs" at the model layer. Approved at checkpoint.
- Arc demotion is adaptive multi-cubic per the coordinator's override (spike had recommended
  single-cubic).
- `updateSegmentGeometry` stays endpoint-agnostic (interior/handle edits only); endpoint moves go
  through `moveNode`.

**Supervisor sign-off (2026-07-18).** Mathieu accepted the feature and directed the merge, taking
the subjective "rework the F-011 panel heavily without tearing the network" criterion as signed off.
The no-tear invariant is verified automatically (FR-1 property test + arc-demotion property test +
E2E coincidence count + unit tests); the debug palette's distinct-node count remains available for a
hands-on coincidence check whenever desired. All automated gates verified green by the coordinator
before merge (lint, format:check, check, test 384, test:e2e 12).

**Follow-ups (out of scope).**

- For an axis-aligned single-segment selection the transform bbox is degenerate, so its corner
  handles sit on the endpoints and win the hit-test over node-drag; grabbing an endpoint node of such
  a selection is awkward. A small "collapse degenerate handles" pass would fix it.
- Smooth/corner tangent editing across a shared node (mirroring the neighbour handle live) is not yet
  implemented; handle dragging currently moves the grabbed control point only. A one-shot
  `setNodeSmooth` command is the natural home.
- `deleteNode` removes incident spans rather than dissolving a 2-valent node by re-joining its two
  curves; dissolve is a later refinement.
- Edge (single-axis) scale handles were omitted (corners + rotate only).

_Multi-select drag fix (2026-07-31):_ pressing on a segment used to resolve the click immediately,
which collapsed a multi-selection to the one segment under the cursor — so dragging three selected
lines moved only one. A press that lands on something already selected now leaves the selection
alone and resolves on pointer **up** instead (a click still narrows to one; Shift still toggles it
out), so the drag moves the whole group. The `move` drag also builds its preview on the same event
that crosses the movement threshold, instead of one event later.
