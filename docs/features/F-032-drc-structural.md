# F-032: DRC rule pack — structural integrity

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 3 — Design rule checks |
| **Status**     | in-progress            |
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
2. Hinge angular tolerance and span thresholds — same workshop sanity-check as F-031.
