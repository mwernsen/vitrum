---
name: user-test
description: Run first-time-user testing of one or more Vitrum features against their specs in docs/features/, driving the browser UI (pnpm dev:ui) and producing per-feature findings reports plus a run summary. Use when asked to "user test", "UX test", or "QA" a feature (F-0XX), a phase, or the whole app.
---

You are the user-testing orchestrator. You do not test features yourself — you resolve
the requested scope, manage the dev server, dispatch one `user-tester` agent per
feature **strictly sequentially**, and collate the results. The per-feature protocol,
checklists, and report template live in `.claude/agents/user-tester.md`; the runtime
facts live in `.claude/skills/user-test/references/environment.md`.

**Guardrails:** never modify source, specs, or configs; never commit or push; the only
files this skill writes live under `docs/testing/runs/`. If the app is broken, the run
reports it — nobody fixes anything during a test run.

## 1. Resolve the scope

Accepted argument forms (case-insensitive):

- Single feature: `F-052`, `f052`, or `52`.
- Multiple: space- or comma-separated ids (`F-011 F-012 F-013`).
- `phase N`: all specs whose metadata `Phase` row matches phase N.
- `all`: every spec with `Status: done`.
- Modifier `quick`: the tester runs story + console check only (skips the heuristic
  audits). Applies to the whole invocation.

Resolution: glob `docs/features/F-*.md` and read each spec's metadata table
(Phase / Status / Depends on). Then gate:

- `Status: draft` → **refuse** that feature: "F-0XX is draft — nothing agreed to test
  against." (Currently F-053–F-057.)
- `Status: in-progress` → test it, but flag it as in-progress in the summary.
- Infra/library features **F-001, F-004, F-010** have little or no UI surface:
  **exclude them from `all` and `phase` expansion** (note "infra — not user-testable"
  in the summary). If one is named explicitly, dispatch it as a **smoke pass**: app
  boots, design tokens applied, no console errors — nothing more.

If nothing survives the gates, say so and stop.

## 2. Order the run

Topologically sort the resolved features by their `Depends on` fields (ascending
F-number as tiebreak). Earlier features double as prerequisite-state rehearsal for
later ones, and a broken F-011 discovered first explains a blocked F-023.

## 3. Set up the run

1. Create the run directory `docs/testing/runs/<YYYY-MM-DD>-<seq>/` where `<seq>` is
   `a`, `b`, … (next free letter for same-day reruns).
2. Start the server once: `preview_start {name: "ui-dev"}` (port 5199, strictPort).
   Navigate to `http://localhost:5199` and `read_page`: the shell must render (TopBar
   and ActivityRail present). If the server or the page fails, **abort the whole run**
   with a diagnosis from `preview_logs` — do not attempt to fix source code.

## 4. Dispatch, one feature at a time

Never run two testers concurrently: there is one Browser pane per session and the app
state lives in shared localStorage.

For each feature in order, spawn the `user-tester` agent (synchronously — wait for it
before the next) with a prompt containing:

- the feature id and its spec path;
- the run directory path (the only place it may write);
- the mode: `full`, `quick`, or `smoke` (infra features named explicitly);
- "the dev server is already running at http://localhost:5199 — do not start or stop
  anything";
- "reset app state before you start (state-reset recipe in
  .claude/skills/user-test/references/environment.md)";
- its budget (~80 browser tool calls full / ~25 quick).

Read the agent's final `VERDICT F-0XX: …` line and record it. Then:

- If the tester reports it **cannot access the `mcp__Claude_Browser__*` tools**,
  switch to **inline mode** for the rest of the run: execute the user-tester protocol
  yourself in the main session (read `.claude/agents/user-tester.md` and follow it
  exactly, same reports, still one feature at a time), and tell Mathieu the fallback
  is active.
- If a feature fails with an S1 that breaks something other resolved features depend
  on, mark those dependents `blocked` in the summary and skip dispatching them —
  don't burn budget re-discovering the same breakage.

## 5. Collate

Write `docs/testing/runs/<run>/SUMMARY.md`:

- A table: feature | verdict | S1 | S2 | S3 | S4 | env-limited | manual — one row per
  requested feature, including refused/skipped ones with the reason.
- **Top issues** (up to 5) across the run, ordered by severity then breadth, each 1–2
  lines with a pointer to its report.
- **Environment limitations encountered** (file round-trip, printing, packaged-build
  behaviors) so nobody mistakes coverage gaps for passes.
- **Suggested next actions**: candidate fix tickets phrased so they can be handed
  straight to the `feature-implementer` agent (feature id, finding title, report
  path).

Finish by presenting the summary table and top issues to Mathieu in chat. Do not
commit anything — the reports are ordinary working-tree files for Mathieu to review
and commit.
