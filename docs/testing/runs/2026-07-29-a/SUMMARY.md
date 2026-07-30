# User test run 2026-07-29-a — summary (INCOMPLETE)

Requested scope: F-001 … F-013, skipping features that need no user testing.
**Status: run halted part-way by a tooling outage — see "Run interruption" below.**

## Verdicts

| Feature | Verdict | S1 | S2 | S3 | S4 | env-limited | manual |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-001 architecture & scaffolding | skipped — infra, no user surface | — | — | — | — | — | — |
| F-002 document model, persistence, undo/redo | pass-with-issues | 0 | 1 | 5 | 2 | 6 | 0 |
| F-003 canvas viewport | **not run** — tooling outage | — | — | — | — | — | — |
| F-004 design system | pass-with-issues (smoke) | 0 | 1 | 0 | 2 | 4 | 0 |
| F-010 geometry kernel | skipped — pure library, unit-tested, no UI | — | — | — | — | — | — |
| F-011 drawing tools | **not run** — tooling outage | — | — | — | — | — | — |
| F-012 snapping & guides | **not run** — tooling outage | — | — | — | — | — | — |
| F-013 selection, node editing, transforms | **not run** — tooling outage | — | — | — | — | — | — |

F-001 and F-010 were excluded as infra per the skill's gate (no UI surface; covered by
unit tests). F-004 was run as a smoke pass only: boot, tokens, chrome metrics, light/dark,
console/network.

## Top issues

1. **[S2] The bundled webfonts never load — the whole app renders in an OS fallback.**
   `--font-sans` asks for `"Onest"` but the `@fontsource-variable` packages declare
   `"Onest Variable"` (same for `"Geist Mono"` / `"Geist Mono Variable"`). All 10
   registered faces stay `unloaded`, zero woff2 files are fetched, and a width probe
   confirms `var(--font-sans)` falls through to generic `sans-serif`. FR-3's offline claim
   passes trivially because nothing is fetched. → [F-004.md](F-004.md)
2. **[S2] Dialogs neither take nor trap focus.** The Cmd+K palette is
   `aria-modal="true"` but `activeElement` stays `BODY` on open, and three Tabs land in the
   glass-library search box behind the dialog. It is the shared `Dialog` primitive, so this
   likely affects every dialog in the app. → [F-002.md](F-002.md)
3. **[S3] "Unsaved" never returns to "Saved".** `DocumentStore.#commit` marks the document
   dirty on undo too, so a document undone back to an empty, saved state still claims
   unsaved work — and will raise "Discard unsaved changes?" for nothing. The one indicator
   the user is asked to trust stops being trustworthy. → [F-002.md](F-002.md)
4. **[S3] The chrome shows a title that is not the document.** Header reads "Sample panel"
   while the document is `Untitled` and would save as `Untitled.vitrum`; no filename or
   path is ever displayed. Undercuts the "a file I own" half of F-002's user story.
   → [F-002.md](F-002.md)
5. **[S3] TopBar and Inspector clip at narrow widths with no overflow affordance.** At
   820×1000, zoom/import/export/avatar and the Inspector's right half sit beyond the
   viewport edge and the page does not scroll — the controls are simply unreachable.
   Shell-level (F-001/F-004). → [F-002.md](F-002.md)

Also open as questions rather than defects: the sidebar is 322px, not the 220px the spec
and studio kit document (looks like unrecorded evolution from later panel features); and
there is no dark theme at all — `prefers-color-scheme: dark` is honoured by no stylesheet.

## Environment limitations encountered

- **Open / import** (`Cmd+O`, SVG, reference images, glass-library JSON) — native
  `<input type=file>` picker, not automatable. Not triggered.
- **Save / save-as / all exports** — anchor downloads. The keystroke and its state effects
  were exercised; the produced `.vitrum` bytes cannot be inspected. The browser-host
  `StoragePort.saveFile` stub ignores the path and always writes `design.vitrum`, so the
  in-place-save semantics resolved in F-002's open question 2 are unobservable here.
- **Crash-recovery prompt and the unsaved-changes guard** — `window.confirm` plus
  `beforeunload`. Never triggered: per the environment dossier this wedges the Browser pane
  and can take the shared dev server down. Persistence was verified instead by decoding
  `vitrum:autosave`.
- **Native File/Edit menu wiring** — Electron main process only; the browser host has no menu.
- **F-004 design-gallery sign-off with Mathieu, the Playwright offline assertion, and the
  FR-4 CI-failure proof** — outside a browser run (the spec already lists the gallery
  sign-off as owed).
- **Physical checks** — 1:1 calibration against a printed square, sustained trackpad fps
  with the stress scene: `manual`, never attempted.

## Run interruption

After F-004 and F-002 completed, the safety classifier that gates subagent dispatch and
browser-tool use (`claude-sonnet-5[1m]`) went unavailable and stayed down through four
retries over ~12 minutes. That blocks both dispatching `user-tester` agents **and** the
skill's inline-mode fallback, since inline mode still needs the `mcp__Claude_Browser__*`
tools. F-003, F-011, F-012 and F-013 were therefore never exercised — their rows above are
absence of evidence, not passes.

The run is resumable: the `ui-dev` dev server is still up on port 5199, and the four
outstanding features can be dispatched into this same run directory once the classifier
recovers.

## Suggested next actions

Fix tickets, phrased for the `feature-implementer` agent:

1. **F-004 — "Bundled webfonts never load (font-family name mismatch)"** — `docs/testing/runs/2026-07-29-a/F-004.md`.
   Highest-value fix in the run: one-line token change, and it is currently making every
   screen render in a per-OS fallback rather than the designed typeface.
2. **F-004 — "Dialog primitive does not take or trap focus"** — filed in
   `docs/testing/runs/2026-07-29-a/F-002.md` but belongs to the shared `Dialog` primitive.
   Fixing it once fixes every dialog.
3. **F-002 — "Unsaved badge never returns to Saved after undo"** — `docs/testing/runs/2026-07-29-a/F-002.md`.
   `DocumentStore.#commit` should not set dirty when the resulting state equals the
   last-saved state.
4. **F-002 — "Document title is a hardcoded placeholder; no filename shown"** — `docs/testing/runs/2026-07-29-a/F-002.md`.
5. **F-001/F-004 — "TopBar and Inspector unreachable below ~1050px width"** — `docs/testing/runs/2026-07-29-a/F-002.md`.
6. **F-004 — "Canvas overlay colour assigned as raw hex in JS"** (`packages/ui/src/shell/Canvas.svelte:310`)
   — stylelint is CSS-only, so JS-assigned colours escape the FR-4 no-hex gate.

Retest debt:

- **F-002** — whether an Inspector numeric-field edit is a single undo entry went unjudged
  (the browser typing tool was unavailable for three attempts).
- **F-003, F-011, F-012, F-013** — never run; re-invoke the skill for these four.
