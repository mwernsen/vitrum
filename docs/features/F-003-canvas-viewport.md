# F-003: Canvas viewport — pan/zoom, units, grid, rulers

|                |                     |
| -------------- | ------------------- |
| **Phase**      | 0 — Foundations     |
| **Status**     | draft               |
| **Depends on** | F-001, F-002, F-004 |
| **Complexity** | M                   |

## Summary

The infinite-canvas viewport every tool renders into: world↔screen coordinate
transforms, smooth pan/zoom, an adaptive grid, rulers, and real-world units. This is
pure CAD table stakes and must feel as tight as KiCad/Fusion from day one.

## Scope

- World coordinate system in mm, Y-up or Y-down (pick one, document it, never revisit).
  A single `Viewport` object owns the world↔screen transform; all tools use it.
- Pan: space-drag, middle-mouse drag, two-finger trackpad scroll. Zoom: pinch,
  Ctrl/Cmd-scroll, `+`/`-`, zoom-to-fit (`F`), zoom 1:1 physical (uses device DPI where
  available, with a calibration fallback).
- Adaptive grid: major/minor lines that re-space by zoom level (1/5/10/50/100 mm steps);
  toggleable. Rulers along top/left in current units with a cursor position marker.
- Status bar shows live cursor position in document units; unit switch mm ⇄ inch
  (display-only; storage stays mm) including fractional inches (1/16") formatting.
- HiDPI-correct rendering (devicePixelRatio), 60 fps pan/zoom with a few thousand
  segments (render only the visible region; requestAnimationFrame batching).
- A `CanvasLayer` stack: grid → reference images (later) → content → overlay (snap
  markers, selection, DRC markers later). Layers render independently so overlays
  don't force content redraws.

### Non-goals

- Drawing anything user-editable (F-011). Print preview transforms (F-041).

## Design

The canvas lives in the Editor screen of `ui_kits/studio` (F-004). Grid, rulers, and
crosshair colors come from the ink/paper token ramp; the canvas background is the
designated canvas surface token, not raw white. Status-bar readouts are numeric →
Geist Mono per the design system's data rule.

## Functional requirements

- FR-1: Round-trip precision: `worldToScreen(screenToWorld(p))` stable to <0.01 px at
  zoom levels from 0.01× to 1000×.
- FR-2: Zoom is anchored at the cursor position.
- FR-3: Grid, rulers, and status bar always agree with each other and the unit setting.
- FR-4: Rendering stays ≥30 fps during continuous pan with 5,000 test segments
  (add a dev-only stress-test scene generator).
- FR-5: Zoom-to-fit frames the document bounds with 5% margin.

## Technical guidance

- Keep the transform as a plain `{ scale, offsetX, offsetY }` — no full matrix needed
  until rotation is a requirement (it isn't).
- Fractional-inch formatting: round to nearest 1/32, reduce the fraction, e.g. `3 5/8"`.
- Exact 1:1 physical zoom needs a trustworthy px/mm factor; Electron's `screen` API
  reports display metrics but physical DPI is often wrong, so keep a "credit card
  calibration" dialog storing a per-display px/mm factor in app settings.

## Acceptance criteria

- Unit tests for transform math and unit formatting (mm, decimal inch, fractional inch).
- Manual: stress scene pans smoothly; cursor-anchored zoom feels native on trackpad;
  rulers match a printed 1:1 calibration square after calibration.

## Open questions

1. Y-axis direction: screen-style Y-down (simpler) vs CAD-style Y-up. Recommendation:
   Y-down; stained glass cartoons are thought of like drawings, not shop floors.
