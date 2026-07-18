# F-057: Sheet nesting & yield optimization

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-042                                |
| **Complexity** | XL                                   |

## Summary

Lay out each glass's cut pieces onto real sheet sizes to minimize waste — the
manufacturing-optimization capstone (only Glass Eye's top Enterprise edition has
this). Replaces F-042's waste-factor heuristic with computed sheet counts and gives
a printable nesting layout per sheet.

## Scope

- Per glass: choose sheet size(s) (from F-022 catalog data or manual), inter-piece
  spacing (cut allowance), grain/streak direction constraint per piece (streaky glass
  is directional — pieces can lock rotation to 0/180°), allowed rotations otherwise.
- Nesting engine: 2D irregular-shape nesting (no-fit-polygon based heuristic — e.g.
  SVGnest-style genetic/greedy approach) running in a worker with progress and
  cancel; good-enough beats optimal (document the approach).
- Result view: sheets rendered with placed, numbered pieces; utilization % per sheet;
  total sheets per glass feeding back into BOM (F-042) and costs (F-056).
- Output: nesting layout as printable PDF (1:1 tiled via F-041 or scaled overview)
  and SVG/DXF per sheet (F-043) for machine cutting.
- Manual adjustment: drag pieces between/within sheets after auto-nest, with overlap
  prevention.

### Non-goals

- Guillotine-cut constraints (glass score-and-break sequencing across a shared sheet
  — real but hard; consider at expansion). Multi-project batch nesting.

## Functional requirements (sketch — refine at expansion)

- FR-1: Nesting respects spacing, rotation and grain constraints (validated
  programmatically on results).
- FR-2: Utilization on the reference panel beats naive bbox packing by a measured
  margin; runs < 30 s.
- FR-3: Nest results are reproducible from a stored seed (nesting is stochastic;
  the seed persists with the result).

## Open questions

1. Should grain direction become a per-assignment property back in F-023's data
   model now (cheap) rather than retrofitting here? Recommendation: add the field
   in F-023, unused until F-057. Confirm.
