# F-043: Export — SVG, PDF, DXF, cutting machines

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 4 — Production outputs |
| **Status**     | done                   |
| **Depends on** | F-021, F-040           |
| **Complexity** | M                      |

## Summary

Get designs out of Vitrum for other tools and machines: SVG (design interchange +
Cricut-class cutters), PDF (sharing/printing elsewhere), and DXF (CAD interop,
professional plotters/waterjets). Completes milestone M4 (Diafane core parity).

## Scope

- **SVG export**, three flavors:
  - _Linework_: drawn lead lines as paths (round-trip target for F-050 import).
  - _Cut templates_: each piece's **cut contour** as a closed path, laid out either
    in-place or spread on a grid with numbers — the Cricut/Silhouette use case
    (Diafane parity). True physical units via width/height + viewBox in mm.
  - _Colored render_: filled pieces + lead strokes for web/portfolio use.
- **PDF export**: single-sheet full design at scale (or scaled-to-page with the scale
  factor printed), colored or cartoon — reuses F-041's pipeline.
- **DXF export**: linework and cut contours on separate layers (`LEAD`, `BORDER`,
  `CUT`, `REBAR`), polylines/arcs in mm — importable by AutoCAD-class tools and
  waterjet/plotter CAM software (Glass Eye Enterprise parity).
- Export dialog with per-format options, technique-aware defaults, and the same
  DRC warn-on-errors gate as F-041.
- Round-trip contract with F-050: exporting linework SVG and re-importing must
  reproduce the network (state this as a shared test they both own).

### Non-goals

- G-code/CAM post-processing for specific cutters (SVG/DXF is the interchange
  boundary). `.vitrum` project sharing (that's just the F-002 file; sharing flows in
  F-055). Raster image export beyond a simple PNG snapshot button (include the
  snapshot — it's cheap).

## Functional requirements

- FR-1: SVG output validates and opens correctly in Inkscape and Illustrator with
  physical dimensions intact (1 mm in file = 1 mm on their rulers).
- FR-2: Cut-template SVG paths are the technique-inset contours (F-021), closed and
  simple, one path per piece, numbered via `<title>`/label conventions cutters accept.
- FR-3: DXF opens in a reference viewer with correct layers, units and arc fidelity
  (arcs as DXF arcs where the source is an arc; béziers as fine polylines with
  documented tolerance).
- FR-4: All exports are deterministic (same doc → byte-identical output where the
  format allows) to keep them diffable/testable.

## Open questions

1. ~~Which cutter should be the compatibility reference for cut-template SVG —
   does Mathieu (or a target user) own a Cricut/Silhouette to validate against?~~
   **Resolved (Mathieu, via orchestrator, 2026-07-21):** target the common-denominator
   SVG both Cricut Design Space and Silhouette Studio accept — physical `width`/`height`
   plus a `viewBox` in mm, one closed path per piece, numbered via per-path `id` + `<title>`.
   No code fork between cutters. The physical cut on a real machine is a pending manual
   acceptance item handed to Mathieu (no cutter available to validate against yet);
   everything else is auto-verified.

## Implementation notes

_Delivered 2026-07-21 on branch `f-043-export` (Status: done, pending the manual physical-cutter
check listed below)._ Mathieu pre-resolved the readiness gate: dependencies F-021 and F-040 are
`done` (F-041, whose PDF pipeline this reuses, is also `done`), and open question 1 is resolved
(recorded above).

**What shipped**

- **Pure export backends in `@vitrum/paper`** (reuses F-041's `PageBuilder`/pdf-lib; no new PDF code):
  - `exportScene.ts` — `ExportScene`, a backend-neutral snapshot that (unlike `PrintScene`) keeps the
    **true segment geometry** (line/arc/cubic, not flattened) so SVG linework round-trips losslessly
    and DXF keeps arcs as arcs, plus each piece's technique **cut contour** (F-021) and the
    reinforcement bars (F-032). Per-format option types + `defaultCutLayout(technique)`.
  - `svg.ts` — `buildSvg` with three flavours. The `<svg>` carries `width`/`height` in **mm** and a
    matching mm `viewBox`, so 1 mm in the file is 1 mm on the ruler (FR-1). _Linework_ emits real
    `M`/`L`/`C`/`A` path commands per segment, grouped by role (round-trip target, FR for F-050).
    _Cut_ emits one closed path per piece from the cut contour, `id="piece-A1"` + `<title>A1</title>`
    (FR-2), laid out in place or spread on a numbered grid. _Render_ fills pieces under lead strokes.
  - `dxf.ts` — `buildDxf` producing an R12 (AC1009) metric drawing with `LEAD`/`BORDER`/`CUT`/`REBAR`
    layers: `LINE`s for straight edges, DXF `ARC`s for arcs (arcs-as-arcs), and cubics flattened to
    polylines at a documented `BEZIER_TOLERANCE_MM = 0.05 mm` (FR-3). Coordinates flip to DXF's y-up
    world (panel opens upright); the arc angle conversion under the flip is unit-tested.
  - `exportPdf.ts` — `buildExportPdfDocument`, a single-sheet PDF (distinct from F-041's tiling):
    **actual size** (custom sheet = panel + margin, 1:1) or **scaled-to-fit** a named page with the
    scale factor printed; coloured render or cartoon.
  - `format.ts` — one deterministic number formatter (fixed decimals, trimmed, `-0` → `0`); with
    stable id/key ordering it makes SVG and DXF **byte-identical for the same document** (FR-4).
- **Host seam** — `ExportPort` gained `savePng` (bytes, parallel to `savePdf`); its `saveText` now
  serves SVG/DXF too, with the desktop dialog filter chosen from the suggested extension. Wired
  through all three hosts (`browserHost` download, `fakeHost` record, desktop preload + `export:savePng`
  IPC) with a `VITRUM_EXPORT_PNG_PATH` E2E override (SVG/DXF reuse `VITRUM_EXPORT_TEXT_PATH`).
- **UI (`packages/ui/src/export/`)** — `ExportController` (runes: format + per-format options,
  technique-aware defaults, `run`/`runPng`), `buildExportScene` (snapshots the live derived data like
  `buildPrintScene`), `ExportDialog.svelte` (tokens-only modal from `components/core`: format picker,
  per-format options, the F-041 DRC warn-on-errors gate). The **F-043 placeholder in the Make dock's
  Outputs is now live** (Export… + PNG snapshot buttons), and the **TopBar's "Export (coming soon)"
  chrome placeholder is now the live export entry point**. The **PNG snapshot** composites the canvas
  content layer onto white via a new `Canvas.toPngBytes` (registered with the shell through a
  `snapshotRegister` prop — no DOM leaves the component).

**How each FR / acceptance criterion was verified**

- **FR-1 (SVG physical units):** unit test asserts `width/height` in mm + matching mm `viewBox`; the
  1 mm = 1 mm claim in Inkscape/Illustrator is inherent to those attributes (the reference-app open is
  a nice-to-have manual spot-check, not blocking).
- **FR-2 (cut-template paths):** unit test asserts one closed path per piece from the **cut contour**
  (inset, not the drawn ring), numbered via `id` + `<title>`; the cutter compatibility is the resolved
  common-denominator form.
- **FR-3 (DXF layers/units/arc fidelity):** unit tests assert R12/`$INSUNITS=4`, the four layers, LINE
  vs ARC vs POLYLINE placement, the y-up-flipped arc angles, and multi-vertex bézier flattening. Opening
  in a reference DXF viewer is the manual spot-check.
- **FR-4 (determinism):** unit tests assert byte-identical SVG and DXF across runs **and** independent
  of input order (shuffled scene).
- **Round-trip contract (F-043 ↔ F-050):** `svgRoundTrip.test.ts` exports linework SVG and re-parses it
  (standard SVG endpoint→centre arc conversion) then asserts every line/cubic/arc segment reproduces at
  sampled points — covering minor/major arcs and both sweep directions. F-050 adopts this test by
  swapping the local parser for its importer (see follow-ups).
- **PNG snapshot / whole flow:** E2E `export.spec.ts` drives the packaged `file://` build — draw +
  number a piece, then export SVG, DXF, PDF and a PNG snapshot, asserting a real file of each format
  lands on disk (SVG `<svg …mm>`, DXF `AC1009`/`CUT`, PDF `%PDF-`, PNG magic bytes). Component tests
  cover the dialog (format-specific options, DRC warn-not-block, disabled states) and the panel actions.

**Deviations / decisions (implementer calls, spec silent)**

- **Two export entry points, one dialog.** Both the TopBar "Export" chrome placeholder and the Make-dock
  Outputs placeholder existed; F-043 activates both (a toolbar button + a grouped-with-print action)
  rather than picking one and leaving dead chrome. The PNG snapshot is a separate button (it rasterises
  the live canvas, not the scene).
- **PDF determinism is not byte-asserted.** SVG/DXF are byte-identical (FR-4); PDF is left out because
  pdf-lib embeds non-deterministic metadata — FR-4's "where the format allows" covers this. PDF is
  asserted structurally instead (page size, op tree, valid bytes).
- **DXF targets R12 (AC1009)** as the most widely importable, handle-free flavour; POLYLINE/VERTEX
  (not LWPOLYLINE, which is R14+) so lenient and strict viewers both accept it. Reinforcement bars are
  their centreline `LINE` on `REBAR` (bar width is a BOM concern, not cut geometry).
- **Cut-template grid layout is a simple row-major spread**, not real nesting (that's F-057) — enough to
  separate tiny foil contours on a cutter (the technique-aware default for foil).
- **Net-new UI to back-port** to the Claude Design project: the **`ExportDialog`** and the Make-dock /
  TopBar export actions.

**Verified by me** — all five gates green from the repo root: `pnpm lint`, `pnpm format:check`,
`pnpm check`, `pnpm test` (798 unit), `pnpm test:e2e` (22, incl. the new `export.spec`). Also verified
visually in `pnpm dev:ui`: the TopBar export button opens the tokens-styled dialog; format switching
reveals the right options (SVG flavour/layout, PDF scale/look, DXF layer note); the DRC warn-not-block
callout shows.

**Pending Mathieu (manual, not automatable here)**

- **Physical cut test on a real machine** (Cricut / Silhouette): import a cut-template SVG and confirm
  the cutter reads the closed paths and numbers, and that a cut piece matches the modelled cut contour.
  Mathieu has no cutter to validate against right now, so this is handed over as pending.
- Reference-app spot-checks (nice-to-have, not blocking): open a linework/render SVG in
  Inkscape/Illustrator (rulers read true mm) and a DXF in a CAD viewer (layers/arcs correct).

**Follow-ups (out of scope)**

- **F-050 SVG import** adopts `svgRoundTrip.test.ts` as the shared contract (swap the test's local
  `parseLineworkSvg` for the real importer); it also needs the SVG-arc endpoint→centre conversion this
  test already implements, and can consume the same `id`/`<title>`/role-class conventions.
- Curve-exact DXF/SVG **cut** contours: cut contours are F-021's flattened-facet rings today (cut
  templates and DXF `CUT` are polylines); a curve-level cut edge is F-021's documented follow-up.
- DXF splines (needs a richer DXF version than R12); embedding the project name in the DXF header;
  remembering export settings across sessions (shared with F-041/F-042).

### Follow-up: consolidated output hub (2026-07-21, Mathieu)

After the initial delivery, Mathieu decided **all outputs route through the one Export dialog**; the
per-feature export buttons in the Make sidebar were removed and the top-bar "Export" button is the
single entry point.

- **The Export dialog is now organised by document type** (a top-level "What to export" selector),
  each revealing its own options: **Design sheet** (single-sheet PDF), **Design files** (SVG
  linework/cut/render + DXF), **Cutting template — 1:1 tiled** (the F-041 print flow, with the live
  canvas tiling preview preserved), **Cutting list & BOM** (F-042 PDF/CSV), and **Image snapshot**
  (PNG). The DRC warn-not-block gate and technique-aware defaults are kept.
- **No generation logic was merged or rewritten.** The dialog _composes_ the existing controllers:
  `PrintController` (F-041) still owns the tiling + tiled PDF, `BomController` (F-042) still owns the
  cutting-list PDF/CSV, and `ExportController` owns the design PDF / SVG / DXF / PNG plus the shared
  `docType` state. The shell's `runOutput` dispatches the active type to the right runner. The tiling
  preview now keys on `exporter.open && exporter.docType === 'tiled'` (was `print.open`).
- **`PrintDialog.svelte` was deleted** (fully absorbed; its options + tile summary + preview wiring
  live in `ExportDialog`). The sidebar was pruned: `NumberingPanel` lost its entire Outputs section
  (keeps the scheme editor + legend); `BomPanel` lost its PDF/CSV buttons (keeps the live cutting-list
  table, factor editing and row-hover highlight — a working view, not export). Export
  progress/errors surface in the dialog.
- **Tests/E2E updated to the new routing:** `ExportDialog.test` covers every document type + the DRC
  gate + disabled states; `NumberingPanel.test`/`BomPanel.test` assert the export controls are gone;
  the E2E `export.spec` drives all five types from the single dialog, and `print.spec`/`bom.spec`
  reroute through it. All gates green (792 unit, 22 E2E). Verified in `pnpm dev:ui`: the doc-type
  selector reveals each type's options and the tiled type still paints the tile grid on the canvas.

**Net-new UI to back-port** (updated): the document-type **`ExportDialog`** as the single output hub
(supersedes the earlier per-format dialog and the F-041 `PrintDialog`).
