# F-030: DRC framework & violations UI

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 3 — Design rule checks |
| **Status**     | done                   |
| **Depends on** | F-020, F-021           |
| **Complexity** | L                      |

## Summary

The rule-check engine and its UI, modeled directly on KiCad's ERC/DRC: an extensible
registry of rules that inspect the document and emit located, severity-graded,
explained violations; a violations panel; and canvas markers. No competitor has this —
it is Vitrum's core differentiator. This feature builds the engine plus the
**topology (ERC) rule pack**; cuttability and structural packs follow in F-031/F-032.

## KiCad → stained glass mapping (conceptual guide)

| KiCad                                | Vitrum                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| Schematic / netlist                  | Lead-line network / derived pieces                             |
| ERC (unconnected pins, etc.)         | Topology checks: dangling lines, near-miss joints, open border |
| DRC clearance/manufacturing rules    | Cuttability rules (F-031)                                      |
| Structural/assembly concerns         | Panel integrity rules (F-032)                                  |
| Violation markers + DRC dialog       | Canvas markers + violations panel                              |
| Severity config, per-item exclusions | Same                                                           |

## Scope

- `packages/drc`: `Rule` interface (`id`, `title`, `defaultSeverity`, `explain`,
  `check(doc, derived) → Violation[]`), a registry, and a runner that executes rules
  against the document + derived data (pieces, cut contours) off the main thread.
- `Violation`: rule id, severity (error/warning/info), message, anchor location
  (point or region), involved entity IDs (segments/pieces), and a human explanation
  of _why this matters in glass_ (the `explain` text — craft education is part of
  the product).
- **Live mode**: rules re-run debounced after edits (reusing F-020's incremental
  dirty info where possible); plus an explicit "Run checks" for full runs.
- **Violations panel**: grouped by rule, sortable by severity; click → zoom-to and
  flash the location; per-violation **exclusion** ("waive this one", persisted in the
  document with a note — KiCad-style); per-rule severity override and enable/disable
  in a rule-settings dialog, persisted per project.
- Canvas markers: severity-colored markers at anchors on the overlay layer; hover →
  tooltip with message.
- **Topology rule pack (ERC), shipped with this feature** — formalizes F-020's diagnostics:
  - `open-border`: border contour is not closed (error)
  - `dangling-line`: lead segment end with degree 1 (error)
  - `near-miss-joint`: endpoints within tolerance but not welded (error, shows distance)
  - `duplicate-segment` / `overlapping-segments` (warning)
  - `unassigned-glass`: piece without glass (warning; from F-023)
  - `orphan-region`: geometry outside the border (info)

### Non-goals

- Cuttability (F-031) and structural (F-032) packs.
- Blocking exports on violations (F-041/F-043 will _warn_ on errors; policy decided there).
- User-scriptable custom rules (KiCad got there eventually; backlog).

## Design

The Rules dock panel **is** designed — in the **Portal redesign** project
(`1ec655e3-ab21-4450-b3be-f2caaca64ea3`, turn-3 IA, the "Design rules" panel in the
cockpit's Rules dock section): a "Run checks" pill, a severity summary, severity-dotted
violation rows, a selected-violation state with a quick-fix in `--cobalt-50`, a per-row
"Waive…" affordance, a "n waived · View excluded" footer, and severity-coloured DRC markers
on the canvas. (The earlier "no design yet" note predated the Portal redesign.) Severity
colours map to leaf tokens — error `--ruby-600`, warning `--amber-600`, info `--cobalt-600`
— never the vitrail palette.

## Functional requirements

- FR-1: Rules run in a worker; a full run on the 200-piece reference document
  completes < 500 ms; live mode never blocks drawing.
- FR-2: Every violation carries a location that zoom-to-fits correctly, and involved
  entity IDs that highlight on hover.
- FR-3: Exclusions persist in the file, survive geometry edits when the involved
  entities still exist, and are listed in a reviewable "excluded" tab.
- FR-4: Severity overrides and rule toggles persist per project; defaults per rule.
- FR-5: All six topology rules detect their cases in synthetic broken documents and
  are silent on the clean reference document (golden-file test: scene → expected
  violation set).

## Technical guidance

- Design the `derived` input handed to rules deliberately (pieces, cut contours,
  node index, technique settings) so F-031/F-032 need no engine changes.
- Golden-file testing (curated scenes + expected violations) is the right harness;
  build the scene fixtures as `.vitrum` files checked into the repo.

## Acceptance criteria

- Golden-file suite for all topology rules; worker-based runner benchmarked.
- Manual: break the reference panel six ways, see correct markers, waive one with a
  note, fix another, watch live updates; reload → exclusions intact.

## Open questions

1. Should `near-miss-joint` offer a one-click "weld it" quick-fix? (Quick-fix actions
   on violations generally — powerful, but adds surface. Recommendation: yes, one
   quick-fix API in the engine, weld as its pilot.)
   **Resolved (Mathieu, 2026-07-19): yes** — the canonical Portal design already includes the
   "Weld it" button. Shipped as a single `QuickFix` data type + `quickFixCommand()` seam, with
   weld (reusing F-013's `mergeNodes`) as the pilot; F-031/F-032 fixes add a variant, not plumbing.

## Implementation notes

Delivered on branch `f-030-drc-framework` (2026-07-19).

**What shipped**

- New pure package **`packages/drc`** (`@vitrum/drc`, deps `core` + `model` + `geometry`; `ui`
  now depends on it): `Rule`/`Violation`/`DrcInput`/`RunResult` types, a rule registry, the pure
  `runChecks(input)` runner, an `exclusionKey` identity seam, and the `quickFixCommand` seam.
- **Topology (ERC) rule pack** — all six rules: `open-border`, `dangling-line`,
  `near-miss-joint` (with weld quick-fix), `duplicate-segment` (titled "Overlapping segments"),
  `unassigned-glass`, `orphan-region`. The three network-imperfection rules reuse F-020's
  diagnostics (near-miss additionally resolves the two nodes for the weld); the other three derive
  from the project + pieces + effective assignments.
- **Persistence**: `Project.drc = { exclusions, rules }` added to the model (schema v5→v6 migration
  - `setDrcExclusion` / `setDrcRuleOverride` commands). Exclusions key off rule id + stable entity
    ids, so waivers survive edits that keep those entities (FR-3); rule severity/enable overrides
    persist per project (FR-4).
- **UI (F-030 in the Portal cockpit)**: the `rules` dock section is now live
  (`shell/RulesPanel.svelte` + `drc/controller.svelte.ts`), the ReadinessStrip "Checks" pill and
  the activity-rail badge are DRC-driven, and the canvas draws severity-coloured violation markers
  (`drawViolations`, with a ring on the selected one; `viewport.centerOn` handles zoom-to, FR-2).
- **Worker runner (FR-1)**: `drc.worker.ts` + `WorkerDrcRunner` run checks off the main thread,
  debounced in live mode; explicit "Run checks" runs immediately.

**Deviations / decisions**

- The rule-settings "dialog" is an inline collapsible section in the Rules panel (gear toggle),
  not a modal — lighter and matches the dock idiom. Severity/enable per rule via `Select`/`Checkbox`.
- **Worker is a _classic_ (IIFE) worker, not `{ type: 'module' }`.** A module worker is blocked
  under `file://` in the packaged Electron renderer (it loaded fine on the `dev:ui` http server but
  silently never responded in the build). Vite bundles the classic worker self-contained, which
  loads under `file://`. The `DrcController` also falls back to a synchronous run if the worker ever
  errors, so checks never hang regardless of platform.
- `unassigned-glass` uses an `assignedKeys` list (content ids of pieces with _effective_ glass)
  passed into the engine, so it respects F-023 inheritance in-session while the pure engine stays a
  function of its input (golden path derives the keys from stored assignments).

**Testing**

- `packages/drc`: per-rule + runner unit tests, a **golden `.vitrum` fixture suite** (checked into
  `src/fixtures/`, one per scene incl. the clean reference — silent per FR-5), and an FR-1 benchmark
  (~200-piece grid, well under 500 ms).
- `packages/model`: v5→v6 migration test + DRC command tests.
- `packages/ui`: `DrcController` and `RulesPanel` component tests, ReadinessStrip checks-pill test.
- E2E: `apps/desktop/e2e/drc.spec.ts` drives draw → run checks → see violations + readiness → waive
  with a note → excluded tab. All gates green (`lint`, `format:check`, `check`, `test`, `test:e2e`).

**Handed to Mathieu / follow-ups**

- Net-new **Rules panel** was built in code to the Portal turn-3 design; back-port it into the
  Claude Design project when convenient (it currently lives only as the cockpit mock, not as a
  `components/`/`ui_kits` asset).
- The canvas violation markers are a manual/gallery check (pixels aren't asserted in E2E).
- Quick-fix currently has one variant (weld); F-031/F-032 will add more via the same seam.

_Cockpit v2 (2026-07-30):_ the `rules` section is now **Check**, restructured as a queue (a "Fix next" card plus severity filter chips), and the readiness strip became the top-bar `ReadinessMeter`. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.
