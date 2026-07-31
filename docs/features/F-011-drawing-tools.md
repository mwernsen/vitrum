# F-011: Drawing tools — line, arc, bézier, shapes

|                |                     |
| -------------- | ------------------- |
| **Phase**      | 1 — Sketcher        |
| **Status**     | done                |
| **Depends on** | F-002, F-003, F-010 |
| **Complexity** | L                   |

## Summary

The tools that put lead lines on the canvas: line, arc, bézier curve, and closed
shapes (rectangle, circle/ellipse, regular polygon), plus a border tool for the panel
outline. Establishes the tool-state architecture every later tool (selection,
symmetry, import) plugs into.

## User story

As a designer, I want to draw a panel border and lead lines with precise, predictable
tools so the drawing phase feels like CAD, not like a paint program.

## Scope

- **Tool framework**: a `Tool` interface (activate/deactivate, pointer/key events,
  overlay render, Esc-to-cancel). One active tool at a time; toolbar + single-key
  shortcuts (L, A, B, R, C, P). Every completed gesture emits exactly one document
  command (so one Ctrl-Z removes the whole line, not a point).
- **Line tool**: click-click polyline chaining (each span its own Segment); Shift
  constrains to 0/45/90°; numeric length/angle entry while drawing (type `120` Enter —
  KiCad-style).
- **Arc tool**: three-point arc and center-start-end modes.
- **Bézier tool**: click-drag pen-style input (Illustrator-like); smooth chaining with
  tangent continuity by default, Alt to break tangent.
- **Shape tools**: rectangle, circle/ellipse, regular N-gon — emitted as ordinary
  segments/curves in the network, not special objects (so pieces detect uniformly).
- **Border tool**: draws the panel outline; segments get `role: 'border'`. A document
  may have exactly one border contour (v1).
- Live preview rendering on the overlay layer; cursor crosshair; Esc cancels the
  in-progress element without touching the document.

### Non-goals

- Snapping (F-012 — but the tool framework must expose the hook: tools request
  "resolve this pointer position", snapping decorates it).
- Editing existing geometry (F-013). Freehand/pencil tool (backlog — needs curve
  fitting, revisit after F-051 reference tracing proves the need).

## Functional requirements

- FR-1: Each tool produces geometry through commands; undo after any completed gesture
  removes exactly that gesture's output.
- FR-2: Segments store geometry in world mm; a line drawn with numeric entry `100`
  measures exactly 100 mm.
- FR-3: Shift-constraint and numeric entry work on line and arc tools.
- FR-4: Drawn segments render with distinct styles per role (lead vs border vs
  construction) even before technique settings exist (placeholder widths).
- FR-5: Tool switching mid-gesture cancels cleanly; no orphan preview state.

## Technical guidance

- The tool framework is the real deliverable; the individual tools should be thin.
  Review its API with the supervisor before building all six tools on it.
- Pointer events must use the viewport's `screenToWorld` exclusively — no raw pixels
  in tool logic (tablet/stylus support depends on this).

## Acceptance criteria

- Draw a complete small panel (border + ~20 lead lines with lines, arcs, béziers) in
  a manual session without a single wrong-feeling interaction (supervisor judgment).
- Unit tests per tool: simulated pointer sequences → expected document segments.
- Undo/redo fuzz: random tool gestures interleaved with undo/redo never corrupts the
  document (extends F-002's property test).

## Open questions

_Resolved by Mathieu 2026-07-18:_

1. Polyline chaining UX: consecutive spans **auto-weld into one coincident node**
   (piece detection needs coincident endpoints).
2. Shortcuts: **single-key for v1** (L/A/B/R/C/P activate tools directly; Shift/Alt/
   numeric entry modify the active gesture). KiCad two-tier deferred.

## Implementation notes

_Delivered 2026-07-18 (branch `f-011-drawing-tools`). Framework API reviewed with and
approved by Mathieu at the checkpoint before the remaining tools were built (per the
technical guidance)._

**The tool framework (the real deliverable), pure in `@vitrum/core/tools/`.** Each tool is
a pure, DOM/Svelte/model-free state machine `ToolDef<S>`: `reduce(state, input) →
{ state, commit? }`, plus `preview`, `isActive`, optional `anchors`/`cycleMode`/`hint`.
Inputs (`down`/`move`/`up`/`enter`/`escape`/`numeric`) carry **world-mm** positions —
never pixels. A completed gesture returns `commit: SegmentDraft[]` (geometry + role only),
so the pure layer depends solely on `@vitrum/geometry`. Fully unit-tested by folding input
sequences and asserting on the emitted segments.

**The snapping hook (F-012 seam).** `PointerResolver = (world, ctx) => ResolvedPoint`, with
`identityResolver` as the v1 stub. `ToolController` runs every pointer position through it
(after `viewport.screenToWorld`, before building an input), passing `{ toolId, anchors }`.
F-012 swaps the resolver in with zero tool changes.

**The `ToolController` (`@vitrum/ui/src/tools/`).** One active tool; single-key activation
(L/A/B/R/C/P); Esc cancels the gesture then the tool; Enter finishes/applies numeric;
digits/`.`/`-`/`,` build a unit-aware numeric buffer **only while a gesture is active**
(so `-`/digits stay free for viewport zoom otherwise); Shift/Alt tracked, Shift re-constrains
the rubber band live. Re-pressing the active tool's key cycles its mode (arc construction,
N-gon side count). Each gesture becomes exactly one document command (FR-1, FR-5).

**Tools shipped.** Line (polyline chaining, auto-weld, Shift 0/45/90°, numeric, FR-2/FR-3);
arc (three-point and centre-start-end modes, cycled with `A`; Shift + numeric radius);
bézier pen (click = straight, click-drag = smooth symmetric handles, Alt = cusp); rectangle;
circle/ellipse (circle emits one exact full-circle `Arc`, ellipse four cubic Béziers; modes
cycled with `C`); regular N-gon (sides 3/4/5/6/8/12 cycled with `P`); border (rectangular
outline, `role:'border'`). Shapes emit ordinary welded segments/curves, never special
objects, so piece detection (F-020) treats them uniformly. Distinct render styles per role
(FR-4): border thicker, lead medium, construction dashed/grey (placeholder widths).

**Model additions (`@vitrum/model`).** `addSegments`/`removeSegments` (one gesture = one
undo entry) and `replaceSegments` (the border's one-contour-per-document rule, v1: enforced
in `ToolController`, which removes any existing border on commit). All exactly reversible.

**Deviations from the spec's technical guidance (approved by Mathieu):**

- Pure tool logic lives in `@vitrum/core` (not a new package); tools emit geometry-only
  drafts, so no `core → model` edge is introduced. Approved: keep in `core`.
- `SegmentDraft.role` uses a core-local `DrawRole` type structurally identical to the
  model's `SegmentRole`, to keep the pure layer free of a model dependency.
- Numeric entry is length + optional `,angle` (KiCad-style). Approved as sufficient for v1;
  no `dx,dy`/relative `@` entry.

**Verification.**

- Per-tool Vitest unit tests (simulated pointer sequences → expected segments) for line,
  arc, bézier, and the shape/span tools, plus the pure geometry builders and numeric parser.
- Component/logic tests for `ToolController` (activation, mode cycling, numeric entry, the
  border-contour swap, one-command-per-gesture).
- Undo/redo tool-gesture fuzz (`packages/ui/src/tools/fuzz.test.ts`, fast-check): random
  gestures from every tool interleaved with undo/redo; undo-all always returns the initial
  document (extends F-002's property). Added `fast-check` to `@vitrum/ui` dev deps.
- One Playwright E2E (`apps/desktop/e2e/drawing.spec.ts`): draws a panel (border + lines +
  arc + bézier), asserts the segment count via the debug palette, and confirms one undo
  removes one whole gesture for each tool type.
- Gates green from the repo root: `pnpm lint`, `format:check`, `check`, `test` (316),
  `test:e2e` (10). Manually drove line/arc/bézier/rectangle/circle/polygon/border in
  `pnpm dev:ui` (draw → commit → undo).

**Supervisor sign-off (2026-07-18):** Mathieu accepted the feature and directed the merge
to `main`, taking the "draw a complete small panel without a single wrong-feeling
interaction" acceptance criterion (supervisor judgment) as signed off. All automated gates
verified green by the coordinator before merge (`lint`, `format:check`, `check`,
`test` 316, `test:e2e` 10).

**Canvas appearance (rode along on this branch, F-003 refinement):** the canvas surface was
retuned from `--surface-dark` (near-black) to `--surface-page` (warm paper) with the grid
palette softened to subtle warm greys and the placeholder content colour flipped to
`--ink-800` so drawn lines are visible on the light surface. Worth back-noting in F-003's
implementation notes.

**Net-new UI to back-port to the Claude Design project:** the vertical tool palette gained
three tools (circle, regular polygon, border) and an on-canvas HUD chip showing the active
mode / numeric-entry buffer. Built in code from `components/core` primitives and tokens per
the design-system rules; note for back-port.

**Follow-ups (out of scope):**

- Elliptical arcs are emitted as cubic Béziers (the kernel is circular-only, F-010's
  resolved decision); a native elliptical-arc primitive can arrive with SVG import (F-050).
- Arc/polygon mode selection is via re-pressing the tool's shortcut; a small on-canvas mode
  switcher would be more discoverable (revisit with F-013's editing UI).
- Bézier "break tangent" (Alt) zeroes the incoming handle for a cusp; full independent
  in/out handle dragging belongs with node editing (F-013).
- Border is rectangular only in v1; a freeform closed border contour is a later addition.
- **Coordination note:** the concurrent canvas-appearance change (warm-paper background)
  makes the document/preview content colour (`--paper-50`, tuned for the old dark surface)
  invisible on the light surface; `drawContent`/`drawToolPreview`'s `content` palette entry
  needs an ink tone. Left to the appearance change's owner to avoid clobbering their region.

_Cockpit v2 (2026-07-30):_ the tool palette moved from a floating `Toolbar` into the **Draw** dock section (`DrawPanel`), which shows each tool's real shortcut and a one-line hint. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.

_Parallel Shift constraint (2026-07-31):_ FR-3's Shift ladder is no longer only the absolute
0/45/90° one. `constrainAngle` takes optional reference directions, and `ToolInput.refDirs` carries
the directions of document lines through the point the active span is measured from — filled in by
`ToolController` via `lineDirectionsAt` — so a span drawn off an existing line can lock parallel or
perpendicular to it as well as to the world axes. Applies to the line and arc tools, including
numeric entry. Nearest ray wins, so the absolute ladder is unaffected where it is closer.
