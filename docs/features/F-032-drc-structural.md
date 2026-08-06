# F-032: DRC rule pack — structural integrity

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 3 — Design rule checks |
| **Status**     | done                   |
| **Depends on** | F-030, F-023           |
| **Complexity** | L                      |

## Summary

Rules about whether the _assembled panel_ will survive building, transport, and years
of hanging: hinge lines, weak joints, panel size/weight limits, and reinforcement.
This is knowledge usually learned by having a panel fold in half; Vitrum checks it
up front. Completes milestone M3 ("it can be built").

## Domain background (for the implementing agent)

- **Hinge lines**: a lead line (or chain of nearly-collinear lines) running
  uninterrupted from edge to edge creates a fold axis — the panel flexes and creases
  there. Classic beginner killer. Staggering lines (like brickwork) avoids it.
- **Weak joints**: many lines meeting at one point makes a bulky, weak solder joint
  and a stress concentrator (4+ way joints are discouraged; offset the crossings).
- **Size/weight**: leaded panels beyond roughly 0.5–0.75 m² or with long unsupported
  spans need **reinforcement bars** (rebar/saddle bars) tied to the lead lines, or
  zinc/steel-cored perimeter came. Glass weight ≈ area × thickness × 2.5 g/cm³ plus
  lead; hanging hardware must match.
- **Border integrity**: pieces meeting the panel edge with tiny edge contact,
  or borders without adequate perimeter came, cause edge failures.

## Scope — rules

- `hinge-line`: detect edge-to-edge chains of segments that are collinear within an
  angular tolerance (default 12°) and span > threshold fraction of the panel
  dimension (default 85%). Warning; error if perfectly straight through. Highlight
  the whole chain. (Foil panels are stiffer once soldered — relax thresholds for foil.)
- `crowded-joint`: node where ≥ N lead ends meet (default N=5 warning, 6 error) or
  two joints closer than the came width allows.
- `panel-needs-reinforcement`: panel area or max unsupported span beyond thresholds
  (defaults: warn > 0.5 m² leaded / > 0.75 m² foiled, or span > 600 mm) without
  reinforcement present. Requires a minimal **reinforcement bar entity** (a straight
  bar drawn across the panel; rendered distinctly; excluded from piece detection) —
  added by this feature.
- `panel-weight`: computed weight (glass thicknesses from F-022 + lead estimate from
  F-021 line lengths) reported as an info diagnostic always; warning above a
  configurable hanging-weight threshold.
- `tiny-edge-contact`: piece meets panel border along a contact shorter than
  threshold (default 10 mm) — hard to cement/secure. Warning.

### Non-goals

- Real FEM/deflection simulation (fun, but pure backlog).
- Wind-load / building-code checks for architectural installation.

## Functional requirements

- FR-1: Hinge detection finds chains across _multiple_ segments and honest curves
  (nearly-straight bézier counts), with golden scenes for classic layouts (a
  Mondrian-style grid must flag; a staggered brick layout must not).
- FR-2: Reinforcement bar entity: drawable, editable, serialized, rendered, excluded
  from pieces/cut outputs, and consumed by `panel-needs-reinforcement`.
- FR-3: Weight calculation accurate within 10% for a reference panel hand-computed
  in the test.
- FR-4: All thresholds technique-aware and configurable, as in F-031.
- FR-5: Explanations teach the failure mode ("This straight run from edge to edge is
  a hinge: the panel will flex and crease here over time. Stagger the joints or add
  a reinforcement bar.").

## Acceptance criteria

- Golden suite incl. the Mondrian/brick pair; weight test; manual review on the
  reference panel plus a deliberately oversized design that demands rebar, then place
  a bar and watch the violation clear.

## Open questions

1. Reinforcement bar as document entity (proposed) vs annotation-only — entity chosen
   because F-042 (BOM) and F-041 (print) want it; confirm.
   **Resolved (Mathieu, 2026-07-20): document entity**, as proposed. Shipped as a serialized
   `ReinforcementBar` on `Project.reinforcements` (schema v6→v7), excluded from piece detection by
   construction (it is not a `segment`).
2. Hinge angular tolerance and span thresholds — same workshop sanity-check as F-031.
   **Resolved (Mathieu, 2026-07-20): ship the specced defaults** as configurable per-technique
   `ThresholdSpec` data (12°/85% lead, 8°/92% foil, and the rest as specced), editable per project
   like F-031's — retunable without a code change.

## Implementation notes

Delivered on branch `f-032-drc-structural` (2026-07-20). Both open questions and six additional
seam decisions (A–F below) were approved by Mathieu before coding.

**What shipped**

- **Reinforcement bar entity (`@vitrum/model`)** — `ReinforcementBar { id, a, b, widthMm, material }`
  on `Project.reinforcements`, a separate list from `segments` so bars never reach piece detection,
  DRC topology or cut outputs (FR-2 "excluded from pieces/cut outputs" holds by construction —
  `outputSegments` only ever sees `segments`). Commands `addReinforcement` / `updateReinforcement`
  (mergeable, so an endpoint drag is one undo entry) / `removeReinforcement`, all reversible. Schema
  **v6 → v7** migration (`migrateV6ToV7`) adds an empty list to older files.
- **Structural rule pack (`packages/drc/src/rules/structural.ts`)**, five rules registered after the
  cuttability pack, each a pure `Rule` (no engine change): `hinge-line`, `crowded-joint`,
  `panel-needs-reinforcement`, `panel-weight`, `tiny-edge-contact`. All thresholds are `ThresholdSpec`
  data (per-technique where the spec differs), consumed via the shared `resolveThreshold`, so they
  switch with technique and take per-project overrides (FR-4). Two rules self-grade via the F-031
  `RawViolation.severity` seam (hinge → error when perfectly straight; crowded → error at ≥ 6 ends).
- **Weight model (`rules/weight.ts`)** — `panelWeight(input)`: glass computed exactly
  (area × thickness × 2.5 g/cm³, thickness from effective glass, 3 mm fallback) + a documented coarse
  lead estimate (came cross-section `flange × heart` × 11.34 g/cm³ × length; foil a flat
  solder+foil linear mass). FR-3 verified against a hand-computed 200 mm/4 mm reference (≈ 468 g).
- **`DrcInput.effectiveGlass`** (seam A) — an additive, optional `contentId → glassId` map so the
  weight rule reads glass thickness; inheritance is resolved by the caller (mirrors `assignedKeys`),
  keeping the engine a pure function of its input. No `Rule`-interface change.
- **Reinforcement tool + rendering (`@vitrum/ui`)** — a `ReinforcementController` (place with two
  clicks, click-to-select, endpoint-drag, Delete) driven from a floating-`Toolbar` entry, `drawReinforcements`
  on the canvas content layer (distinct metallic bar), an Inspector panel (length, width, material,
  delete), and the DRC input now carries `effectiveGlass`. `panel-weight`'s always-on info gets **no
  canvas marker** until it escalates to a warning (seam E), filtered in `DrcController.markers`.

**Decisions (A–F, as approved)**

- **A** — additive `DrcInput.effectiveGlass`, caller-resolved inheritance, 3 mm fallback.
- **B** — cross-section × lead-density lead-mass model with a foil solder constant; glass dominates,
  so the total is within FR-3's 10 %.
- **C** — max unsupported span = panel bbox max dimension; a bar clears the violation only if it
  spans ≥ 80 % of that offending dimension (`barSpansAxis`).
- **D** — foil relaxes the hinge thresholds to 8° / 92 % vs lead's 12° / 85 %.
- **E** — `panel-weight` info renders as a Rules-panel row only (no canvas marker) until it warns.
- **F** — the reinforcement tool is a dedicated UI controller with a floating-`Toolbar` entry.

**Deviations / decisions**

- **Reinforcement tool is a UI controller, not an F-011 `ToolDef`** (contra seam F's literal
  wording). The `ToolDef` framework emits `SegmentDraft[]` that flow through the segment-commit path;
  a reinforcement bar is not a segment and must not. So it follows the F-023 paint/select precedent —
  a dedicated interactive controller — while honouring the intent (a toolbar-activated tool with pure
  geometry). Recorded here as the one deviation.
- **`hinge-line` uses the span-fraction alone**, not an additional "both ends touch the border"
  test — the two conflict (an 85 %-of-panel run does not reach both edges), and a run covering ≥ the
  threshold fraction of the panel dimension _is_ effectively edge to edge. The "must not flag" golden
  scene is a **staggered** layout (dividers jogged at mid-span) with no full-width collinear chain,
  demonstrating the good-practice lesson; a literal running-bond brick has continuous bed joints that
  would (correctly) flag, so the fixture stages the staggering the rule rewards.
- **`crowded-joint` implements the degree-based check** (≥ N came ends at a node); the "two joints
  closer than the came width" sub-clause is a documented follow-up (the F-030 near-miss rule already
  covers sub-tolerance coincidence).
- **`panel-needs-reinforcement` emits one violation** covering area and/or span (message names the
  reason), anchored at the panel centre with identity `['panel']` so it is a single waivable item.

**Testing**

- `packages/model`: `reinforcementCommands.test.ts` (add/update/merge-drag/remove + undo) and the
  v6→v7 migration test.
- `packages/drc`: `structural.test.ts` — the Mondrian/brick hinge pair (FR-1), per-technique + a
  per-project threshold override, crowded-joint warn/error/silent, the reinforcement area+span flow
  incl. "a bar that does not span does not clear" (FR-2), the hand-computed weight reference (FR-3)
  and info→warning grading, and tiny-edge-contact trigger/silent. Plus an on-disk **golden `.vitrum`
  fixture suite** (`src/fixtures/struct-*`) loaded through the persistence path, proving the bar
  round-trips and clears the rule after a cold reload. The existing topology-suite exact-count tests
  were scoped to `TOPOLOGY_RULES` (the always-on `panel-weight` info and the clean scene's lone
  full-span splitter are structural concerns) — matching F-031's per-pack scoping.
- `packages/ui`: `reinforcement.svelte.test.ts` (place / cancel / select / delete / coalesced
  endpoint drag / width+material edit / inert-when-off); `RulesPanel.test.ts` adjusted for the extra
  10 mm default.
- E2E: `apps/desktop/e2e/structural.spec.ts` — draw an oversized panel, run checks, see "Needs
  reinforcement", place a bar spanning the panel, re-run, watch it clear.
- All gates green from the repo root: `pnpm lint`, `pnpm format:check`, `pnpm check`,
  `pnpm test` (633), `pnpm test:e2e` (18).

**Handed to Mathieu (manual, per the acceptance criteria)**

- **Gallery / physical review**: the deliberately-oversized design that demands rebar and the manual
  "place a bar, watch the violation clear" pass in the real app (the E2E automates the logic; the
  visual read of the metallic bar and the teaching messages is a human check). The hinge messages,
  weight readout wording, and bar rendering want a design-system eye.
- **Threshold sanity-check in the workshop** — defaults shipped as specced and are per-project
  editable, so they can be retuned without a code change.

**Follow-ups (out of scope)**

- `crowded-joint` proximity sub-clause (two real joints within a came width); snapping the
  reinforcement tool to nodes/lead lines ("tied to the lead lines"); a BOM/print consumer of bars
  (F-041/F-042); curve-aware hinge tracing beyond near-straight segments.
- Net-new UI to back-port to the design projects: the **reinforcement toolbar tool**, its **canvas
  bar rendering**, and the **Inspector bar panel** (added to the F-030/F-023 back-port list).

_Cockpit v2 (2026-07-30):_ the reinforcement tool moved from the floating `Toolbar` into the **Draw** dock section's tool grid. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.

_Hinge reporting (2026-07-31):_ the rule tests the _span_ of a near-straight run (≥ 85 % of the
panel dimension along its dominant axis), but its explanation claimed the run "reaches from one edge
of the panel to the other" — which a run tripping the span test need not do. Reported from a real
panel: a 3-line run covering 88 % of the height, whose upper end sits 38 mm inside the panel, read as
an edge-to-edge fold axis the user could not find. Detection is unchanged (the thresholds are tuned
and the Mondrian/brick goldens still discriminate); the explanation now describes what is measured,
and the message reports how many lines were merged into the run, the span as a share of the
dimension it is measured against, and whether the run actually reaches the edges or how far it stops
short. Whether the check itself should _require_ edge contact is an open question for Mathieu.
