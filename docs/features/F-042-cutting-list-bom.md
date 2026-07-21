# F-042: Cutting list & bill of materials

|                |                        |
| -------------- | ---------------------- |
| **Phase**      | 4 — Production outputs |
| **Status**     | done                   |
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

_None — all resolved._

## Resolved decisions

1. (2026-07-20, Mathieu) **Foil/solder estimation rules of thumb.** Documented defaults, all
   user-configurable and persisted per FR-5:
   - **Solder** for copper-foil seams: **20 g per metre** of seam length (beaded 60/40 solder on
     both faces). The factor is printed in the BOM output.
   - **Foil roll length** for the "number of rolls" calc: **33 m** (standard 36-yard roll).
   - **Came/foil linear waste factor**: **+10%** default.
   - **Glass waste factor**: **+30%** default (as stated in Scope).

## Implementation notes

_Delivered 2026-07-21 on branch `f-042-cutting-list-bom` (Status: done, pending the manual
gallery/bench checks listed below)._ Mathieu pre-resolved the one open question (foil/solder
factors, recorded under Resolved decisions) and confirmed all dependencies (F-021/F-023/F-040 +
the referenced F-022/F-032) are `done`, so their real APIs are used, nothing stubbed.

**What shipped**

- **Persisted estimation factors (`@vitrum/model`)** — new `BomSettings { glassWaste, leadWaste,
solderGramsPerMetre, foilRollLengthMm }` on `Project.bom` (schema **v8 → v9**, `migrateV8ToV9`
  seeds the resolved defaults on older files). One self-inverting command `updateBomSettings(patch)`
  — each factor edit is one undo entry and immediately re-derives the lists (FR-2/FR-5). Only tunable
  intent is stored; the lists are always derived.
- **Pure computation (`@vitrum/core/bom`)** — `computeBom(input): BomReport`, model-/DOM-free, mirrors
  the model types it needs (glass, reinforcement) structurally exactly as `technique`/`pieces` do, so
  it is a deterministic function of geometry-derived inputs (FR-1). Produces the **cutting list**
  (per-glass sections; each piece's **cut-contour** bbox dims + area, holes subtracted, falling back
  to the piece when a contour is degenerate; per-glass net area + waste-inflated "buy this much") and
  the **BOM** (glass line items with largest-sheet suggestion + price; came grouped per resolved
  profile — border overrides split into their own item; foil seam length → rolls + documented solder
  estimate; reinforcement grouped by material; panel weight passed through). Every line item carries
  the contributing piece display ids / segment ids for traceability. **Shared-edge accounting (FR-1)**
  is inherent: came/foil length sums over the network segments once, never per piece perimeter.
- **Area formatting (`@vitrum/core/units.ts`)** — extended (never inlined) with `formatArea`
  (cm²/in²), `formatAreaLarge` (m²/ft²) and `areaToM2`, so cutting list, panel and CSV agree on units.
- **PDF + CSV (`@vitrum/paper`)** — `buildBomDocument(report, options)` composes a paginated `PdfDoc`
  (cutting list, one glass per section with the printed swatch colour and dims in the display unit —
  FR-4; then the BOM with the documented factors) reusing the F-041 `PageBuilder`/pdf-lib backend (no
  new PDF code). `bomToCsv(report, unit)` emits RFC-4180-quoted CSV with units named in the headers
  and plain-number values (FR-3). A tiny `Flow` paginator page-breaks long lists.
- **Export host seam** — `ExportPort` gained `saveText` (parallel to `savePdf`): desktop writes via a
  native dialog (`export:saveText` IPC, `VITRUM_EXPORT_TEXT_PATH` override for E2E), `browserHost`
  downloads, `fakeHost` records.
- **UI (`@vitrum/ui`)** — `BomController` (runes: sort choice, traceability highlight sets, PDF/CSV
  export runners). `BomPanel.svelte` renders the cutting list (sortable by number/size), the BOM, the
  collapsible estimation settings (FR-5) and PDF/CSV export, tokens-only from `components/core`
  primitives. The **Make dock** (F-040's `NumberingPanel`) now also hosts `BomPanel` below numbering;
  the F-042 "Cutting list"/"Bill of materials" placeholders in `NumberingPanel`'s Outputs are removed
  (live now), leaving the F-043 export placeholder. `AppShell` derives the live `BomReport` via
  `computeBom` from the same snapshotted data everything else reads (so it regenerates on any edit,
  FR-2), taking the panel weight from **F-032's `panelWeight`** (injected, so `core` stays a leaf —
  no `core → drc` edge). Hovering a line item highlights its pieces/segments on the canvas via a new
  `drawBomHighlight` overlay (traceability).

**Deviations / decisions (implementer calls, spec silent)**

- **Panel weight is injected, not recomputed.** `computeBom` takes the weight as an input value; the
  shell computes it with F-032's `panelWeight(drcInput)`. This reuses F-032's estimator verbatim
  while keeping the pure BOM calc a leaf (`core` cannot depend on `drc`). FR-1's hand-computed list is
  glass areas + came lengths, which the calc owns; weight has its own F-032 FR-3 test.
- **Foil seam length counts each network segment once** (same rule as came), per the spec's "total
  seam length → number of rolls" wording and FR-1's counted-once principle. Copper foil physically
  wraps both faces of an interior seam, so real tape use is roughly 2× interior + 1× border; the +10%
  waste factor absorbs some overage. A both-faces multiplier is a documented follow-up.
- **Unassigned pieces get a "?" cutting-list section** (sorted last), mirroring F-040's sentinel, so
  nothing is dropped before glass is assigned.
- **Cut-contour degeneracy falls back to the piece** bbox/area and flags the row, never dropped (per
  F-021 FR-3 philosophy).
- **Net-new UI to back-port** to the Claude Design project: the **`BomPanel`** (cutting list + BOM +
  estimation settings + export) inside the Make dock, and the **canvas BOM highlight** overlay.

**Tests**

- `@vitrum/model`: `bomCommands.test.ts` (defaults, single-field/multi-field patch + undo/redo,
  serialize round-trip); `serialize.test.ts` v8→v9 migration + the synthetic chain extended to v9.
- `@vitrum/core`: `bom/bom.test.ts` (FR-1 hand-computed reference — per-glass grouping + cut-contour
  area/dims + glass waste; degenerate fallback; unassigned bucket; sheet suggestion + price; **came
  shared-edge counting** incl. per-profile split for heavy perimeter came; foil rolls + solder;
  reinforcement grouping; weight passthrough); `units.test.ts` (+area formatters).
- `@vitrum/paper`: `bom.test.ts` (A4 page + title, one section per glass with printed swatch, dims in
  mm vs inch — FR-4, BOM sections + documented factors, foil path, include toggles, **valid vector PDF
  bytes** encoding ²/×, pagination); `bomCsv.test.ts` (units in headers, RFC-4180 quoting, plain
  numbers, labelled blocks, foil block — FR-3).
- `@vitrum/ui`: `shell/BomPanel.test.ts` (cutting list render, empty state, glass/came hover
  highlight, sort switch, foil section, waste-factor edit, PDF/CSV export, disabled when empty).
- E2E `apps/desktop/e2e/bom.spec.ts`: draw a border → paint a glass → open the Manufacturing dock →
  Renumber → export **PDF and CSV to disk**, asserting a valid `%PDF` and CSV containing the cutting
  list / units / weight. Runs the packaged `file://` build, proving pdf-lib + the CSV path work
  bundled (no worker, so the F-030 `file://` worker caveat does not apply).

**Verified by me**: all five gates green from the repo root — `pnpm lint`, `pnpm format:check`,
`pnpm check`, `pnpm test` (762 unit), `pnpm test:e2e` (21). The E2E exercises the real
draw→paint→number→export path end to end. (The `pnpm dev:ui` browser preview was unavailable in this
environment — the tooling host was unreachable — so the visual pass is folded into the manual check
below; the E2E is the stronger automated evidence.)

**Pending Mathieu (manual, not automatable)**

- **Bench/gallery check** of the printed cutting-list PDF: swatch colours, one-glass-per-section
  legibility, dims in the chosen unit, and that a professional reads it as a usable cut sheet.
- **Spreadsheet round-trip**: open the CSV in a real spreadsheet and confirm columns/units import
  cleanly (FR-3 is unit-tested for quoting/headers; the actual app import is a human check).

**Update (F-043, 2026-07-21):** the `BomPanel` PDF/CSV export buttons were removed; the cutting list /
BOM now exports as the **"Cutting list & BOM"** document type inside the single Export dialog (top-bar
Export button). The panel keeps the live cutting-list table, factor editing and row-hover highlight —
a working view, not an export surface. The pure `computeBom` + `buildBomDocument`/`bomToCsv` pipeline
is unchanged; the dialog composes `BomController`. See F-043 Implementation notes.

**Follow-ups (out of scope)**

- Copper-foil both-faces tape multiplier (currently seam-once + waste); a per-tile/per-section compact
  legend; remembering export settings across sessions.
- Nesting-based exact sheet counts (F-057) replaces the waste-factor heuristic; labour/margin quoting
  builds on this BOM (F-056).
- The autosave path does not run the save-time normalisers (shared F-023/F-040 caveat); the BOM reads
  live derived data so it is always current on screen regardless.
