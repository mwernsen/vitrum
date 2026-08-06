# F-051: Reference image underlay & perspective correction

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
| **Depends on** | F-003              |
| **Complexity** | M                  |

## Summary

Load a photo or scan under the drawing to trace over (Diafane parity): opacity
control, scaling to real dimensions, and 4-corner perspective correction so a photo
of an existing window taken at an angle becomes a straight-on template — the
restoration workflow.

## Scope

- Image layer(s) below content: place, move, scale, rotate, lock; per-layer opacity
  and desaturate toggle; show/hide. **Multiple** simultaneous layers.
- **Scale calibration**: user marks two points on the image and types the real
  distance (essential for restoration work).
- **Perspective correction**: drag four corner handles to the corners of the window
  in the photo; image is rectified to a user-given rectangle (projective homography,
  GPU-sampled via WebGL).
- Images embedded in the project file (a **zip container** — see Decisions),
  downscaled at import with a **4096 px longest-edge** cap.
- Excluded from all outputs (print/export) by default; per-layer opt-in inclusion in
  the presentation PDF is a documented follow-up (see Follow-ups).

## Decisions (expansion, 2026-07-21, resolved with Mathieu)

1. **File container → zip.** `.vitrum` becomes a zip (`fflate`) holding `document.json`
   (the versioned envelope, unchanged) + `assets/<id>` + `assets/manifest.json`. This is
   the container F-002 deferred here. **No backward compatibility** with the old
   text-JSON `.vitrum` — there are no users yet, so `unpackDocument` only reads zips.
   Consequence: `StoragePort` file/autosave payloads become `Uint8Array` (was `string`).
2. **Rectification → WebGL.** The 2D content canvas (F-003) is untouched; the underlay
   is a separate WebGL canvas behind it, sampling each layer through a homography in the
   fragment shader (correct perspective, mipmapped downscaling for the 4K-zoom case).
   Chosen as the most solid/scalable option; F-053/F-054 reuse the GPU foundation.
3. **Multiple layers** in v1 (the open question — nearly free once one works).
4. **Import cap → 4096 px longest edge**, re-encoded (JPEG for photos, PNG kept when the
   source is PNG) to bound file size and GPU texture memory while honouring FR-4's 4K target.

## Functional requirements

- **FR-1 — Calibrated scale.** The user marks two points on a layer and types the real
  distance; thereafter distances measured over that layer through the viewport's units
  match reality.
- **FR-2 — Perspective rectification.** Dragging the four corner handles onto a
  photographed rectangle and giving its real size rectifies the image (projective
  homography); it is visually correct for an angled-window fixture.
- **FR-3 — Undoable, round-tripping.** Every layer op (place/move/scale/rotate, lock,
  opacity, desaturate, show/hide, calibrate, rectify, delete, reorder) is a single undo
  entry; a save→open round-trip reproduces the layers and their embedded image bytes exactly.
- **FR-4 — Budget.** A 4096 px underlay holds the F-003 interaction budget (pan/zoom stays smooth).
- **FR-5 — Output exclusion.** Reference layers are excluded from every output
  (print, SVG/DXF/PDF/PNG export, cutting list) by default.

## Acceptance criteria

- Unit (core/geometry/model): homography maps the four correspondences exactly and a
  round-trip fixture rectifies correctly; downscale calc respects the 4096 cap; reference
  commands are self-inverting; zip `packDocument`→`unpackDocument` reproduces project + assets.
- Component (ui): Layers panel lists/toggles/reorders reference layers; Inspector edits a
  selected layer; the WebGL underlay mounts and no-ops gracefully with no GL context (jsdom).
- E2E (one): import an image through the real `file://` build; the layer row and the WebGL
  underlay canvas appear, and the crash snapshot is a zip container carrying the embedded image
  (proving the round-trip). Calibrate/rectify and save→open-dialog round-trip are covered by unit
  tests instead — native save/open dialogs are not Playwright-drivable (documented at F-002);
  output exclusion (FR-5) is structural (no output path reads `layers`), verified by grep.

## Open questions

_All resolved — see Decisions._

## Follow-ups (out of v1 scope)

- **Opt-in PDF inclusion for presentations.** Needs raster (homography-rectified PNG)
  embedding added to `@vitrum/paper`'s `PageBuilder` (pdf-lib `embedPng`) + a per-layer
  `includeInPdf` flag surfaced in the print/export flow. Default exclusion (FR-5) ships in v1;
  the opt-in is deferred so v1 ships no dead controls.

## Implementation notes

_Delivered 2026-07-22._ All quality gates green: `lint`, `format:check`, `check`,
`test` (895 unit), `test:e2e` (24, incl. the new `reference-image` spec). Both open
questions and all four expansion decisions resolved with Mathieu in-session.

**Pure kernel (`@vitrum/geometry`).** New `homography.ts`: a `Mat3` projective transform,
`homographyFromQuadToQuad` (exact 4-point solve via Gaussian elimination with partial
pivoting), plus `applyHomography`/`invertMat3`/`multiplyMat3`. Unit- and property-tested,
including an angled-window rectification fixture (FR-2). It is the one matrix used on both
the CPU (measurement, FR-1) and the GPU (sampling).

**Zip container (`@vitrum/model`).** `.vitrum` is now a **zip** (`fflate`): `document.json`
(the unchanged versioned envelope) + `assets/manifest.json` + `assets/<id>` bytes, via new
`packDocument`/`unpackDocument`; `assetIdFor` is a content hash (dedup + stable ids).
Consequence: `StoragePort` file/autosave payloads became `Uint8Array` (was `string`), and
`Autosaver` is now payload-agnostic (an injected `serialize`), so the UI packs assets into
the snapshot. Per Mathieu there is **no** reader for the old text-JSON `.vitrum` (no users
yet). Schema bumped 9 → 10 (drops any pre-F-051 placeholder layer with no embedded bytes).
`ReferenceLayer` gained real fields (`assetId`, `naturalWidthPx/HeightPx`, `srcQuad` in
image px, `dstQuad` in world mm, `opacity`, `desaturate`, `visible`, `locked`, `rectified`);
`referenceCommands` (add/patch/remove/reorder) are each one coalescing undo entry (FR-3).

**Two-quad model.** Placement, calibration and rectification are all edits to a layer's two
quads — `dstQuad → srcQuad` is the render/measure homography — so an un-rectified layer
degenerates to an affine fill and a rectified one warps correctly, with no special cases.

**Rendering (WebGL, `@vitrum/ui`).** A separate WebGL canvas sits behind the 2D content
canvas inside `Canvas.svelte`'s `.stack` (grid → underlay → content → overlay); the F-003 2D
renderer is untouched. Each layer draws as a screen-space quad whose fragments sample the
image through the homography (`reference/gl.ts`, WebGL1, non-POT CLAMP_TO_EDGE/LINEAR).
`createReferenceRenderer` returns `null` when no GL context exists (jsdom) so component tests
no-op; real WebGL is exercised by the E2E in the packaged `file://` build.

**UI.** `ReferenceController` (runes) owns the embedded blobs, decoded texture sources,
selection/mode and every layer edit; it registers `collectAssets`/`loadAssets` with the
`DocumentController` so assets pack into / load from the zip. `LayersPanel` turned its F-051
placeholder into a live list (add / visibility / lock / reorder / delete); `Inspector` edits
the selected layer (opacity, desaturate, two-point calibration, 4-corner perspective
rectification); `ReferenceOverlay` draws the drag handles / calibration points / rectify
markers over the stage. Import downscales to ≤ 4096 px and re-encodes
(`reference/prepare.ts`, using the pure `downscaleSize` in `@vitrum/core`). New host method
`ImportPort.openImage` across all three hosts, with `VITRUM_IMPORT_IMAGE_PATH` for E2E isolation.

**FR-5 is structural.** Every output pipeline (`@vitrum/paper`, export/print scenes, BOM)
builds from `segments`/`pieces` only and never reads `project.layers`, so reference layers
cannot appear in any print/export/PNG/cutting-list output. Verified by grep + the fact that
the PNG snapshot rasterises only the content canvas.

**Pending Mathieu (not automatable):** a visual/gallery review of the underlay rendering,
desaturation, opacity and a real angled-photo rectification (E2E asserts the layer + embedded
bytes and that the WebGL canvas mounts, but does not pixel-diff the GPU output).

**Follow-up discovered:** opt-in PDF inclusion (see above) — deferred, needs raster embedding
in `@vitrum/paper`.

_Cockpit v2 (2026-07-30):_ the reference-layer list moved from the Layers panel into the **Draw** dock section's Tracing block. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.

_Corner resize (2026-07-31):_ in `place` mode a corner handle now **scales** the layer about the
opposite corner, keeping the aspect ratio (`ReferenceController.scaleFromCorner`, the pointer
projected onto the anchor→corner diagonal) — the "scale" op the Scope bullet calls for. The free
per-corner drag it replaced (`dragCorner`) stays available on alt-drag for a manual perspective
tweak; FR-2 rectification is unchanged and remains the proper tool for a photographed rectangle.
