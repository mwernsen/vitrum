# F-041: 1:1 printing with tiling

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 4 — Production outputs |
| **Status**     | done                   |
| **Depends on** | F-040                  |
| **Complexity** | L                      |

## Summary

Print the cartoon at exact physical scale on a home printer: large panels tile across
multiple sheets with alignment marks, so the printed pages tape together into a
full-size working cartoon. The single most-used output in the hobbyist workflow
(Diafane: A4–A0 and custom up to 5,000 mm).

## Scope

- Print dialog: paper size (A4/A3/Letter and custom), orientation, margins, overlap
  width, content choice (cartoon / cut contours / colored render), and what to
  include (numbers, glass codes, reinforcement bars, alignment marks, page labels).
- **Tiling**: compute the page grid over the panel bounds; each tile printed with
  crop/alignment marks in the overlap zone (glue-marks pattern that makes
  misalignment obvious) and a page coordinate label (`B3`), plus an overview map page
  showing tile layout.
- **Scale fidelity**: output generated as vector PDF at true dimensions (via direct
  PDF generation or Electron's print pipeline — see guidance); every print
  includes a 100 mm calibration ruler so the user can verify their printer isn't
  scaling ("fit to page" is the classic failure — the dialog must warn about it).
- Print preview with page boundaries overlaid on the canvas.
- DRC gate: printing with outstanding DRC _errors_ shows a warning summary first
  (proceed allowed — policy: warn, never block).

### Non-goals

- Cutting lists/BOM documents (F-042 — that feature reuses this PDF pipeline).
- Poster-shops/large-format single-sheet export (covered by plain PDF in F-043).

## Functional requirements

- FR-1: A 100 mm test square prints as 100 mm ± 0.5 mm (with printer set to 100%),
  verified physically.
- FR-2: Tiles reassemble exactly: shared geometry in overlap zones is identical
  across adjacent pages.
- FR-3: All panel content within bounds appears on ≥1 page; nothing is clipped at
  outer margins.
- FR-4: Overview map page matches the tile labels.
- FR-5: Vector output (lines stay crisp; text selectable) — no rasterized pages.

## Technical guidance

- Recommend generating the PDF directly (e.g. `pdf-lib` behind our own
  document-drawing abstraction) rather than fighting print CSS; the same abstraction
  serves F-042 and F-043's PDF export. Electron's `webContents.printToPDF` is the
  alternative to spike — acceptable if scale fidelity holds.
- pt↔mm conversions are where scale bugs live; centralize them with tests.

## Acceptance criteria

- Physical test: print the reference panel on A4 tiles, tape together, measure key
  dimensions against the model (supervisor does this one on paper).
- Automated: parse the generated PDF and assert coordinates of known geometry.

## Open questions

_Resolved at review (see Resolved decisions)._

## Resolved decisions

1. (2026-07-20, Mathieu) **Default overlap 15 mm**, adjustable in the dialog. **Alignment-mark
   style**: per seam, a dashed fold/cut line down the overlap-band centre plus registration
   crosshairs (a plus inside a circle) at the band's top/middle/bottom, drawn identically on both
   sheets of the seam; corner crop marks on every tile; a page coordinate label (`B3`) and ASCII
   "join" markers to the neighbour tiles.
2. (2026-07-20, Mathieu) **PDF via `pdf-lib`** behind a new pure package `@vitrum/paper` holding the
   mm-space drawing abstraction, reused by F-042/F-043. pt↔mm centralised with tests.
3. (2026-07-20, Mathieu) **Automated acceptance at the drawing layer** (tiling grid + recorded
   mm-space ops + pt↔mm) plus one test that `pdf-lib` emits a valid PDF with the expected page
   count/dimensions — no raw-PDF byte parsing.
4. (2026-07-20, Mathieu) Make-dock Print placeholder → modal dialog; preview = page-grid overlay on
   the canvas; `ExportPort` on `AppHost` mirroring `StoragePort`; defaults A4 portrait, 10 mm
   margins, cartoon content, all optional elements on (numbers, glass legend, alignment marks, page
   labels, 100 mm calibration ruler, overview map page).

## Implementation notes

_Delivered 2026-07-20 on branch `f-041-print-tiling` (Status: done, pending the manual physical
calibration check listed below)._

**What shipped**

- **New pure package `@vitrum/paper`** (`packages/paper`, `core ← paper ← ui`, lint-boundary added,
  no DOM/Svelte/Electron) — the reusable document-drawing + PDF pipeline for F-041 and, next,
  F-042/F-043:
  - `units.ts` — the single home for pt↔mm (`mmToPt`/`ptToMm`, `1 pt = 1/72 in`, `1 in = 25.4 mm`)
    and the paper-size table (A4/A3/Letter portrait + `orientedSize`).
  - `page.ts` — the backend-neutral **mm-space drawing abstraction**: `DrawOp` (polyline / polygon
    with holes / rect / circle / text / clipped group), `PageContent`, `PdfDoc`, and a `PageBuilder`.
    Page space is top-left, y-down (same as the document/canvas), so world→page is a plain offset.
  - `clip.ts` — pure rectangle clipping (Liang–Barsky polylines, Sutherland–Hodgman polygons) so
    tile content never bleeds into the margins and the overlap band is provably identical on both
    neighbours (FR-2) — clipping lives in geometry, not the PDF backend.
  - `tiling.ts` — the page grid: `computeTiling` (overlap folded into the step, far-corner coverage,
    guards for zero printable area and over-large overlap), `tileLabel` (`A1`, `B3`), and
    `internalSeams` (shared band centres, the registration-mark anchors).
  - `scene.ts` — `PrintScene`/`PrintOptions` + defaults (`DEFAULT_OVERLAP_MM = 15`,
    `DEFAULT_MARGIN_MM = 10`, `CALIBRATION_LENGTH_MM = 100`).
  - `compose.ts` — `buildPrintDocument(scene, options)`: an overview map page (scaled panel + tile
    grid + labels + glass legend) then one page per tile (white sheet; content clipped + translated;
    fold lines + registration crosshairs at in-tile seams; corner crop marks; page label + neighbour
    markers; a true-size 100 mm calibration ruler with a "print at 100%, do not fit to page"
    caption).
  - `pdf.ts` — the only pdf-lib-aware module: renders a `PdfDoc` to real **vector** PDF bytes (FR-5),
    text embedded with standard fonts (selectable), fills via `drawSvgPath` (holes wound opposite for
    nonzero punch-through), clipped groups via raw graphics-state operators.
- **`ExportPort` on `AppHost`** (`savePdf(name, bytes)`): desktop shows a native save dialog and
  writes (with a `VITRUM_EXPORT_PATH` env override so E2E writes to a temp file), `browserHost`
  downloads, `fakeHost` records. Wired through the Electron preload + `export:savePdf` IPC handler.
- **UI (`packages/ui/src/print/`)**: `buildPrintScene` (snapshots the live derived data — network,
  cut contours, pieces, glass, numbering, legend — into a `PrintScene`); `PrintController` (runes:
  paper/orientation/margins/overlap/content/includes, `tilingFor` for the preview, `export` runs
  build→render→host); `PrintDialog.svelte` (tokens-only modal from `components/core`, live tile/page
  summary, calibration reminder, DRC warn-not-block callout). The **Make-dock "Print cartoon 1:1"
  placeholder is now a live action**; the **canvas gains a page-grid preview overlay**
  (`drawPrintTiles`) shown while the dialog is open.

**Deviations / decisions (implementer calls, spec silent)**

- **Content is pre-clipped in geometry and translated per tile**, then cropped again by a page-space
  clip group in the backend; the whole panel is _not_ redrawn per sheet. This makes FR-2 a provable
  data property and keeps files small.
- **Seam "join" markers use ASCII (`>` / `v`), not arrow glyphs** — the standard PDF Helvetica
  (WinAnsi) font has no `→`/`↓`, which would throw at encode time. Registration crosshairs carry the
  real alignment signal.
- **The calibration ruler length is `min(100 mm, printable width)`** and labelled with its actual
  length, so it can never overflow a tiny custom sheet; on A4/A3/Letter it is always 100 mm.
- **Custom paper size** is supported in the dialog (the spec's "up to 5,000 mm" is the _panel_ extent
  tiled across sheets, not a single sheet); paper stays a home-printer size.

**Tests**

- `@vitrum/paper` (32): `units` (pt↔mm identities, A4 in pt, round-trips); `clip` (polyline split /
  trim / drop, polygon straddle / drop); `tiling` (single-tile fit, overlap-into-step, far-corner
  coverage, exact overlap band, degenerate-margin throw, overlap clamp, seam count/placement in both
  neighbours); `compose` (page count + sheet size, overview toggle, **FR-3** all content on a tile,
  **FR-2** overlap-band geometry identical on adjacent tiles, **FR-4** overview labels every tile,
  calibration caption per tile, render-vs-cartoon fills); `pdf` (valid `%PDF`/`%%EOF` bytes,
  re-parsed page count + A4 pt size, A3-landscape/cut render without throwing).
- `@vitrum/ui` (+19): `print/scene` (segment/piece/legend/cut mapping), `print/controller`
  (defaults, custom paper, multi-tile grid, null tiling on bad margins, export produces `%PDF` bytes,
  error capture), `PrintDialog` (summary, DRC warn-not-block, export fires, disabled states),
  `NumberingPanel` (+3, live print action / disabled / placeholder fallback).
- E2E `print.spec.ts`: draw + number a piece, open the Print dialog from the Manufacturing dock,
  Export, and assert a real multi-page **vector A4 PDF** lands on disk (parsed back with pdf-lib) —
  this runs the packaged `file://` renderer, proving pdf-lib works bundled (no worker involved, so
  the F-030 `file://` worker caveat does not apply).

**Verified by me**: all gates green from the repo root — `lint`, `format:check`, `check`, `test`
(717 unit), `test:e2e` (20). Also verified visually in `pnpm dev:ui`: drawing a piece, renumbering,
and opening the Print dialog shows the correct tokens-styled dialog, the live tile/page summary, the
DRC warn-not-block callout, and the blue page-grid preview overlaid on the canvas.

**Pending Mathieu (manual, FR-1 — not automatable here)**

- The physical calibration check: print the reference panel on A4 tiles at 100%, tape together, and
  measure key dimensions (and the 100 mm ruler) against the model — the spec's supervisor-on-paper
  acceptance step.

**Update (F-043, 2026-07-21):** the standalone `PrintDialog` and its Make-dock "Print cartoon 1:1"
button were removed; the 1:1 tiled cutting template is now the **"Cutting template — 1:1 tiled"**
document type inside the single Export dialog (top-bar Export button). The pure `PrintController` +
`buildPrintDocument` pipeline is unchanged — the dialog composes it, and the canvas tile-grid preview
is preserved (keyed on the export dialog's tiled type). See F-043 Implementation notes.

**Follow-ups (out of scope)**

- `@vitrum/paper` is ready for **F-042** (cutting list / BOM tables) and **F-043** (single-sheet /
  large-format PDF + other formats) to reuse — both should build on `PdfDoc`/`buildPrintDocument`
  rather than re-touching pdf-lib.
- Per-piece glass code on tiles is implicit (grouped numbering embeds it) + the overview legend; a
  compact per-tile legend block could be added if bench feedback wants it.
- The print dialog does not yet remember settings across sessions (they reset per launch); persisting
  them on the project or app settings is a small future nicety.

**Note for Mathieu (unrelated to F-041)**: the working tree already contained uncommitted changes to
`apps/desktop/src/main/index.ts` (a system tray + macOS dock icon via `nativeImage`/`Tray`) that
predate this branch and are **not** part of F-041. One of them (`app.dock.setIcon`) failed
`pnpm check` (`app.dock` possibly undefined); I applied a one-line `app.dock?.setIcon` guard so the
shared gate passes, but you should decide whether those tray/dock changes belong in this PR or a
separate one.
