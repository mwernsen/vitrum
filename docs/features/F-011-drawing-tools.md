# F-011: Drawing tools — line, arc, bézier, shapes

|                |                     |
| -------------- | ------------------- |
| **Phase**      | 1 — Sketcher        |
| **Status**     | draft               |
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

1. Polyline chaining UX: should consecutive spans auto-share endpoints as a welded
   node (recommended — piece detection needs coincident endpoints) — confirm.
2. Single-key shortcuts vs KiCad-style two-tier (tool then modifier keys)? Recommend
   single-key for v1.
