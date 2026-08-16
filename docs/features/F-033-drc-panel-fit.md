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

- `design-exceeds-panel`: the design's **assembled** extent — the drawn extent grown by
  the technique's perimeter came allowance — is measured against the ordered panel
  rectangle, which spans (0,0)→(width, height) in world mm and is the **finished** panel
  (open question 1, resolved 2026-08-16). Reported when any part of the assembled panel
  falls more than the fit tolerance (default 1 mm) outside it.
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
- ~~Reasoning about the came allowance~~ — settled by open question 1 (2026-08-16) and
  implemented; see the amendment in the implementation notes.

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
  warning. Both state the measurement: the assembled extent, the ordered size, the
  overrun, and (since 2026-08-16) the drawn extent plus the perimeter allowance that
  separates the two.
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

1. ~~**What does `panelSize` mean — the glass, the leaded panel, or the aperture?**~~
   **Resolved (Mathieu, 2026-08-16): `Project.settings.panelSize` is the FINISHED
   panel — the outside dimensions of the assembled panel, as a customer orders it and a
   glazier measures it.** It is _not_ the drawn lead centreline. The rule therefore adds
   the technique's perimeter came allowance to the drawn extent before comparing, and
   both grades measure that assembled extent. Implemented on branch
   `f-033-finished-panel-size`; see the amendment at the end of the implementation notes.
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

### Amendment (2026-08-16) — `panelSize` is the finished panel, and the rule measures it

Mathieu's answer to open question 1: **the ordered size is the finished panel** — the
outside dimensions of the assembled panel, as a customer orders it and a glazier measures
it. The rule as first shipped compared the **drawn centreline** extent with that number, so
a design drawn to exactly 300 mm in a 300 mm panel passed clean and then did not fit the
opening — a rule graded `error` being confidently wrong. Delivered on branch
`f-033-finished-panel-size`.

**The allowance model (in F-021's home, not this pack).** New
`perimeterAllowance(technique, borderSegmentIds)` in
[`packages/core/src/technique/allowance.ts`](../../packages/core/src/technique/allowance.ts),
the outward twin of the existing inward `edgeAllowanceMm`, exported from `@vitrum/core`:

- **Lead came** ⇒ `flange / 2`, from the came resolved on the design's `border`-role
  segments (widest wins when several differ; the library default profile when no border is
  drawn yet). The justification is the app's own drawing: F-021 renders every came as a band
  of `flangeMm` **centred on the drawn line**, so the perimeter came's outer face — the
  finished edge — lies half a flange outside the border. With the shipped default (H 5 mm)
  that is 2.5 mm per side, so a 300 × 400 drawing assembles to 305 × 405.
- **Copper foil** ⇒ `0`, and honestly so rather than by borrowing a came number: there is no
  perimeter came. The glass is cut back half the piece gap from the drawn line and the edge
  is then wrapped and soldered, landing the finished edge back on the drawn line to within a
  fraction of a millimetre — under the 1 mm tolerance either way. This needed no new
  persisted parameter, so no schema migration; a solder-bead dimension would be the thing to
  add to `FoilSettings` if that fraction ever has to be exact.
- **Known approximation, recorded rather than hidden:** a U-profile perimeter came overhangs
  _less_ than half its flange (its channel opens inward, so its back web sits nearer the
  glass edge). F-021 deliberately deferred a U-specific perimeter model and draws every came
  centred, so this follows the same convention and errs generously — a fit check should
  over-state the finished panel, not under-state it.

**The rule.** `design-exceeds-panel` now grows the drawn extent by that allowance and
measures the result; the two-grade severity and the `toleranceMm` threshold are unchanged in
design, but both grades are now about the assembled panel. Each pointed-at segment and piece
is measured assembled too, so a line drawn just inside the edge whose came lands outside is
named. The marker anchors on the assembled corner. Messages carry all four numbers:

- `assembles to 305 × 405 mm — 5 mm wider and 5 mm taller than the ordered 300 × 400 mm panel (drawn 300 × 400 mm plus 2.5 mm of came on each side)`
- `assembles to 285 × 385 mm — it fits the ordered 300 × 400 mm panel but extends 42.5 mm past its right edge (drawn 280 × 380 mm plus 2.5 mm of came on each side)`
- foil: `… (drawn 400 × 400 mm; foiled edges add no width)`

The `explain` and the threshold rationale were rewritten: they used to warn that came adds
width _on top of_ what the rule measured, which is now the opposite of the truth.

**The canvas frame draws both rectangles.** `drawPanelFrame` takes an `insetMm` and strokes
the finished outline exactly as before (solid, 1 px, `panelFrame` token) plus a finely
**dotted** rectangle that far inside it — the came centreline, which is the line the user
actually aims their border at. Both, not just one, because each answers a different question:
the solid one is what the customer ordered and what the rule measures, the dotted one is
where to click. Same token and weight so the pair reads as one object; dotted rather than
solid or dashed so it collides with neither the frame nor the construction guides (`[4, 4]`)
nor the symmetry axes (`[6, 5]`). It is suppressed when the two lines would be closer than
2 px on screen (zoomed out, they would only muddy the edge) or when the allowance would
swallow the panel, and it never draws for foil, where the allowance is zero and the drawn
border _is_ the panel edge. Still overlay-layer, design-view-only chrome, for F-058's
reasons — including that `toPngBytes` reads only the content canvas. The inset comes from
`panelInsetMm(project)` in `canvas/scene.ts` (the `panelRect` sibling), wired
`AppShell` → `Canvas`.

**Audit of the other `panelSize` consumers** (all four asked about; two touched):

- `panelRect` / `documentBounds` — **correct unchanged.** The rectangle _is_ the finished
  outline, and zoom-to-fit framing the finished panel (unioned with the drawn content) is
  right. Only its doc comment needed the new meaning.
- `defaultSymmetryCenter` — **correct unchanged.** The allowance is symmetric, so the centre
  of the finished panel is the centre of the drawn area.
- The library card's size line (`packages/model/src/library.ts`) — **correct unchanged**, and
  arguably better: the figure a customer or glazier reads is the finished size.
- The new-panel dialog — **copy added.** The size fieldset now carries "Outside dimensions of
  the finished panel, once it is leaded or foiled." Under the size row, not on the Width /
  Height labels: the meaning belongs to the pair, and the labels are the mono numbers'
  captions. Technique-neutral wording because the same dialog also chooses lead or foil.
- The F-042 BOM — **nothing wrong, nothing to fix.** It never reads `panelSize`: came lengths
  are integrated along the drawn segments, which is the material length whatever the ordered
  size means. Left as a follow-up: the cutting list does not _state_ the finished size at all,
  and paperwork that a customer sees arguably should.

**Fixtures.** No existing fixture's verdict flipped — verified by running the golden suite
before regenerating anything. `fit-oversized` (400 × 400 drawn) stays an error,
`fit-misplaced` (280 × 380 at (60, 10)) stays a warning, `fit-inside` (280 × 380 at (10, 10))
stays silent, because 2.5 mm per side changes none of those three verdicts. Only their
messages changed. A **fourth** scene and on-disk fixture was added for the regression:
`fit-drawn-to-size` — a border drawn to exactly the ordered 300 × 400 — which is an error
_only_ under the new meaning, and proves it survives serialize → migrate → cold reload.

**Testing**

- `packages/core/src/technique/technique.test.ts` (+4): the lead allowance is half the flange,
  the border came beats the library default (and the widest of several wins), foil is zero, and
  a nonsensical negative flange clamps to zero.
- `packages/drc/src/fit.test.ts` (23 → 29). The regression case is explicit — "flags a design
  drawn to exactly the ordered size" is the old suite's "is silent on a design that exactly
  fills the ordered panel", inverted. Added: the silent case is now a design drawn to the
  ordered size _less_ the allowance; a heavier U 9 mm perimeter came turns a passing drawing
  into an error; a heavier default profile does the same; a foiled panel of the same drawing is
  silent; a foiled overrun says "foiled edges add no width"; and a segment drawn inside the
  panel whose came lands outside is named.
- `packages/drc/src/golden.fit.test.ts` — four scenes now, including `fit-drawn-to-size`.
- `packages/ui/src/canvas/render.test.ts` (+5) — the inset rectangle's screen geometry, its dot
  pattern and reset, foil drawing the outline only, and both suppression cases.
  `canvas/scene.test.ts` (+3) — `panelInsetMm` for the default came, a border came override,
  and foil.
- E2E `apps/desktop/e2e/panel-fit.spec.ts` — the existing test now also asserts the message
  measures the assembled panel; a **second** test opens
  `e2e/fixtures/drawn-to-size.vitrum` (the same scene, packed as a real document, because no
  click on a canvas lands on an exact millimetre) and reads the full 305 × 405 error through
  the real classic worker under `file://`.
- All gates green from the repo root: `pnpm lint`, `pnpm format:check`, `pnpm check`,
  `pnpm test` (1502), `pnpm test:e2e` (38).

**Handed to Mathieu**

- **The allowance model itself is a domain judgement**: half the perimeter came flange for
  lead, nothing for foil. If a workshop measures its finished panels differently (e.g. U came
  butted to the glass edge rather than centred on the drawn line), this is the number to
  revisit — and the U-came approximation above is the first place it would show.
- **A look at the double frame on the canvas.** Pixels are not asserted anywhere; the dotted
  centreline's weight and dot rhythm want a human eye at a few zoom levels, and the
  suppression threshold (2 px) is a taste call.
- The message is now long (~135 characters) for a queue row. It reconciles with a ruler, which
  is what the ticket asked for, but the Check dock's row layout deserves a look.

**Follow-ups (out of scope)**

- The rule still cannot suggest "order 305 × 405 instead", which is the one quick fix that is
  now computable — the assembled size is exactly the number to offer. A quick-fix that edits
  `panelSize` needs the "editing panel size after creation" gap (F-058) to close first.
- Nothing else reads the allowance yet: the BOM's perimeter came length is integrated along the
  drawn centreline (right for material), but a finished-size line on the cutting list and the
  quote would close the loop from order to paperwork.
- A foil solder-bead dimension in `FoilSettings`, if foil edges ever need sub-millimetre
  honesty; and F-021's U-came perimeter model.
