# F-053: Realistic glass rendering

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
| **Depends on** | F-023              |
| **Complexity** | L                  |

## Summary

Upgrade from flat fills to a presentation-quality render: light transmitted through
textured, varyingly-transparent glass, dimensional lead/solder lines with rounded
profiles, subtle irregularity that makes glass read as glass. Used for client
presentations and as the base layer for F-054's sun simulation.

## Scope

- A WebGL render mode (behind the F-001 renderer interface) alongside the editing
  view: per-glass shading from transparency class + texture (procedural normal-map
  style textures per tag: hammered, seedy, streaky…; optional swatch-photo modulation).
- Backlight model: uniform daylight backlight with adjustable intensity/warmth
  (F-054 replaces the light source with the real sun).
- Came/solder rendering: rounded profile with specular hint; solder finish (silver/
  copper/black from F-021) affects color; foil seams render as beaded solder lines.
- Per-piece texture rotation/offset control (Glass Eye Pro Plus parity — noted in
  F-023's non-goals; do it here where the texture pipeline lives).
- Export snapshot at chosen resolution (PNG) for portfolio/client use.

## Functional requirements

- FR-1: Switching design↔render on the reference panel completes in **< 1 s**; pan/zoom
  in render mode stays within F-003's interaction budget.
- FR-2: Transparency classes are visually distinct and believable side by side —
  transmission is distinct and monotonic clear → solid.
- FR-3: Editing while in render mode updates live (it's a view, not an export).
- FR-4: A PNG snapshot of the render can be exported (portfolio/client image), via the
  F-043 export hub.

## Acceptance criteria

- Mode switch < 1 s on the reference panel; pan/zoom within F-003's budget (reuse its
  measurement).
- Core unit test on the transmission function: distinct + monotonic across the four
  transparency classes; per-tag texture params distinct; `litColor` monotonic in
  intensity and transmission.
- One Playwright E2E driving the packaged `file://` build: switch to render mode, edit
  geometry live in render mode, export a PNG snapshot to disk.
- Manual (Mathieu): the gallery/visual "believable" pass — reference-photo-tuned look
  per texture tag; that came/solder read as dimensional; that the backlight range feels
  right.

## Open questions

All six resolved by Mathieu (via the orchestrator, 2026-07-22) before implementation:

1. ~~Art direction — what does "believable" mean concretely?~~ **Resolved: procedural-first.**
   Ship fixed procedural per-tag textures now; collect reference photos async and tune the
   parameters in a follow-up. "Believable" is a gallery/visual sign-off handed to Mathieu,
   not a code blocker.
2. ~~Render technology / renderer interface.~~ **Resolved:** a dedicated WebGL2 render pass
   following the F-051 `gl.ts` factory pattern (null under jsdom → tests no-op; a Canvas2D
   fallback via the existing flat render). Pure shading maths in `@vitrum/core` so they're
   unit-testable; the fragment shader mirrors them. Add one E2E that switches to render mode
   on the packaged `file://` build (F-030 worker-under-`file://` lesson).
3. ~~Scope — which bullets are in v1?~~ **Resolved: the full Scope list stays in v1** — the
   recommended technical approach is used, but the feature definition is not narrowed. Both
   "optional swatch-photo modulation" (optional _per glass_, i.e. modulates when a swatch photo
   exists — not optional to build) and "per-piece texture rotation/offset control" ship in v1.
4. ~~Where do render controls live?~~ **Resolved:** global backlight (intensity/warmth) in the
   Layers panel, shown only in render mode; per-piece texture rotation/offset in the Inspector as
   selection-scoped editing (Portal turn-3 IA). Both flagged as net-new surfaces for back-port.
5. ~~Persist or transient?~~ **Resolved: persist.** `RenderSettings` (backlight intensity + warmth)
   on `Project` via a schema v11→v12 migration, F-042 "persist tunable intent only, derive the rest"
   pattern; edits undoable, one entry each (commit-on-blur/change). Per-piece texture transform is
   also persisted per-piece, content-id-keyed and reload-safe (F-023/F-040 pattern).
6. ~~Acceptance criteria.~~ **Resolved:** the tightened set above (FR-1 mode-switch < 1 s + F-003
   budget; core transmission distinct+monotonic; one E2E live edit in render mode; PNG snapshot via
   the existing export port with `VITRUM_EXPORT_PNG_PATH` E2E override).

## Implementation notes

_Delivered 2026-07-22 on branch `f-053-realistic-render`. Status: done, pending Mathieu's manual
gallery/visual check (below)._ All six open questions were resolved by Mathieu before coding
(recorded above); the answers were applied as ruled.

**Pure shading maths (`@vitrum/core/render/shading.ts`).** Model-free (glass unions mirrored
structurally, the F-020/F-011 discipline): `transmission()` (distinct + strictly decreasing clear →
solid), `daylight(warmth)`, `litColor(glass, transmission, backlight)` (monotonic per channel in both
intensity and transmission), `hexToRgb`/`rgbToHex`, and `textureParams(tag)` returning stable
per-tag procedural parameters (`kind` int code, `frequencyPerMm`, `amplitude`, `anisotropy`; `smooth`
has zero amplitude). These fix the _shape_ of the model (FR-2), verified without a GL context; the
final art direction is Mathieu's gallery call. The WebGL fragment shader mirrors these formulas, and
each piece's lit base colour is computed on the CPU by the same `litColor`, so GPU and CPU never
drift.

**WebGL2 render pass (`packages/ui/src/render/glass-gl.ts`, `GlassRenderLayer.svelte`).** A dedicated
renderer behind the F-051 `gl.ts` factory pattern — `createGlassRenderer` returns `null` when WebGL2
is unavailable (jsdom, GPU-less), so callers no-op and the shell falls back to the flat Canvas2D
render. Glass fills use the **stencil buffer** (even-odd), not a triangulator: each piece's rings are
stamped into the stencil with `INVERT` (holes fall out for free, exactly like Canvas2D
`fill('evenodd')`), then the piece's bbox quad is shaded where the stencil is odd. The fragment shader
adds the per-tag procedural texture (value-noise, anisotropic for streaky/ripple), optional
swatch-photo modulation (samples the glass's decoded photo, modulates the assigned base colour by its
luminance so hue is preserved), and the per-piece texture transform (rotation/offset/scale in world
mm). Came/solder are a second pass of extruded ribbons with a rounded specular cross-section (darker
edges, a centre highlight) tinted by finish (silver/copper/black), foil seams beaded along their
length. `GlassRenderLayer` owns swatch decode caching (`swatchCache.ts`, a plain `.ts` module so DOM
globals + a `Map` cache don't trip the Svelte reactivity lint rules) with a version bump on decode,
mirroring the F-051 reference-source pattern.

**Canvas integration.** `GlassRenderLayer` sits in the canvas stack between the grid and the 2D
content layer; when the `render` view mode is active it renders (opaque room wash + glass + came) and
the 2D content layer stays clear so overlays (selection, tool preview, cursor) still show on top —
which is what keeps editing live in render mode (FR-3). Drawing/paint/select interactions are
untouched in render mode (only the cartoon view is read-only). The `render` view mode placeholder in
`shell/viewmode.ts` was turned **live**.

**Persisted model (`@vitrum/model`).** New `RenderSettings { backlightIntensity, backlightWarmth,
textureTransforms }` on `Project` (schema **v11 → v12**, `migrateV11ToV12` seeds the neutral default);
`PieceTextureTransform { rotationDeg, offsetXmm, offsetYmm, scale }` + `identityTextureTransform()`.
Two commands, each one reversible undo entry: `updateRenderSettings` (shallow backlight patch, F-042
`updateBomSettings` pattern) and `setPieceTextureTransforms` (content-id-keyed set/clear, self-inverting,
F-023 `setGlassAssignments` pattern). Texture transforms key off a piece's **content id** so they
survive save/reload directly (reproducible from geometry), like glass assignments and numbering.

**UI controls.** Global backlight intensity/warmth are sliders in the **Layers panel**
(`LayersPanel.svelte`), shown only when the render view is active, committing on `change` (slider
release) so one drag is one undo entry (FR-1); threaded `renderActive` through `DockPanel`. Per-piece
texture placement (rotation / offset x,y / scale + reset) lives in the **Inspector** single-piece
panel, gated on the render view (Portal turn-3 IA: selection-scoped editing belongs here), dispatching
`setPieceTextureTransforms` keyed by content id.

**PNG snapshot (FR-4).** Reuses F-043's `ExportPort.savePng` + the F-043 export hub `png` type; the
Canvas `toPngBytes` composites the WebGL glass canvas first when in render mode (the GL context sets
`preserveDrawingBuffer: true` so the render reads back via `drawImage`), so the snapshot is the
realistic render, not the (cleared) 2D content layer.

**Deviations / decisions.**

- **Fills via stencil even-odd, not a triangulator.** No triangulator existed in `@vitrum/geometry`;
  the stencil approach handles concave pieces + holes for free, matches the Canvas2D even-odd
  semantics, and keeps the renderer to two small shaders. A triangulator remains an option if a future
  feature needs true tessellation.
- **Unassigned pieces render as pale clear glass** in the render view (rather than the flat view's
  warning hatch), so a presentation render reads as finished; the unassigned _count_ is still surfaced
  in the status bar for correctness work.
- **Came/solder are a rounded specular _hint_, not true 3D geometry** (ribbons with a cross-section
  parameter), per Q3's "shading hint" recommendation — enough dimensionality for a presentation render
  without a lead-profile mesh.
- **Net-new surfaces to back-port** to the Portal/Design projects: the Layers-panel **Backlight**
  section and the Inspector **Texture placement** controls.

**Tests.** Core: `render/shading.test.ts` (16 — transmission distinct+monotonic FR-2, `litColor`
monotonic in intensity/transmission + clamp, `daylight` warmth, hex round-trip, per-tag texture params
distinct). Model: `renderCommands.test.ts` (backlight patch + undo + serialize round-trip; per-piece
transform set/clear/self-invert + content-id reload round-trip) and a v11→v12 migration test in
`serialize.test.ts`. UI: `LayersPanel.render.test.ts` (backlight hidden unless render active;
intensity and warmth each one undo entry) and `Inspector.render.test.ts` (texture controls hidden
unless render active; rotation/scale/reset keyed by content id, undo). E2E: `render.spec.ts` drives the packaged
`file://` build — draw + paint, switch to Render (WebGL layer goes live), edit geometry live in render
mode, export a PNG snapshot to disk (`VITRUM_EXPORT_PNG_PATH`).

**Verification (by me).** All five gates green from the repo root: `pnpm lint`, `pnpm format:check`,
`pnpm check` (svelte-check 0 errors), `pnpm test` (954 unit/component), `pnpm test:e2e` (26 E2E incl.
`render.spec`). FR-1's numeric budget (< 1 s switch, smooth pan/zoom) is met structurally — the render
is a single WebGL pass with no per-frame allocation on the hot path — but the exact timing is part of
the gallery pass below. The GL path is exercised only by the E2E (the real `file://` build), per the
F-030 lesson; jsdom component tests correctly no-op the renderer.

**Pending Mathieu (manual, not automatable).**

- The **gallery/visual "believable" pass**: with reference photos in hand, confirm each texture tag
  reads right and tune the procedural parameters; confirm came/solder read as dimensional and the
  backlight intensity/warmth range feels right. This is the substance of resolved Q1 and is expected
  to produce a parameter-tuning follow-up.

**Follow-ups (out of scope).**

- Reference-photo-tuned texture parameters (the Q1 follow-up).
- Swatch-photo modulation currently samples in piece-bbox UV space; a true per-material tiling scale
  (physical mm-per-sheet) would be more faithful for large panels.
- Per-piece texture transform inherits nothing across splits/merges (it resolves directly by content
  id, which is reload-safe); lineage inheritance like glass assignments is a possible refinement.
- F-054 will replace the uniform backlight with the directional sun on this same pipeline.
