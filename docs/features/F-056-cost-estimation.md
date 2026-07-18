# F-056: Cost estimation & quoting

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-042                                |
| **Complexity** | M                                    |

## Summary

Turn the BOM into money: material costs from catalog prices, labor estimation from
design complexity, overhead/margin, and a client-ready quote PDF. Underserved by both
competitors — a real edge for professional users.

## Scope

- Pricing inputs: glass prices (F-022), came/foil/consumable prices (small editable
  price book, per project with global defaults), currency setting.
- **Labor model**: estimated hours from design metrics — piece count, total lead
  length, piece complexity (curve-heavy pieces cut slower), technique (foil is
  slower per piece) — with user-tunable rates and factors; show the formula, never
  a black box.
- Quote builder: line items from BOM + labor + overhead % + margin %; manual line
  add/edit; client fields; quote PDF (F-041 pipeline) with optional rendered
  panel image (F-053 snapshot if available, flat render otherwise).
- Sensitivity view: "this design costs €X; the 12 smallest pieces contribute €Y of
  labor" — ties back to canvas highlighting like F-042.

### Non-goals

- Invoicing, tax handling, CRM. Quote acceptance flows.

## Functional requirements (sketch — refine at expansion)

- FR-1: Deterministic: same document + price book → same quote totals (unit tests
  on a reference panel).
- FR-2: All factors editable and persisted; recompute is live.
- FR-3: Quote PDF is client-presentable (supervisor judgment) and excludes internal
  cost breakdown unless toggled.

## Open questions

1. Labor model coefficients need calibration against real workshop hours — Mathieu
   to supply or gather reference data points.
