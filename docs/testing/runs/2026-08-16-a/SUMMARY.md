# User test run 2026-08-16-a — summary

Exploratory session, not a scripted run. Mathieu tried to reproduce an existing real window (a
Dutch Art Deco transom: nested yellow/orange border with red corner squares, plus an interlaced
two-ring motif) and got stuck during setup. Findings were confirmed by code reading afterwards;
no finding rests on observation alone.

| Feature                    | Verdict          | S1  | S2  | S3  | S4  | env | manual |
| -------------------------- | ---------------- | --- | --- | --- | --- | --- | ------ |
| [F-052](F-052.md) symmetry | fail             | 1   | 2   | 1   | 0   | 0   | 0      |
| [F-058](F-058.md) panel    | pass-with-issues | 0   | 1   | 1   | 0   | 0   | 0      |

## Top issues

1. **[S1, F-052] The symmetry centre sits on the panel's top-left corner and cannot be moved.**
   `defaultCenter` is world (0, 0) while panels span (0, 0)→(w, h). `setCenter` exists on the
   controller but has no UI caller. F-052's core story cannot complete on a real panel.
2. **[S2, F-058] The panel rectangle is never drawn.** `panelSize` reaches only zoom-to-fit,
   the library card and the dialog's own defaults. The size the user types is invisible and
   unenforced — and it is why the symmetry axes look like they anchor on nothing.
3. **[S2, F-052] Snapping is evaluated in folded source space.** Crossing the axis mid-line makes
   the preview flip between 45° angles. Two halves: the snap index holds source segments only, so
   in a replica sector only grid and angle snap can fire; and angle snap is then measured against a
   reflected point. Fix is to snap in the cursor's sector over the expanded network, then fold the
   winner back — exact, and it also makes replica geometry snappable.
4. **[S2, F-052] Symmetry replicates linework but not glass.** Assignments key off
   absolute-coordinate content ids, so every sector is painted by hand. Design change, needs a
   decision before any implementation.
5. **[S3] Two smaller gaps.** Nested symmetries need bake-staging and nothing says so (a D2 border
   around a C2 motif is buildable — double mirror → bake → radial 2 → bake — but reads as
   unsupported); and nothing warns when a design overruns the panel size (candidate
   `design-exceeds-panel` rule on the F-030 framework).

## Environment limitations

None — both findings are reproducible in `pnpm dev:ui` and were verified in source.

## Suggested next actions

Handed to `feature-implementer` in this session (one branch, sequenced — issue 2 first, since
the symmetry centre's new default is defined in terms of the panel rectangle):

- **F-058** — draw the panel rectangle on the canvas (SUMMARY issue 2 / F-058 finding 1).
- **F-052** — seed the symmetry centre to the panel centre and make it editable (SUMMARY
  issue 1 / F-052 finding 1).

- **F-052** — snap in the cursor's sector over the expanded network, then fold the winner back to
  source (SUMMARY issue 3 / F-052 finding 2). Shares `AppShell.svelte` with the centre ticket;
  expect a small merge conflict around lines 176–180 and 258.
- **F-052** — glass inherits across replicas (SUMMARY issue 4 / F-052 finding 3). Mathieu approved
  proceeding; the agent recommends the semantics and flags them for review.
- **F-030/F-032** — `design-exceeds-panel` rule (SUMMARY issue 5, second half).

Deliberately _not_ handed off:

- **F-052 nested symmetry / bake-staging discoverability** (issue 5, first half) — scope ranges
  from one hint line to real per-region symmetry. Needs Mathieu's scope call first.
- **On-canvas symmetry centre dragging** — already a listed F-052 follow-up; the centre ticket
  ships numeric fields only.
