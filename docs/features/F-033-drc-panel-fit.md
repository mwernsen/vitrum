# F-033: DRC rule pack — panel fit

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 3 — Design rule checks |
| **Status**     | done                   |
| **Depends on** | F-030, F-058           |
| **Complexity** | S                      |

## Summary

Rules about whether the design matches the panel the maker **ordered**. The new-panel
dialog (F-058) asks for a width and height and stores them in
`Project.settings.panelSize`, but nothing checked the drawing against them: a 400 mm
design in a 300 mm panel was silent until the cutting list. This pack is the missing
check. It ships one rule, `design-exceeds-panel`.

Raised by user testing, not by a roadmap gap — see
[docs/testing/runs/2026-08-16-a/F-058.md](../testing/runs/2026-08-16-a/F-058.md)
finding **[S3]** and issue 5 of
[SUMMARY.md](../testing/runs/2026-08-16-a/SUMMARY.md).

## User story

As a stained glass designer, I want to be told when my drawing no longer fits the panel
size I set out to build, so that I find out at the drawing board rather than at the
bench with a sheet of glass that is too small.

## Scope — rules

- `design-exceeds-panel`: the drawn design's extent is measured against the ordered
  panel rectangle, which spans (0,0)→(width, height) in world mm — the same rectangle
  zoom-to-fit frames. Reported when any part of the design falls more than the fit
  tolerance (default 1 mm) outside it.
  - **Error** when the design is _larger_ than the ordered panel in either dimension:
    no amount of moving it will make it fit the glass.
  - **Warning** when the design _would_ fit but is drawn outside the rectangle: the
    fix is to move it.
  - Silent when `panelSize` is absent (no order, no reference), when the document is
    empty, and when only construction guides run off the panel.

### Non-goals

- Drawing the panel rectangle on the canvas (a separate F-058 follow-up; this pack is
  the check, not the chrome).
- A quick-fix action. There is no safe automatic repair: shrinking the design, moving
  it and re-ordering the glass are all legitimate and only the maker can choose.
- Editing `panelSize` after creation (still creation-time only, F-058).
- A "design is much smaller than ordered" (wasted glass) rule, and a "piece exceeds its
  glass sheet" rule — both natural siblings for this pack, neither in scope here.
- Reasoning about the came allowance: whether `panelSize` means the glass, the leaded
  outer dimension or the aperture is undecided (see Open questions).

## Design

No new UI. The pack plugs into F-030's registry, so its violations appear in the Check
dock's queue, its `explain` in the "Fix next" card, its severity in the readiness meter
and its marker on the canvas overlay, all with no component change. The rule's
threshold renders itself in the existing rule-settings list from its `ThresholdSpec`
data (F-031's convention).

## Functional requirements

- FR-1: With no `panelSize` the pack emits nothing — absence must never read as a
  zero-sized panel that every design overruns.
- FR-2: A design larger than the ordered panel in either dimension is an error; a
  design that fits the ordered size but is positioned outside the rectangle is a
  warning. Both state the measurement: the drawn extent, the ordered size, and the
  overrun.
- FR-3: The extent is the _true_ geometric extent — an arc or bézier that bows outward
  is measured at its extremum, not at its endpoints.
- FR-4: The violation points at the specific segments and pieces that fall outside, so
  the framework highlights them, and anchors its marker on the corner of the design
  that sticks out furthest.
- FR-5: The fit tolerance is a per-project tunable `ThresholdSpec`, like every other
  pack's craft numbers, and the rule can be disabled or re-graded per project.
- FR-6: Construction guides never trigger it (they are scaffolding, not glass).

## Technical guidance

- `DrcInput.project` is the whole `Project`, so `input.project.settings.panelSize` is
  reachable with no plumbing change; no engine, worker or UI change is needed.
- The structural pack (F-032) already derives a panel extent from the drawn network
  (`panelMetrics`). It measures the same network against a _different_ reference, and
  from segment **endpoints** — do not conflate the two.

## Acceptance criteria

- Unit suite covering: silence with no order / on an empty document / inside the panel
  / within tolerance / for guides only; the oversized error with its message; the
  misplaced warning with its per-edge message; the curve-extremum case; the pointed-at
  entities and marker anchor; the threshold override and the per-project disable.
- On-disk golden `.vitrum` fixtures, as the other packs have, proving the ordered size
  survives save/load and still grades the design after a cold reload.
- One Playwright E2E: draw a design larger than the panel the new-panel dialog ordered,
  run the checks, read the violation, undo, watch it clear.

## Open questions

1. **What does `panelSize` mean — the glass, the leaded panel, or the aperture?** The
   drawn border is the lead **centreline**, so the finished panel is wider than the
   drawn extent by the perimeter came's overhang. This rule deliberately compares the
   drawn extent with the ordered rectangle and says so in its `explain` (which warns
   that came adds width on top). If `panelSize` is meant to be the _finished_ size,
   the rule should subtract a came allowance before comparing — a change of meaning
   that also affects zoom-to-fit and the library card, so it needs Mathieu's decision.
   **Recommendation:** leave as shipped, and revisit with F-042's cutting list, which
   is the other place the ordered size becomes a material fact.
2. **Should the error grade be softer?** A 2 mm oversize is an error today, on the
   ground that the glass really is too small to cut. **Recommendation:** keep it; the
   1 mm tolerance absorbs slop and a workshop that disagrees can retune the threshold
   or re-grade the rule per project.

## Implementation notes

Delivered on branch `f-033-drc-panel-fit` (2026-08-16). Both open questions above are
recorded _by_ this implementation rather than resolved before it — neither blocks the
rule as scoped, and both are flagged for Mathieu.

**What shipped**

- **New rule pack `packages/drc/src/rules/fit.ts`** exporting `FIT_RULES`, appended to
  the registry after the structural pack. One rule, `design-exceeds-panel`, titled
  "Exceeds panel". `RuleId` gained the id; `index.ts` exports the pack. No engine, no
  worker, no UI change — the runner iterates whatever is registered, and the Check dock,
  readiness meter, canvas markers and rule-settings list all picked the rule up
  unmodified.
- **Its own extent measurement**, deliberately _not_ F-032's `panelMetrics`: the union
  of each output segment's tight `bboxOf(geometry)` (true arc/bézier extrema) plus the
  detected pieces' bboxes. `panelMetrics` collects segment **endpoints**, which is right
  for a fold axis and wrong here — "will this fit the sheet" is about the outermost
  millimetre. The pieces are folded in for the same reason `panelMetrics` does it: they
  are derived from the _expanded_ network, so a symmetry replica (F-052) that overruns
  is still measured even though `DrcInput.project` carries only source geometry.
- **One tunable threshold**, `toleranceMm` (default 1 mm, same for lead and foil),
  declared as `ThresholdSpec` data and read through the shared `resolveThreshold`, so
  it renders in the rule-settings list and takes a per-project override (FR-5).
- **Messages** state the measurement, in the packs' voice:
  - `design is 400 × 400 mm — 100 mm wider than the ordered 300 × 400 mm panel`
  - `design is 280 × 380 mm — it fits the ordered 300 × 400 mm panel but extends 40 mm past its right edge`
  - and the `explain` teaches the failure mode, including that perimeter came adds its
    own width outside the drawn edge.

**Decisions**

- **A new pack rather than a rule in F-032.** Each existing pack has a coherent
  charter — topology asks whether the network closes, cuttability whether each piece
  can be cut, structural whether the assembly survives — and a fit-versus-order check
  is none of them; folding it into F-032 would have made that spec's summary false for
  one of its rules. The repo also maps packs 1:1 onto specs, and the registry documents
  appending a pack as _the_ extension path. It gives the obvious siblings (piece vs
  glass sheet, wasted glass, came allowance) a home that does not widen F-032.
- **Severity is derived from a real distinction, not a percentage.** Default
  `warning`, escalating to `error` via F-031's per-violation grading seam when the
  extent genuinely exceeds the order. That reads as: warning ⇒ move it, error ⇒ it does
  not fit the glass you ordered. It also means only one threshold is needed, where an
  arbitrary "gross overrun percent" would have needed two.
- **One violation for the whole design**, identity `['panel']`, following
  `panel-needs-reinforcement`: the fit of a design against its order is a single fact,
  and a single waivable item. It carries `segmentIds`/`pieceIds` for exactly the
  entities that fall outside (FR-4) and anchors `at` the furthest-out corner, with
  `distance` set to the worst overrun.
- **Messages round to a tenth of a millimetre**, not to whole millimetres as the
  structural pack does: with a 1 mm tolerance, printing a 1.4 mm overrun as "1 mm" would
  contradict the tolerance that just let 1.0 mm through.

**No fixture or golden regeneration was needed.** No existing `.vitrum` fixture carries
a `panelSize` (they are all built from `createEmptyProject`, whose default settings omit
it), and every pack's suite is scoped to its own rules, so nothing newly triggers. That
is a point in favour of the severity choice rather than against it: the only documents
that gain an error are ones where the maker actually stated a size. The E2E editor
helper _does_ order 300 × 400 mm (the dialog's defaults), so `structural.spec`'s
deliberately metre-plus panel now also raises this rule — it asserts on its own rule's
rows and still passes.

**Testing**

- `packages/drc/src/fit.test.ts` — 23 tests: the six silence cases (FR-1, FR-6), the
  oversized error and its exact message including the finding's 400-in-300 case, both
  dimensions, an oversized design centred on the panel (still an error), fractional
  overruns, the misplaced warning and its per-edge naming for all four edges (world y
  grows downward, so y = 0 is the top), the curve-extremum case (FR-3), the pointed-at
  segments/pieces and the marker anchor (FR-4), the waiver key, and the threshold
  override plus per-project disable (FR-5).
- `packages/drc/src/golden.fit.test.ts` + `src/fixtures/fit-{oversized,misplaced,inside}.vitrum`
  — the on-disk golden suite each pack has, loaded through the persistence path: the
  headline count _and_ severity per scene, `panelSize` intact after the reload, and the
  builder drift-guard.
- E2E `apps/desktop/e2e/panel-fit.spec.ts` — draw a metre-plus design in the dialog's
  300 × 400 mm panel, run the checks, see "Exceeds panel" and the ordered size in the
  message, undo the design, re-run, watch it clear. This also exercises the rule through
  the real classic worker under `file://` (the F-030 lesson).
- All gates green from the repo root: `pnpm lint`, `pnpm format:check`, `pnpm check`,
  `pnpm test` (1422), `pnpm test:e2e` (35).

**Handed to Mathieu**

- The two open questions above (came allowance semantics; error-grade harshness).
- A design-system eye on the message and `explain` copy, as with the other packs'
  teaching text.
- The canvas marker for this rule is a visual check (pixels are not asserted in E2E).

**Follow-ups (out of scope)**

- The waiver identity is `['panel']`, so waiving the violation keeps it waived even if
  the overrun later gets worse. Same characteristic as `panel-needs-reinforcement` and
  `panel-weight`; a size-aware identity would re-raise on any edit instead, which is
  worse. Worth revisiting only if it bites.
- `DrcInput.project` carries the **source** network, not F-052's expanded one, so
  off-panel symmetry replicas are seen only through detected pieces. Shared with
  F-032's `panelMetrics`; the clean fix is an expanded-network field on `DrcInput`.
- Reinforcement bars are not measured. A bar is meant to sit inside the panel, but
  nothing checks that.
- Sibling rules this pack was created to host: piece exceeds its glass sheet (with
  F-022 sheet sizes), design much smaller than ordered (wasted glass), came allowance
  once open question 1 is settled.
