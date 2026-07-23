# User test run 2026-07-22-a — summary

Scope: F-052 (smoke run validating the user-test skill itself). Mode: full.

| Feature             | Verdict          | S1  | S2  | S3  | S4  | env-limited | manual |
| ------------------- | ---------------- | --- | --- | --- | --- | ----------- | ------ |
| F-052 live symmetry | pass-with-issues | 0   | 1   | 3   | 0   | 2           | 0      |

## Top issues

1. **[S2] Symmetry center point cannot be placed or edited anywhere in the UI**
   (F-052) — the model stores and persists `center`, and Decision §7 places its config
   in the Layers symmetry section, but no control exists in any mode. Mirroring across
   a panel's own midline is impossible. See [F-052.md](F-052.md).
2. **[S3] Default center (0,0) puts the stored source geometry off-panel** (F-052) —
   with the sample panel spanning 0..300 × 0..400, drawing on the sheet stores the
   segment in the x<0 half; compounded by issue 1 because the center cannot be moved.
3. **[S3] Clicking a replica is a silent dead click** (F-052) — v1 read-only replicas
   are intentional, but the missing part is any feedback; a first-time user's first
   click on their own design does nothing.
4. **[S3] Saved/Unsaved badge contradicts autosave state** (likely owned by
   F-002/persistence, observed on the F-052 flow) — the badge flips both ways on no
   visible rule while the autosave already matches the live document.
5. **[Q] Enter does not finish a line gesture under automation** (F-011?) — F-011 says
   Enter finishes; other single-key shortcuts reach the app from the same focus state.
   Needs one manual keystroke to settle app bug vs harness quirk.

## Environment limitations encountered

- File open/save round-trip (FR-4 load half): native dialogs — standing limit.
- Reload-and-recover flow: native `window.confirm`; the attempt wedged the Browser
  pane and took the dev server down. Serialization verified by decoding the autosave
  zip instead. (Now codified in the environment dossier — later runs will not repeat
  this.)
- Cut short by the environment loss, untested rather than cleared: layout audit at
  1050×700 / tall-narrow / dark mode; full keyboard-only pass over the symmetry
  section; final console/network sweep (mid-session console read was error-free).

## Suggested next actions

- Fix ticket for `feature-implementer`: **F-052 — add the symmetry center control**
  (Layers › SYMMETRY; Decision §7 already places it there; consider defaulting the
  center to the panel-border centroid when one exists). Source:
  `docs/testing/runs/2026-07-22-a/F-052.md`, finding S2-1; also resolves finding 2.
- Fix ticket: **F-052 — replica click feedback** (select the source segment, or show a
  status hint that replicas are read-only). Finding 3.
- Investigate: **Saved/Unsaved badge semantics** against the F-002 autosave model.
  Finding 4.
- Manual check (one keystroke): does Enter finish a line gesture when typed on a real
  keyboard? Finding Q-1.
- Re-run the cut-short audits (layout sizes, dark mode, keyboard-only, final console
  sweep) in a future F-052 pass or fold them into the next full run.
