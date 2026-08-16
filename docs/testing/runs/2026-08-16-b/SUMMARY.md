# User test run 2026-08-16-b — summary

Second exploratory pass of the same day, after run
[2026-08-16-a](../2026-08-16-a/SUMMARY.md)'s six findings shipped in v0.6.0. Mathieu imported a
photo of the window he is reproducing and asked how to rotate it and move it off the origin.
Findings confirmed by code reading.

| Feature                     | Verdict          | S1  | S2  | S3  | S4  | env | manual |
| --------------------------- | ---------------- | --- | --- | --- | --- | --- | ------ |
| [F-051](F-051.md) reference | pass-with-issues | 0   | 2   | 1   | 0   | 0   | 0      |

## Top issues

1. **[S2] An imported image centres on the world origin — the panel's top-left corner.** Three
   quarters of every photo lands off the glass and must be dragged in. **Same root cause as run
   -a's F-052 [S1]**, whose learning ("the origin is a corner, not a centre — seed from
   `panelRect`") is already in the agent file. Second occurrence; worth grepping for a third.
2. **[S2] Reference layers cannot be rotated.** No rotate operation exists, though
   `ReferenceLayer`'s own doc comment says `dstQuad` is what move/scale/**rotate**/calibrate
   transform. Alt+dragging corners is a free transform — it shears rather than rotates.
3. **[S3] No numeric placement fields for a reference layer.** Calibration solves scale precisely;
   position and angle are drag-only, so a photo cannot be matched to known dimensions repeatably.

## Environment limitations

None — all three reproduce in `pnpm dev:ui` and were verified in source.

## Suggested next actions

All three handed to one `feature-implementer` in this session as a single ticket: they touch the same
four files (`reference/controller.svelte.ts`, `shell/ReferenceOverlay.svelte`, `shell/Inspector.svelte`,
`docs/features/F-051-reference-image.md`), so splitting them would only manufacture conflicts.

Not handed off, carried from run -a and still open:

- **Drawing the same line twice by hand yields zero pieces** (pre-existing F-020 defect, same
  mechanism as -a's on-axis bug, symmetry off). Needs a decision: de-duplicate in `buildGraph`
  versus making `duplicate-segment` blocking. A task chip exists.
- **`dev:ui` logs three console errors per page load** (`Cannot use import statement outside a
module`). The app renders correctly; unattributed — either a regression since the 2026-07-29 run
  recorded a clean console, or the browser harness's own injection.
- **Unassigning an _inherited_ colour does nothing until the next save** — shipped knowingly in
  v0.6.0; eager materialisation is the follow-up.
- **Glass orbit inheritance does not span axis-fixed boundaries** — a consequence of v0.6.0's
  self-image suppression. Fails safe.
