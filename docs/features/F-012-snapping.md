# F-012: Snapping & construction guides

|                |              |
| -------------- | ------------ |
| **Phase**      | 1 — Sketcher |
| **Status**     | agreed       |
| **Depends on** | F-011        |
| **Complexity** | M            |

## Summary

CAD-grade snapping: endpoints, midpoints, intersections, on-curve, grid, and angle
snaps, with clear visual markers — plus construction geometry (guide lines/circles)
that participates in snapping but never becomes lead. Snapping is what makes piece
detection (F-020) reliable: coincident endpoints must be _exactly_ coincident.

## Scope

- Snap engine consumed by the F-011 tool framework's pointer-resolution hook.
  Priority-ordered snap kinds, each toggleable in a snap settings popover:
  1. endpoint (welds to the existing node's exact coordinates)
  2. intersection of two segments
  3. midpoint
  4. on-curve (nearest point)
  5. grid
  6. angle (0/45/90 relative to gesture start; extension lines from recent points)
- Visual feedback: distinct marker glyph per snap kind at the snap point (square =
  endpoint, × = intersection, triangle = midpoint …), rendered on the overlay layer;
  short text hint near cursor ("endpoint").
- Snap radius in _screen_ pixels (≈8 px) independent of zoom.
- Construction geometry: infinite guide lines (horizontal/vertical/angled through a
  point) and guide circles; drawn with a dedicated tool, stored as `role:
'construction'`, excluded from piece detection, DRC, and all outputs; toggle
  visibility; "clear all guides" command.
- Spatial index (grid hash or R-tree over segment bboxes) so snap queries stay O(local)
  — this index will be reused by selection hit-testing (F-013) and DRC (F-030).

### Non-goals

- Parametric constraints (perpendicular/tangent relationships that persist). Noted as
  post-v1 backlog in F-013.
- Object-tracking snaps (temporary alignment to distant object extensions, Fusion-style)
  beyond the simple extension-line angle snap.

## Functional requirements

- FR-1: With endpoint snap on, clicking within the snap radius of an existing node
  produces a coordinate bit-identical to that node (no epsilon-close duplicates).
- FR-2: Snap priority is deterministic and matches the ordered list; when multiple
  candidates of equal kind exist, nearest wins.
- FR-3: All snap kinds can be toggled; a master toggle (hold a modifier key)
  temporarily disables snapping.
- FR-4: Snap query cost is independent of total segment count in practice (index-backed);
  60 fps preserved while drawing in the 5,000-segment stress scene.
- FR-5: Construction segments never appear in piece detection results or any export.

## Acceptance criteria

- Unit tests: snap resolution given synthetic scenes for each kind and the priority
  order; bit-identity of welded endpoints.
- Manual: draw a 6-fold rosette using guide circles + angle snaps; verify every
  junction welds (inspect node coordinates in a debug panel).

## Open questions

_Resolved by Mathieu 2026-07-18:_

1. Snap radius is screen-space and zoom-independent: **8 px for mouse, 12 px for pen/touch**,
   differentiated via `PointerEvent.pointerType`. Keep the value centralized/configurable in
   the snap settings.
