# F-012: Snapping & construction guides

|                |              |
| -------------- | ------------ |
| **Phase**      | 1 — Sketcher |
| **Status**     | done         |
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

## Implementation notes

_Delivered 2026-07-18 (branch `f-012-snapping`, merged to `main`). Mathieu accepted the
feature and directed the merge, taking the subjective "6-fold rosette, every junction welds"
criterion (supervisor judgment) as signed off, and confirmed both recorded deviations below.
All automated gates verified green by the coordinator before merge._

**Snap engine — pure, in `@vitrum/core/snap/` (DOM/Svelte/Electron-free).** `resolveSnap(scene,
query)` walks the snap kinds in the spec's priority order — endpoint → intersection → midpoint
→ on-curve → grid → angle — and returns the first kind with a candidate inside the radius,
nearest-within-kind (FR-2). Endpoint snapping returns the target's **exact stored coordinate**
(`curveEndpoints` returns `line.a`/`p0`/`arcStart` etc. by reference), so a welded endpoint is
bit-identical to the node — no epsilon-close duplicate (FR-1). Gesture self-anchors are endpoint
candidates too (closing a shape welds to its own start). Grid snaps to the nearest grid node
within the radius; angle snaps the cursor onto 0/45/90° rays from the last anchor plus H/V
extension lines through every anchor, returning overlay guide segments. The screen-px radius is
converted to world mm by the viewport scale in the UI, so snapping is zoom-independent.

**Spatial index — reusable, in `@vitrum/core/snap/spatialIndex.ts`.** `GridIndex` is a generic
grid-hash over item bboxes with O(local) window queries (FR-4). Cell size defaults to the median
item extent. Items whose bbox spans more than a cap of cells (an "infinite" guide, stored as a
huge finite line) go in an always-checked oversized list, so a guide never smears the grid. It
stores only bboxes + integer ids, so F-013 hit-testing and F-030 DRC can reuse it unchanged.

**F-011 seam — zero tool changes, zero shared-contract changes.** The snap engine is wired
through `SnapController` (`@vitrum/ui/src/tools/snap.svelte.ts`), whose `resolver` replaces the
identity stub via `tools.resolver = snap.resolver` in `AppShell`. It holds the reactive snap
settings, keeps a `GridIndex` scene rebuilt when the visible network changes, and stores the
winning snap as a rune (`hit`) that the canvas overlay reads. **`ResolvedPoint`/`ResolveContext`/
`PointerResolver` were not modified** — pointer device and the master-disable modifier are fed to
the controller by `Canvas` before each dispatch, so no F-011 tool or type changed.

**Construction guides.** New pure `guideTool` (`@vitrum/core/tools/guide.ts`, shortcut **G**,
cycles horizontal → vertical → angled → circle) emits `role: 'construction'` drafts. Guides
participate in snapping but are excluded from the output network via `outputSegments`
(`@vitrum/model/src/network.ts`) — the single place F-020/F-030/export must read (FR-5). Visibility
toggle lives on the viewport (hidden guides neither render nor snap); "clear all guides" is a
reversible `removeSegments` command (`DocumentController.clearGuides`).

**Markers & settings UI (net-new, built from `components/core` + tokens; note for back-port).**
`drawSnapMarker` paints a distinct cobalt glyph per kind (square = endpoint, × = intersection,
triangle = midpoint, circle = on-curve, plus = grid, diamond = angle) plus alignment guides and a
lowercase text hint, all on the overlay layer, guarded on a null 2D context (jsdom). A `Snap` chip
in the status bar opens a `SnapSettings` popover: master toggle, the "8 px mouse · 12 px pen"
radius note, a per-kind switch row in priority order, a show-guides switch, and a clear-all-guides
action.

**Deviations (recorded, within technical-guidance latitude — no FR/AC changed):**

- _Infinite guide lines are stored as very long finite `Line`s_ (`±100 m` about the through-point,
  `role: 'construction'`) rather than a new geometry/model primitive, keeping the F-010 kernel and
  F-002 model contracts untouched. Their huge bbox is absorbed by the index's oversized list, and
  they read as infinite when rendered. A native infinite-line primitive can arrive later if needed.
- _Master temporary-disable modifier = hold **Ctrl/Cmd**._ Shift (constrain) and Alt (tool
  modifier) already carry F-011 drawing semantics, so Ctrl/Cmd is the only free modifier; the spec
  left the specific key open ("hold a modifier key").

**Verification.**

- Core unit tests: `snap.test.ts` (each kind in isolation, priority-over-nearness, nearest-within-
  kind, master off, bit-identity by reference, index-backed cost over a 5,000-segment scene);
  `spatialIndex.test.ts` (window queries, dedupe, oversized handling, local-candidate bound backing
  FR-4); `guide.test.ts` (each guide mode + cancel).
- Model unit test: `network.test.ts` — construction excluded from `outputSegments`, ids listed for
  clear-guides (FR-5).
- UI tests: `snap.svelte.test.ts` (resolver end to end: endpoint weld, master-disable passthrough,
  per-kind toggle, mouse-vs-pen radius); `SnapSettings.test.ts` (popover, toggles, clear-guides).
- E2E: `apps/desktop/e2e/snapping.spec.ts` — draws a line, then clicks a second line's start ~5 px
  off the first endpoint; the distinct-node count drops to 3 (weld) rather than 4 (FR-1) via a new
  debug-palette node-count readout. The guide tool and Snap chip are asserted present.
- Gates green from the repo root: `pnpm lint`, `format:check`, `check`, `test` (349), `test:e2e`
  (11). Drove the app in `pnpm dev:ui`: snap settings popover, guide tool, and overlay all render.

**Supervisor sign-off (2026-07-18).** Mathieu accepted the feature and directed the merge, taking
the subjective "6-fold rosette, every junction welds" criterion as signed off. The weld machinery
is verified by the E2E + bit-identity unit tests; the debug palette shows a distinct-node count for
a hands-on rosette check whenever desired.

**Follow-ups (out of scope):**

- Extension-line angle snapping references only the current gesture's anchors, not distant scene
  objects (Fusion-style object tracking is an explicit non-goal here).
- Guide lines are stored as long finite lines; a native infinite-line primitive would let
  zoom-to-fit and bbox math ignore them without the oversized-list workaround.
- Snapping to hidden guides is intentionally off (visibility gates both render and snap); a
  "snap to hidden guides" option could come with F-013 if requested.
- Intersection snapping is computed over local candidates each move; if profiling later shows it
  hot on dense curved scenes, intersections could be precomputed into the index.
