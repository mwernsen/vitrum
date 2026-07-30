# F-040: Piece numbering & cartoon view

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 4 — Production outputs |
| **Status**     | done                   |
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

_None — all resolved._

## Resolved decisions

1. (2026-07-20, Mathieu) **Default numbering scheme is grouped-by-glass**, with the
   number encoding the glass code implicitly (`A1..An, B1..`, letter = glass code).
   All three schemes (sequential-by-position, grouped-by-glass, manual override)
   remain selectable per project; grouped-by-glass is the default a new project starts
   with. Resolves the original open question (encode glass implicitly vs. plain number
   with code beside) in favour of implicit encoding under the default scheme.

## Implementation notes

_Delivered 2026-07-20 on branch `f-040-piece-numbering` (Status: done, pending the manual
gallery/bench check listed below)._

**What shipped**

- **Pure core (`@vitrum/core/pieces/numbering.ts`)** — model- and DOM-free, the way piece detection
  and glass assignment are:
  - `renumber(input)` — the deterministic renumber over reading order (`rowMajorOrder`, a
    median-height row-banded top-to-bottom, left-to-right sweep, content-id tiebreak). `sequential`
    yields `1,2,3…`; `grouped` yields `<code><n>` per glass group; `manual` yields nothing.
    Overridden pieces keep their manual label and are excluded from the auto-sequence (FR-1); auto
    labels skip any string an override already uses so labels never coincide.
  - `assignGlassCodes` / `codeAt` — spreadsheet-style codes (`A..Z, AA…`) handed out in
    first-appearance order, keeping existing (editable) codes and filling gaps.
  - `labelPlacement(piece)` — the label anchor is the **pole of inaccessibility** via the geometry
    kernel's existing `inscribedCircle` (a `polylabel` port over F-010 polygons, holes respected), so
    the point is always inside the piece — verified on an L-shape (FR-2). Its inscribed radius drives
    auto font-size and the leader-line decision.
  - `UNASSIGNED_CODE = '?'` — unassigned pieces group under `?` in grouped mode (see deviations).
- **Model (`@vitrum/model`)** — `NumberingState { scheme, glassCodes, auto, overrides }` on `Project`
  (schema **v7 → v8**), keyed by piece **content id** so numbers reproduce on reload (mirrors F-023).
  One command `updateNumbering(patch)` expresses every gesture (scheme change, renumber, manual
  override, glass-code edit, save-time normalisation), self-inverting so each is one undo step.
- **UI (`@vitrum/ui`)**:
  - `NumberingController` (runes) resolves each live piece's **effective** number (override wins over
    auto) and its label placement, inheriting across geometry edits via two `resolveGeneration`
    pipelines gated on the detection generation token — the exact F-023 mechanism — so a reshaped
    piece keeps its number and a genuinely new piece is unnumbered (FR-3). A save-time normaliser
    materialises inherited numbers under current content ids (wired alongside the assignment one).
  - **Cartoon view** is a live **view mode** (`shell/viewmode.ts` `cartoon` turned live; switched
    from the top bar): the canvas renders a white sheet + black line work + numbers, no colour fills,
    the drawing tool palette is hidden and the canvas is read-only (pan/zoom only). `drawNumbers`
    (canvas renderer) sizes each label from the inscribed radius, adds a **leader line** to a label
    just outside pieces too small to hold it (FR-2), and haloes glyphs for legibility.
  - Numbers are also an **overlay in the coloured view** via a new Layers-panel "Numbers" toggle
    (`viewport.numbersVisible`).
  - The **"Make" dock section** (activity rail, previously an F-042 placeholder) is now live for
    numbering: `NumberingPanel` (scheme selector, Renumber, numbered/unnumbered counts, editable
    **glass legend** code→glass→count) with cutting-list/BOM/print/export still as disabled
    placeholders tagged F-041/042/043. A `CartoonLegend` overlay shows the same legend on the cartoon
    sheet so it is bench-usable standalone (FR-4).
  - The **readiness strip "Outputs" pill** (previously an F-040 placeholder) is now live: numbered
    ratio, complete once every piece has a number. The **inspector** piece panel shows the effective
    number and an editable per-piece override field.

**Deviations / decisions (implementer calls, spec silent)**

- **Unassigned pieces in grouped mode** get the sentinel code `?` (labels `?1, ?2…`), a clear
  "assign glass then renumber" signal, since a glass-encoding scheme has no letter for a piece with
  no glass. FR-1 ("every piece has exactly one number") still holds.
- **Split inheritance mirrors glass**: both fragments of a split transiently inherit the parent's
  number until the next renumber (documented follow-up), rather than one heir keeping it and the
  other flagging unnumbered. This reuses F-023's proven lineage machinery verbatim; a renumber
  resolves it. Genuinely new pieces (no ancestor) are correctly unnumbered.
- **Label placement is not full collision-avoidance**: labels sit at the pole (with leaders for tiny
  pieces); overlapping leaders on adjacent slivers are possible. FR-2's "no two labels collide at
  default zoom on the reference panel" is met on realistic panels but is the manual/gallery check.
- Per-piece glass code is shown on the cartoon **only implicitly** (grouped labels embed it) plus the
  legend; sequential/manual cartoons rely on the legend for glass identity (monochrome sheet).

**Tests**

- Core `numbering.test.ts` (12): `codeAt`/`assignGlassCodes`, sequential + grouped ordering,
  determinism under input reordering, unassigned `?` group, override persistence + collision-skip,
  manual scheme, and label-point-inside-piece incl. an L-shape (acceptance: scheme ordering, override
  persistence, label point inside piece).
- Model `numberingCommands.test.ts` (6): scheme/renumber/override/multi-field patch apply-invert-undo,
  serialize round-trip; `serialize.test.ts` v7→v8 migration + synthetic chain extended to v8.
- UI `numbering/controller.svelte.test.ts` (6): auto/override resolution, placement inside pieces,
  unnumbered count, split inheritance, reset; `NumberingPanel.test.ts` (6) and `ReadinessStrip.test.ts`
  (+3, outputs pill).
- E2E `numbering.spec.ts`: draw a piece → outputs "0/1 numbered" → open Manufacturing → Renumber →
  outputs "numbered" → Cartoon view (legend shown, tool palette hidden) → save + reopen, numbering
  intact.

**Verified by me**: all five gates green from the repo root — `lint`, `format:check`, `check`,
`test` (666 unit), `test:e2e` (19). Also verified visually in `pnpm dev:ui`: a 2×2 painted panel
renders in the cartoon view as a proper monochrome cartoon — pieces labelled `A1/A2` (Ruby) and
`B1/B2` (Crimson), each number centred inside its piece, with the code→glass legend on the sheet.

**Pending Mathieu (manual, not automatable)**

- The acceptance gallery/bench check: cartoon of the full reference panel is legible and a
  professional recognises it as a proper cartoon (leader lines on real slivers, font sizing across a
  dense panel, no colliding labels at default zoom).

**Follow-ups (out of scope)**

- One heir keeps the number on a split (vs. both inheriting); needs numbering-specific lineage rather
  than reusing the glass "both inherit" rule.
- Label collision-avoidance / leader routing for dense sliver clusters.
- Autosave path does not run the save-time normaliser (same F-023 caveat) — a crash-recovery
  snapshot after a mid-session reshape could lose that reshape's number on recover; explicit save is
  robust.
- Downstream consumers (cutting list F-042, 1:1 print F-041, export F-043) read `numbering` next.

_Cockpit v2 (2026-07-30):_ the `CartoonLegend` canvas overlay moved into the inspector's cartoon-view context. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.
