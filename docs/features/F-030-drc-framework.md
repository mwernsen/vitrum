# F-030: DRC framework & violations UI

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 3 — Design rule checks |
| **Status**     | draft                  |
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

The violations panel has **no design in `ui_kits/studio` yet** — per the F-004
workflow, design it in the Claude Design project with Mathieu before implementation
(candidates: `Tabs` for grouped rules, `Badge` for severity, `Tooltip` for canvas
markers). Severity colors map to the design system's semantic tokens
(error/warning/info), never the vitrail palette.

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
