# F-021: Technique model — lead came & copper foil

|                |                          |
| -------------- | ------------------------ |
| **Phase**      | 2 — Stained glass domain |
| **Status**     | draft                    |
| **Depends on** | F-020                    |
| **Complexity** | L                        |

## Summary

The physical construction model: is this panel leaded (came) or copper-foiled
(Tiffany), and what does that imply for how lines render and — critically — where the
glass actually gets cut. Converts the abstract lead-line network + pieces into
technique-aware **cut contours**. This is Vitrum's equivalent of KiCad's design
rules + fabrication parameters layer.

## Domain background (for the implementing agent)

- **Lead came**: H-profile lead strips hold neighboring pieces; the strip has a
  _heart_ (core web, typically ~1.5–2 mm wide) that sits between the pieces. Glass is
  cut smaller than the drawn line: each piece's cut contour is inset by half the heart
  width (plus an optional cutting tolerance). Perimeter uses U- or H-profile came.
  Came widths commonly 4–12 mm (the _flange_ width — visual), hearts ~1.2–2 mm.
- **Copper foil**: each piece is wrapped in adhesive copper foil and soldered to its
  neighbors; pieces nearly touch. Inset is tiny: half the piece gap (~0.4–0.8 mm
  drawn-line allowance) rather than half a heart. Solder bead finish can be silver,
  copper, or black patina (rendering concern). Finer detail and smaller pieces are
  feasible than with lead — DRC thresholds differ per technique (F-031 consumes this).

## Scope

- `TechniqueSettings` on the project: `kind: 'lead' | 'foil'` plus per-kind parameters:
  - lead: default came profile (H/U), flange width, heart width, cutting tolerance;
    per-segment override of came profile/width (heavier perimeter came is standard).
  - foil: foil width, piece gap, solder finish.
- **Cut contour computation**: for each piece, offset its boundary inward by the
  technique-determined allowance (per-edge, since per-segment came overrides mean
  different edges of one piece can inset differently). Uses F-010's offset; results
  cached and recomputed with piece detection.
- Rendering update: lead lines render at true came flange width (zoom-proportional),
  foil designs render with thin solder-colored lines; border came renders distinctly.
- Inspector: technique panel (project level) + per-segment came override UI.
- Switching technique on an existing project recomputes everything and is undoable.

### Non-goals

- DRC rules that _use_ these thresholds (F-031/F-032). Realistic solder/came 3D-ish
  rendering (F-053). Reinforcement bars (F-032 decides if they become entities).

## Functional requirements

- FR-1: For a leaded piece with heart 1.6 mm and tolerance 0.2 mm, every cut-contour
  edge lies exactly 1.0 mm inside the drawn boundary (0.8 + 0.2), verified numerically.
- FR-2: Per-segment came override affects only the cut contours of the two adjacent
  pieces, on the shared edge only.
- FR-3: Cut contours are closed, non-self-intersecting curves; degenerate results
  (piece too small to inset) are flagged as data for DRC, not silently dropped.
- FR-4: Technique switch lead⇄foil preserves all geometry and glass assignments and
  is one undo step.
- FR-5: Sensible defaults shipped: lead H 5 mm flange / 1.5 mm heart; foil 5.6 mm
  (7/32") foil / 0.8 mm gap. Units UI respects mm/inch setting.

## Technical guidance

- Per-edge offsetting of a closed contour with different distances per edge is a
  miter/parallel-edge construction, not a uniform offset — implement in F-010 terms
  as offset-each-span + re-intersect adjacent spans. Sharp concave corners will
  produce the interesting cases; lean on the F-010 visual debug page.
- Keep `TechniqueSettings` serialization stable — F-042/F-043 export it, and the
  file format migration hook (F-002) covers future parameters.

## Acceptance criteria

- Numeric offset tests (FR-1, FR-2) plus closed/simple-contour validation over the
  stress scenes.
- Manual: one panel toggled lead⇄foil shows visibly different line weights and its
  cut contours (dev overlay) shift accordingly; a heavy perimeter came override
  shrinks only border-adjacent pieces.

## Open questions

1. Should came profiles be a small editable library (name, flange, heart — like
   KiCad footprint libs) rather than raw numbers? Recommendation: yes, seed with
   common Regalead/DHD sizes; confirm.
2. Default units for came sizes in inch mode (foil is sold in fractional inches,
   came in mm even in the US) — display both?
