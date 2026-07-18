# F-031: DRC rule pack — cuttability

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 3 — Design rule checks |
| **Status**     | draft                  |
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
2. Should `concave-notch` offer a quick-fix suggestion ("split piece here")? Backlog
   unless the F-030 quick-fix API landed.
