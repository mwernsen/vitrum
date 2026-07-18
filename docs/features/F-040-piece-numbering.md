# F-040: Piece numbering & cartoon view

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 4 — Production outputs |
| **Status**     | draft                  |
| **Depends on** | F-020, F-023           |
| **Complexity** | M                      |

## Summary

Turn the design into a workshop **cartoon**: every piece gets a stable number (with a
glass code), and a dedicated black-and-white cartoon view shows the panel the way it
goes on the bench. Numbering feeds the cutting list (F-042), 1:1 print (F-041), and
exports (F-043).

## Scope

- Numbering schemes (project setting): sequential by position (row-major sweep),
  grouped by glass (`A1..An, B1..`, where the letter is the glass code), or manual
  override per piece. Auto-renumber command; numbers persist via piece IDs and only
  change on explicit renumber (workshop cartoons must not shuffle mid-build).
- Glass codes: short code per used glass (auto `A, B, C…`, editable), shown in a
  legend (code → glass name/manufacturer).
- **Cartoon view**: a view mode (not a separate document) rendering line-work +
  numbers + glass codes, no color fills; label placement centered at the piece's
  visual center (pole of inaccessibility, not centroid — matters for L-shaped
  pieces), auto font-size from piece size, leader lines for pieces too small to hold
  a label.
- Number/label rendering also available as an overlay in the normal colored view.

### Non-goals

- Printing (F-041), list documents (F-042). Text annotation tools in general (backlog).

## Functional requirements

- FR-1: Every piece has exactly one number; schemes produce deterministic,
  human-sensible orderings; manual overrides survive auto-renumber of the rest.
- FR-2: Labels never render outside their piece without a leader line; no two labels
  collide at default zoom on the reference panel.
- FR-3: Editing geometry keeps numbers attached to surviving pieces (piece-ID
  stability); new pieces get flagged "unnumbered" until renumber.
- FR-4: Legend content matches actual assignments at all times.

## Technical guidance

- Pole-of-inaccessibility: port of the `polylabel` algorithm over F-010 polygons.

## Acceptance criteria

- Unit tests: scheme ordering, override persistence, label point inside piece.
- Manual: cartoon view of the reference panel is legible and bench-usable when
  screenshotted; a professional would recognize it as a proper cartoon.

## Open questions

1. Should numbers encode glass implicitly (`B4`) or stay plain (`17`) with the code
   shown beside? Diafane sorts templates by glass or size — supporting scheme choice
   covers both; confirm the default (proposal: grouped-by-glass).
