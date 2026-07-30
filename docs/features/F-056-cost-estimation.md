# F-056: Cost estimation & quoting

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
| **Depends on** | F-042              |
| **Complexity** | M                  |

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

## Functional requirements

_Expanded 2026-07-22 (Mathieu authorised self-expansion of this Phase-5 draft). The FR
sketch below is the contract; the labor coefficients ship as **uncalibrated placeholder
defaults** (Mathieu's steer), every factor user-tunable and clearly labelled in the UI._

- **FR-1 — Determinism.** The same document + the same price/labor settings produce the
  same quote totals, to the cent, regardless of edit order or platform. Verified by a
  unit test on a reference panel (`computeQuote` is a pure function of its input).
- **FR-2 — Tunable & persisted, live recompute.** Every pricing and labor factor
  (currency, price book, hourly rate, per-piece / per-metre / complexity / foil factors,
  setup hours, overhead %, margin %, client fields, manual line items) is user-editable
  and persisted with the document. Editing any one is a single undo entry. The quote,
  cutting list and BOM all re-derive live on any relevant edit — no stored derived total
  is ever reachable (the F-042 "persist intent, derive the rest" discipline).
- **FR-3 — Client-presentable quote PDF.** The quote exports as a PDF through the F-041
  paper pipeline: header (project title, client, quote number, date), the priced line
  items grouped for a client (materials / labor / manual, then overhead, margin, total),
  and an **optional** rendered panel image (the F-053/F-043 canvas snapshot if the render
  view is available, the flat design snapshot otherwise). The **internal cost breakdown**
  (per-material quantities, the labor hours breakdown, overhead and margin as separate
  lines) is **excluded unless explicitly toggled on** at export. Bench/gallery judgement
  of "reads as a professional quote" is Mathieu's (manual, listed as pending).
- **FR-4 — Transparent labor model.** The labor estimate is never a black box: the panel
  shows the formula in words, the per-factor hour contributions (setup + per-piece +
  per-seam-metre), and the resulting hours × rate. The coefficients are labelled as
  uncalibrated placeholder defaults until calibrated against real workshop hours.
- **FR-5 — Material costs from the catalog + price book.** Glass cost comes from each
  glass's `pricePerM2` (F-022) applied to its waste-inflated buy area (the F-042 figure).
  Came, copper foil, solder, reinforcement and named consumables are priced from an
  editable **price book** stored per project, with a **global workshop default** the user
  can save to and load from (the F-022 `*Port` pattern). Glass in use with no price is
  flagged, and the quote total is marked as understating rather than silently counting
  it as free.
- **FR-6 — Sensitivity / traceability.** The quote panel ranks pieces by their labor
  contribution and answers "the N smallest pieces contribute €Y of labor" for an
  adjustable N; hovering the sensitivity block (or a line item) highlights the
  contributing pieces/segments on the canvas, exactly as F-042 does.

## Open questions

_None — resolved at expansion (see Resolved decisions)._

## Resolved decisions

1. (2026-07-22, Mathieu) **Labor coefficients ship as plausible placeholder defaults.**
   Every factor is user-tunable (FR-2) and the UI labels the model as "uncalibrated
   placeholder defaults". Shipped defaults: hourly rate 45 (currency/h), setup 2 h,
   12 min/piece, 15 min per metre of seam, 8 min per unit of shape complexity, foil
   per-piece factor ×1.4. Calibration against Mathieu's real workshop hours is a
   follow-up (Implementation notes).
2. (2026-07-22, implementer, spec silent) **Margin is a markup on cost.** `margin =
(subtotal + overhead) × marginPct`; `total = subtotal + overhead + margin`. Labelled
   "Margin (markup %)" in the UI so the meaning is unambiguous. Overhead is likewise a
   markup on the subtotal. Both are transparent, single-formula steps (FR-4 spirit).
3. (2026-07-22, implementer) **Piece shape complexity** is a pure, deterministic geometric
   metric: `complexity = clamp(perimeter / bboxPerimeter − 1, 0, 6)`, where `bboxPerimeter`
   is the piece's bounding-box perimeter. A rectangle-ish piece scores ~0; a wiggly,
   curve-heavy piece scores higher, so it costs more per-piece labor (Scope: "curve-heavy
   pieces cut slower"). No dependency on segment kind, so it is stable under detection.
4. (2026-07-22, implementer) **The quote date is not persisted** (it is not an input to
   any total, so FR-1 is unaffected). The shell stamps today's date at export; tests pass
   a fixed date. Client name / project title / quote number / notes **are** persisted
   intent.

## Design

New **Cost** dock section (activity-rail entry + `shell/dock.ts` section), holding the
`QuotePanel`: a totals summary, the transparent labor model, the price book, overhead/
margin, manual line items, client fields, currency, and the sensitivity block. The
client **quote PDF** is a new `quote` document type in the single Export dialog (F-043
hub), composing a `QuoteController` alongside the existing print/BOM/export controllers.
All tokens-only, `components/core` primitives, sentence-case copy, numbers in mono.

## Implementation notes

_Delivered 2026-07-22 on branch `f-056-cost-estimation` (Status: done, pending the manual quote-PDF
judgement below)._ Mathieu authorised self-expanding this Phase-5 draft (FRs + acceptance above) and
steered the labor coefficients to ship as clearly-labelled uncalibrated placeholder defaults. F-042 is
`done`, so the real BOM (`computeBom`) feeds the quote — nothing stubbed.

**What shipped**

- **Persisted intent (`@vitrum/model`)** — new `QuoteSettings { currency, priceBook, labor,
overheadPct, marginPct, client, manualLines }` on `Project.quote` (schema **v12 → v13**,
  `migrateV12ToV13` seeds resolved defaults on older files). Supporting types `Currency`, `PriceBook`
  (came/foil/solder/reinforcement per-unit + flat `ConsumableLine`s), `LaborModel`, `QuoteClient`,
  `QuoteLineItem`, with `defaultCurrency/PriceBook/LaborModel/QuoteSettings()`. One self-inverting
  command `updateQuoteSettings(patch)` — a shallow top-level patch; the UI replaces a whole sub-object
  (a labor coefficient, a consumable, a manual line) so each edit is one undo entry. Only tunable
  intent is stored; every total is derived (FR-2).
- **Global workshop price book (`@vitrum/model/priceBook.ts`)** — the F-022 `*Port` pattern:
  `PriceBookPort { load, save }`, `serialize/deserialize/normalizePriceBook`, version-guarded. A
  project consumes it by value; the port persists the user's cross-project default.
- **Pure computation (`@vitrum/core/quote`)** — `computeQuote(input, unit): QuoteReport`, model-/DOM-
  free, mirrors the model types structurally (like the BOM mirrors glass/reinforcement), so it is a
  deterministic function of the BOM + prices + per-piece metrics (FR-1). Produces: material lines
  (glass priced from the F-042 `buyArea × pricePerM2`, flagging unpriced glass; came/foil/solder/
  reinforcement priced from the price book; flat consumables), the transparent `LaborBreakdown`
  (setup + per-piece with a complexity term and a foil factor + per-metre-of-seam, hours × rate, FR-4),
  per-piece labor rows sorted smallest-first for the sensitivity view (FR-6), manual lines, and
  subtotal → overhead → margin → total (both markups on cost, Decision §2). `pieceComplexity` is the
  pure `perimeter/bboxPerimeter − 1` metric (Decision §3).
- **Quote PDF (`@vitrum/paper/quote.ts`)** — `buildQuoteDocument(report, options): PdfDoc` via the
  F-041 `PageBuilder`/pdf-lib backend (no new PDF engine). Default **client view**: header, optional
  panel image, one rolled-up "panel — materials, design & fabrication" line, explicit manual lines,
  and the total — the internal cost breakdown is **hidden unless `includeBreakdown`** (FR-3), which
  emits the full internal sheet (every material line, the labor hours breakdown, overhead + margin).
  Added an `image` `DrawOp` + pdf-lib `embedPng/embedJpg` (a pre-embed pass in `renderPdf`) so the
  optional rendered panel snapshot can be embedded.
- **Host port** — `PriceBookPort` on `AppHost` (desktop `userData` file with `VITRUM_PRICE_BOOK_PATH`
  E2E override + preload IPC, `localStorage` in the browser, in-memory in `fakeHost`).
- **UI (`@vitrum/ui`)** — `PriceBookController` (reactive global-default bridge) + `QuoteController`
  (sensitivity `smallestN`, the two export toggles, the PDF runner). New **Cost** dock section
  (`shell/dock.ts` + `ActivityRail` entry + `DockPanel` slot) hosting `QuotePanel.svelte`: totals
  summary, sensitivity block, overhead/margin, the transparent labor model (with the "uncalibrated
  placeholder defaults" label and the live hours breakdown), the price book (currency + unit prices +
  consumables + workshop-default save/load), client fields and manual line items — tokens-only from
  `components/core`. The **client quote PDF** is a new `quote` document type in the single Export
  dialog (F-043 hub), composing `QuoteController` beside print/BOM/export. `AppShell` derives the live
  `QuoteReport` from the same BOM everything else reads (FR-2) and stamps the export date at export
  time. Sensitivity/traceability reuses the F-042 `BomController` highlight overlay (no new canvas
  prop, so the Canvas stays untouched for the sibling merges).

**Deviations / decisions (implementer calls, spec silent)**

- **Margin & overhead are markups on cost** (Decision §2), labelled "Margin (markup %)"; transparent
  single-formula steps rather than a profit-margin-on-price definition.
- **Piece complexity is `perimeter/bboxPerimeter − 1`, capped at 6** (Decision §3) — purely geometric
  and independent of segment kind, so it is stable under detection.
- **Quote date is not persisted** (Decision §4) — it is not an input to any total, so FR-1 holds;
  the shell stamps today's date, tests pass a fixed one.
- **`computeQuote` takes the display `unit`** only to build human `detail` strings (quantities); every
  amount is unit-independent, so FR-1 is unaffected. (The BOM formats in the UI/paper layers; the
  quote centralises detail strings once since they carry quantity + unit price.)
- **Workshop-default apply is explicit** (a "Load workshop default" button), not auto-applied on new
  projects — avoids coupling the price-book controller to document creation. Auto-seeding a new
  project from the workshop default is a follow-up.
- **Sensitivity traceability reuses the BOM highlight overlay.** The quote panel highlights the
  smallest pieces via `BomController.highlight`; per-material-line highlight lives in the BOM panel.
- **Net-new UI to back-port** to the Claude Design project: the **Cost dock** (`QuotePanel`: totals,
  labor model, price book, sensitivity, client fields) and the Export dialog's **quote** type.

**Tests**

- `@vitrum/model`: `quoteCommands.test.ts` (defaults, single/multi-field + whole-sub-object patch,
  add/remove manual line, undo/redo, serialize round-trip); `priceBook.test.ts` (round-trip, version
  guard, field/consumable normalisation); `serialize.test.ts` v12→v13 migration + synthetic chain to
  v13; `autosave.test.ts` fixture upgraded to a real UTF-8 round-trip (the € default exposed its
  Latin-1 truncation).
- `@vitrum/core`: `quote/quote.test.ts` (**FR-1 hand-computed reference** — materials from BOM +
  price book, unpriced-glass flag, transparent labor hours/cost, overhead/margin/total, determinism,
  smallest-first ordering, manual lines incl. negative discount, foil tape+solder + foil factor;
  `pieceComplexity`).
- `@vitrum/paper`: `quote.test.ts` (A4 page + header + total, breakdown excluded by default vs
  included when toggled — FR-3, panel-image op present, valid `%PDF` incl. embedded image, unpriced
  note).
- `@vitrum/ui`: `shell/QuotePanel.test.ts` (total + overhead/margin, empty state, sensitivity hover
  highlight, margin edit as one patch, nested labor edit, add manual line, unpriced flag, workshop
  actions); `quote/controller.svelte.test.ts` (defaults, PDF export path + error capture);
  `quote/priceBook.svelte.test.ts` (seed/load/corrupt-fallback/save/no-port).
- E2E `apps/desktop/e2e/quote.spec.ts`: draw a border → paint glass → open the Cost dock → confirm the
  live total → export the client quote PDF to disk, asserting a valid `%PDF`. Runs the packaged
  `file://` build, proving `buildQuoteDocument` + pdf-lib work bundled.

**Verified by me**: `pnpm lint`, `pnpm check`, `pnpm test` (998 unit) and `pnpm test:e2e` (27) all
green from the repo root. `pnpm format:check` reports only three **pre-existing** warnings
(`docs/features/F-053-*.md` and two `docs/testing/runs/2026-07-22-a/*.md`) that are not part of this
branch's diff (`git diff main...HEAD`); every F-056 file is formatted. (`pnpm dev:ui` browser preview
was unavailable in this environment; the E2E is the stronger automated evidence.)

**Pending Mathieu (manual, not automatable)**

- **Client-presentability judgement of the quote PDF (FR-3):** does the default client view read as a
  professional quote (header, one rolled-up panel line + line items + total, optional render image),
  and is the internal-breakdown toggle the right cut of information?
- **Labor calibration (Open question #1):** the shipped coefficients (45/h, 2 h setup, 12 min/piece,
  15 min/seam-m, 8 min/complexity, ×1.4 foil) are placeholders. Calibrate against real workshop hours
  and update `defaultLaborModel()` (a follow-up — the model is transparent and fully tunable meanwhile).

**Follow-ups (out of scope)**

- Auto-seed a new project's price book from the saved workshop default; multi-currency conversion;
  per-came-profile came pricing; remembering the export breakdown/image toggles across sessions.
- Labor coefficient calibration (above), and a "confidence range" (±%) on the estimate once real hours
  exist.

_Cockpit v2 (2026-07-30):_ the full quote breakdown opens as a wide `QuoteTable` in the `OutputDrawer`; the **Cost** section keeps the editing controls. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.
