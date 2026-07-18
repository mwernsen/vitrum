# F-041: 1:1 printing with tiling

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 4 — Production outputs |
| **Status**     | draft                  |
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

1. Default overlap width (proposal 15 mm) and mark style — cosmetic, decide at review.
