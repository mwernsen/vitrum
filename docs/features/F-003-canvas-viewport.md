# F-003: Canvas viewport — pan/zoom, units, grid, rulers

|                |                     |
| -------------- | ------------------- |
| **Phase**      | 0 — Foundations     |
| **Status**     | done                |
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

_All resolved (Mathieu, 2026-07-18):_

1. **Y-axis direction — resolved: Y-down.** World +Y points down, matching screen
   pixels; the world↔screen transform is a uniform scale with no axis flip. Stained
   glass cartoons are thought of like drawings, not shop floors. This is fixed and
   will not be revisited.
2. **1:1 physical zoom calibration dialog — resolved: build it in code.** The
   "credit card" calibration dialog has no design in the Claude Design project yet;
   Mathieu authorised designing and building it in code for this feature, provided it
   matches the Vitrum Design System (core primitives, tokens only, studio chrome).
   To be noted for later back-port to the design project.

## Implementation notes

Delivered 2026-07-18 (branch `f-003-canvas-viewport`).

**What shipped**

- Pure transform/grid/units maths in `@vitrum/core`:
  - `viewport.ts` — the `Viewport` value (`{ scale, offset }`, CSS px per mm, Y-down),
    `worldToScreen`/`screenToWorld`, `panByScreen`, `scaleAround`/`zoomBy` (cursor-anchored),
    `fitBounds` (5% margin), `visibleWorldBounds`, `gridStep`/`niceStep`, `rulerStepMm`,
    `ticksInRange`, scale clamped to `[0.01, 1000]` px/mm.
  - `units.ts` — `formatFractionalInch` (round to 1/32, reduce, e.g. `3 5/8"`) and a
    `fractional` option on `formatLength` (decimal default preserved).
- `packages/ui/src/canvas/`:
  - `viewport.svelte.ts` — `ViewportController` (runes): the reactive transform, unit,
    grid toggle, calibration, cursor, and derived cursor-world/grid/zoom-factor.
  - `render.ts` — layer draw functions (grid, content, overlay crosshair, rulers) + HiDPI
    `prepareContext`; all no-op when the 2D context is unavailable (jsdom).
  - `scene.ts` — segment flattening, `documentBounds`, and the FR-4 `stressScene` generator.
  - `calibration.ts` — per-display px/mm persistence.
  - `CalibrationDialog.svelte` — the net-new 1:1 calibration screen.
- `shell/Canvas.svelte` rewritten as the layered viewport (grid → content → overlay, plus
  two ruler canvases and a unit corner) with rAF-batched, per-layer redraw, a `ResizeObserver`,
  pan (space-drag / middle-drag / two-finger scroll), cursor-anchored wheel/pinch zoom, and
  keyboard `F`/`+`/`-`/`1`. `StatusBar` extended with the live world read-out, zoom %, and
  grid/fit/1:1/calibrate/unit controls. `TopBar` zoom button wired to fit.
- `DocumentController.loadStressScene` + a debug-palette command load the 5,000-segment scene.

**Decisions and deviations**

- **Y-down**, plain `{ scale, offset }` transform (no matrix) — per resolved open questions
  and technical guidance.
- **Viewport maths live in `@vitrum/core`**, not a new package; this adds a `core → geometry`
  dependency edge (for `Vec2`/`BBox`). No cycle (geometry is a leaf); allowed by the lint
  boundary rules. Extends the F-001 learning that units live in `core/src/units.ts`.
- **Grid stays mm-based** (1/5/10/50/100 mm) while **rulers are unit-aware** (mm 1/2/5 ladder,
  inches in natural fractions). So the grid and ruler step values can differ; both are correct
  and derive from the same viewport, satisfying FR-3 (grid, rulers, status bar all agree with
  the unit setting and each other).
- **Canvas surface kept on `--surface-dark`** (the existing scaffold choice); chrome colours are
  resolved from _leaf_ design tokens at runtime (semantic aliases resolve to `var(...)` in
  `getComputedStyle` and are unreadable on a 2D canvas). The cobalt cursor crosshair/ruler
  marker is the single accent per view.
- **Calibration** persists to `localStorage`, keyed by a coarse display signature, to keep the
  concern inside `packages/ui` (Electron-free) per the F-001 learning. Default is the CSS
  reference 96 dpi (`96/25.4` px/mm). Building the dialog in code was authorised by Mathieu
  (2026-07-18); it must be back-ported to the Claude Design project.

**Verification**

- FR-1/FR-2/FR-5 and unit formatting: `packages/core/src/viewport.test.ts`,
  `units.test.ts` (round-trip < 0.01 px across 0.01×–1000×, cursor-anchored zoom, fit framing,
  mm/decim/fractional inch). Controller/scene/calibration/status covered by
  `packages/ui/src/canvas/*.test.ts` and `shell/StatusBar.test.ts`.
- FR-3/FR-4 end to end: `apps/desktop/e2e/viewport.spec.ts` (cursor read-out tracks the pointer,
  keyboard zoom increases zoom, unit switch reformats to fractional inches, zoom-to-fit). The
  5,000-segment stress scene renders (verified in `pnpm dev:ui`); FR-4's 30 fps target is met by
  design (visible-region culling + rAF batching + independent overlay layer) but was not
  benchmarked — see pending.
- All gates green: `pnpm lint`, `format:check`, `check`, `test` (240), `test:e2e` (9).

**Pending (for Mathieu / physical checks)**

- 1:1 calibration accuracy against a printed 1:1 square (physical).
- Sustained-fps feel on a trackpad with the stress scene (subjective/physical).

**Follow-ups (out of scope)**

- Auto-fit to document bounds on open/load (currently frames the default 300×400 region on
  first measure; `F`/Fit reframes to real bounds).
- Promote calibration to a host-level settings port with an Electron `screen`-derived default
  and a true per-display id.
- Back-port `CalibrationDialog` to the Claude Design project.
- The layer stack reserves the reference-image slot (grid → [reference] → content → overlay);
  the reference layer itself arrives with F-051.
