# F-042: Cutting list & bill of materials

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 4 — Production outputs |
| **Status**     | draft                  |
| **Depends on** | F-021, F-023, F-040    |
| **Complexity** | M                      |

## Summary

The workshop paperwork, generated and always in sync (the EDA BOM analogy): a cutting
list grouping pieces per glass, and a bill of materials totalling glass areas, came/foil
lengths, reinforcement, and consumables — on screen and as PDF/CSV.

## Scope

- **Cutting list**: per glass (code, name, swatch): piece numbers, count, each piece's
  bbox dimensions and area (of the _cut contour_, not drawn shape), sortable by
  number or size (Diafane parity), per-glass subtotal area with a configurable waste
  factor (default +30%) → "buy this much".
- **BOM**: glass line items (area, sheet suggestion if sheet sizes known from F-022,
  price if known); came per profile type (total length from segment lengths, +
  waste %) or foil (total seam length → number of rolls); reinforcement bars (F-032);
  solder estimate for foil (rule-of-thumb per seam length, documented); panel weight
  (from F-032's calc).
- On-screen panel (a "Manufacturing" sidebar tab) with live updates; export as PDF
  (via F-041's document pipeline) and CSV.
- Every quantity traceable: clicking a line item highlights the contributing
  pieces/segments on canvas.

### Non-goals

- Pricing/quoting with labor and margins (F-056 builds on this). Nesting-based exact
  sheet counts (F-057 replaces the waste-factor heuristic).

## Functional requirements

- FR-1: Totals match hand-computed values for a reference panel in unit tests
  (glass areas, came lengths incl. shared-edge accounting — each interior lead line
  counted once, not per adjacent piece).
- FR-2: Lists regenerate on any relevant edit; no stale data reachable.
- FR-3: CSV imports cleanly into a spreadsheet (proper quoting, units in headers).
- FR-4: PDF cutting list is bench-legible: one glass per section, swatch color
  printed, piece dims in the project's display units.
- FR-5: Waste factors configurable per material category and persisted.

## Open questions

1. Foil/solder estimation rules of thumb — Mathieu to confirm the factors used.
