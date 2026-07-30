# F-031: DRC rule pack — cuttability

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 3 — Design rule checks |
| **Status**     | done                   |
| **Depends on** | F-030                  |
| **Complexity** | L                      |

## Summary

Rules that answer: _can each piece physically be cut from a sheet of glass?_ Glass is
cut by score-and-break, which forbids certain shapes outright and makes others
fragile. Today this is expert judgment; Vitrum encodes it. Thresholds are
technique-aware (copper foil permits smaller/finer pieces than lead) and configurable
per project, with defaults from craft practice.

## Domain background (for the implementing agent)

Score-and-break implications:

- A score must run edge-to-edge; you cannot break out a **deep concave notch** or a
  tight **inside curve** — the break runs off the intended line. Shallow concave
  curves are fine; the limit is curvature radius and depth of concavity.
- **Sharp interior points of a piece** (a V cutting _into_ the glass) concentrate
  stress → the piece cracks during breaking or later. (Convex sharp points are merely
  fragile; concave ones are near-impossible.)
- **Slivers** (long, thin pieces) snap during cutting/handling; minimum width matters.
- Very **small pieces** can't be held/ground safely; minimums differ by technique.

## Scope — rules (all operate on **cut contours** from F-021, not drawn lines)

- `min-piece-size`: piece min dimension below threshold (defaults: lead 10 mm,
  foil 6 mm). Severity: warning; error below half.
- `sliver`: piece whose inscribed width is below threshold while its length is > 4×
  that width (defaults: lead 8 mm, foil 5 mm). Warning.
- `concave-curvature`: any concave boundary run with curvature radius < threshold
  (default 15 mm; grindable exceptions exist, hence warning; error < 6 mm).
- `concave-notch` / `impossible-inside-cut`: concave corner (interior reflex vertex on
  the cut contour) sharper than threshold angle, or a notch deeper than it is wide.
  Error — this is the flagship rule; the `explain` text must teach _why_.
- `sharp-point`: convex vertex with interior angle < threshold (default 30°) —
  fragile tip. Info/warning.
- `degenerate-cut-contour`: piece too small to inset by the technique allowance at all
  (data produced by F-021 FR-3). Error.
- Per-rule thresholds editable in the F-030 rule-settings dialog, with separate
  defaults per technique; all thresholds documented inline with rationale.

### Non-goals

- Structural/whole-panel rules (F-032). Ring-saw/waterjet "advanced tooling" profiles
  that relax rules — backlog (add a "cutting capability" project setting later).

## Functional requirements

- FR-1: Each rule implemented against F-030's `Rule` interface; no engine changes.
- FR-2: Golden-file scenes per rule: at least one triggering and one just-inside-
  threshold non-triggering case each (curated `.vitrum` fixtures with hand-verified
  expected output).
- FR-3: Curvature and angle measurements computed on true curves (F-010
  curvature-at-t), not on flattened polylines, to avoid false positives.
- FR-4: Thresholds switch with technique automatically; overrides persist.
- FR-5: Full pack on the 200-piece reference document < 300 ms in the worker.

## Technical guidance

- Inscribed-width for sliver detection: approximate via distance transform on a
  rasterized piece or medial-axis sampling — exactness isn't needed, stability is.
  Document the chosen approximation and its failure modes.
- Get the _messages_ right: each violation should read like a teacher ("This inside
  curve is tighter than a glass cutter can break — radius 4 mm, minimum ~15 mm.
  Soften the curve or split the piece with a lead line.").

## Acceptance criteria

- Golden suite green; manual review of a deliberately nasty test panel (drawn with
  deep notches, slivers, tight hooks) flags all of them with sensible messages, and
  a well-drawn traditional panel produces zero errors.

## Open questions

1. Default thresholds above are my synthesis of craft guidance — Mathieu should
   sanity-check against his own workshop experience before they ship as defaults.
   **Resolved (Mathieu, 2026-07-19): ship as specced.** The values above are the shipping
   defaults; every one is editable per project (per technique), so they can be retuned without
   a code change.
2. Should `concave-notch` offer a quick-fix suggestion ("split piece here")? Backlog
   unless the F-030 quick-fix API landed.
   **Resolved (Mathieu, 2026-07-19): defer.** The F-030 quick-fix seam did land, but a correct
   "split here" needs a where-to-split geometry decision that is a feature in itself. The rule
   ships with a strong teaching `explain` and no quick-fix; revisit as its own ticket.

## Implementation notes

Delivered on branch `f-031-drc-cuttability` (2026-07-19).

**What shipped**

- **Cuttability rule pack** (`packages/drc/src/rules/cuttability.ts`), all six rules registered after
  the topology pack: `min-piece-size`, `sliver`, `concave-curvature`, `concave-notch`
  (titled "Impossible inside cut" — the flagship), `sharp-point`, `degenerate-cut-contour`. Size and
  degeneracy read F-021's cut contours; curvature and corner angles read the pieces' **true boundary
  curves** via a new `rules/pieceGeometry.ts` (`cornersOf`, `concaveCurvatureHits` over
  `curvatureAt`/`tangentAt`), so a gentle curve never reads as polyline kinks (FR-3).
- **Per-technique, tunable thresholds** — each rule declares its limits as `ThresholdSpec` data
  (key, label, unit, rationale, `defaultFor(kind)`). Defaults switch with technique automatically;
  a project override pins a value that persists across technique switches (FR-4). `resolveThreshold`
  is the single resolver.
- **Inscribed-width proxy for slivers** — new `inscribedCircle` in `@vitrum/geometry` (Mapbox
  `polylabel`: deterministic quadtree, no rasterisation). Twice the radius is the inscribed width;
  length is estimated as `area / width` (documented, stable). Failure mode noted in the source.
- **Persistence** — `DrcRuleOverride.thresholds?: Record<string, number>` added to the model. It is
  an additive optional field, so v6 files without it load unchanged — **no schema bump**. Carried by
  the existing `setDrcRuleOverride` command (undoable).
- **UI** — the Rules-panel settings section now renders a number input per threshold (placeholder =
  the technique default, value = the override), persisting edits through `setDrcRuleOverride`.

**Deviations / decisions**

- **Per-violation severity (minimal engine change, contra FR-1's literal "no engine changes").** The
  spec's own rules grade themselves — `min-piece-size` is a warning but an error below half; likewise
  `concave-curvature` below its hard radius — which the F-030 runner (one severity per rule) cannot
  express. Added an optional `RawViolation.severity` consumed in `run.ts` (`override ?? raw ?? default`,
  so an explicit project override still wins). Purely additive; the topology pack and the `Rule`
  interface are untouched. This is the only engine change and it is what makes the spec's rule
  definitions implementable.
- **`degenerate-cut-contour` fires only on a truly collapsed contour** (empty ring or area ≤ 1 mm²),
  not on F-021's raw `degenerate` flag — that flag is set whenever the offset self-intersects
  _anywhere_, including a lone sharp tip or tight bay that the sharp-point / concave rules already
  flag precisely. This matches the spec's "too small to inset **at all**" and removes double-reporting.
- **Geometric rules assess the true boundary, then subtract the edge allowance** for concave radius
  (the score follows the inset line, which tightens a concave curve). Corner rules cover the outer
  boundary; enclosed-hole internal cuts are a documented, rare backlog case.
- **`min-piece-size` and `sliver` intentionally overlap** — a sliver is by definition below the size
  floor, so both fire on a thin strip. Each is an independent lens; the golden sets record both.

**Testing**

- `packages/geometry`: `inscribedCircle` unit tests (square, thin rectangle, holes, triangle incircle).
- `packages/drc`: per-rule scene suite (`cuttability.test.ts`) with a triggering + a just-inside-
  threshold silent scene for every rule (FR-2), both graded severities, the per-technique switch and a
  per-project threshold override (FR-4), the acceptance pair (nasty panel flags every defect, a
  well-drawn traditional panel is silent), and a **golden `.vitrum` fixture suite** (`src/fixtures/cut-*`,
  loaded from disk with a drift guard). FR-5 benchmark: the pack runs on the ~200-piece grid well under
  300 ms. The topology golden suites are scoped to `TOPOLOGY_RULES` (each pack tests its own rules).
- `packages/model`: threshold-override persistence + undo test.
- `packages/ui`: `RulesPanel` component test edits a threshold and asserts the persisted override.
- No new E2E: F-031 rides F-030's checks → violations → waive flow (same panel, more entries); the new
  threshold-editing surface is covered by the component test. All gates green (`lint`, `format:check`,
  `check`, `test`).

**Handed to Mathieu / follow-ups**

- The Rules-panel threshold inputs are net-new UI built to the Vitrum Design System (tokens + `Select`/
  `Checkbox` idiom); fold them into the Portal/Design project's Rules panel when it is back-ported (the
  F-030 back-port note already covers that panel).
- `concave-notch` "split piece here" quick-fix deferred to its own ticket (open question 2).
- Enclosed-hole (internal-cut) cuttability and a ring-saw/waterjet "cutting capability" profile that
  relaxes the rules remain backlog, as scoped.

_Cockpit v2 (2026-07-30):_ the rule-settings sheet now opens from the **Check** section's gear. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.
