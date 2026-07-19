# F-022: Glass catalog

|                |                          |
| -------------- | ------------------------ |
| **Phase**      | 2 — Stained glass domain |
| **Status**     | done                     |
| **Depends on** | F-002                    |
| **Complexity** | M                        |

## Summary

The library of glass a designer can assign to pieces: color, transparency class,
texture, thickness, and commercial metadata. Two levels, like KiCad's symbol/footprint
libraries: a global user library shared across projects, and per-project glass
instances (so a shared project file is self-contained).

## Scope

- `Glass` entity: name, base color (sRGB), transparency class (transparent /
  translucent / opalescent / opaque), texture tag (smooth, hammered, seedy, streaky,
  ripple, granite, …), thickness (default 3 mm), and optional commercial fields
  (manufacturer, SKU, price per m², sheet sizes) used by F-042/F-056/F-057.
- Optional texture/photo swatch image per glass (user-uploaded), stored embedded in
  the project file for project glasses (forces the F-002 container decision).
- **Starter catalog**: ~60 curated generic glasses spanning the color wheel ×
  common transparency/texture combos, shipped as data.
- Global library persisted in the Electron app-data directory (`userData`); project uses copies
  ("consume by value") with a re-link/update flow when the library version changes.
- Catalog UI: searchable/filterable palette panel (by hue, transparency, texture);
  create/edit/duplicate/delete glasses; import/export library as JSON.

### Non-goals

- Assigning glass to pieces and rendering (F-023).
- Live manufacturer catalog integrations (Bullseye, Wissmach, Oceanside, Kokomo,
  Lamberts, Saint-Just). Diafane lists this as _planned_, so it's a differentiator —
  but it needs data-sourcing/licensing research first. Backlog: `F-058
manufacturer-catalogs`; the data model here must already fit it (hence SKU fields).

## Design

The palette panel matches the Editor screen's glass palette in `ui_kits/studio`
(F-004), built from `Card`/`Tag`/`Input` (search) core components. This is the
canonical home of the **vitrail palette** — glass swatches are exactly the use the
design system reserves it for. Catalog editing dialogs use `Dialog` + form
primitives.

## Functional requirements

- FR-1: CRUD on glasses in both global library and project scope; project files are
  self-contained (open on a machine with an empty global library and render identically).
- FR-2: Starter catalog loads on first run; user edits never mutate the shipped data
  (copy-on-write).
- FR-3: Search/filter returns correct results across name, hue bucket, transparency,
  texture, manufacturer.
- FR-4: Library export → import on a clean profile round-trips losslessly.
- FR-5: Swatch images are downscaled on import (cap ~512 px) to keep files small.

## Acceptance criteria

- Unit tests for library storage, copy-on-write, round-trip.
- Manual: build a small personal library with a photo swatch, use it in a project,
  reopen the file in a fresh browser profile — identical appearance.

## Open questions

1. ~~Starter catalog curation: generate programmatically (hue sweep) or hand-curate to
   mimic real glass lines?~~ **Resolved (Mathieu, via orchestrator, 2026-07-18):
   hand-curate ~60 glasses with plausible names, spanning the colour wheel × common
   transparency/texture combos, mimicking real glass lines. Shipped as a fixed data
   file; user edits never mutate it (copy-on-write, FR-2).**
2. ~~Price fields: per m² only, or per common sheet size too? (Affects F-056
   accuracy.)~~ **Resolved (Mathieu, via orchestrator, 2026-07-18): price per m²
   only for now. Keep `sheetSizes` as a dimension list (no per-size price); per-sheet
   pricing is deferred to when F-056/F-057 need it. The SKU/manufacturer fields still
   ship so F-058 manufacturer catalogs fits the model.**

## Implementation notes

_Delivered 2026-07-19._ Both open questions were pre-resolved by Mathieu (above).

**Model (`@vitrum/model`).**

- **`Glass` entity** now lives in `types.ts` (with `TransparencyClass`, `TextureTag`,
  `SheetSize`) alongside the other document entity shapes — expanded from the F-002 `{ id, name }`
  placeholder. `TextureTag` is the six-way union `smooth | hammered | seedy | streaky | ripple |
granite`; `sheetSizes` is a dimension list (no per-size price, per Q2); `pricePerM2` and the
  `manufacturer`/`sku` commercial fields are optional so F-042/F-056 and F-058 fit without a schema
  change. `swatch` is an optional embedded data URL.
- **`glass.ts`** owns the shipped **starter catalog** (`STARTER_GLASSES`), the hue/search/filter
  logic, and copy-on-write helpers. 60 hand-curated generic glasses span every hue bucket ×
  transparency × texture, with plausible names and **fictional** manufacturer lines (Aurora Glass,
  Meridian, Cathedral Works, Riverstone, Lumen, Old Forge). The array is deeply frozen and
  `starterGlasses()` returns fresh deep copies, so user edits never mutate the shipped data (FR-2).
  `hueBucket()` derives a 9-bucket colour-wheel position from the sRGB hex (low-saturation → neutral);
  `filterGlasses()`/`matchesGlass()` implement search across name/manufacturer/SKU/texture/transparency
  plus hue/transparency/texture facets (FR-3). `fitWithin()` is the pure swatch-downscale sizing (FR-5).
- **`glassLibrary.ts`** owns the global cross-project library: `GlassLibrary` value + pure
  `upsert/remove/duplicate/merge` ops, `serialize/deserialize` (version-checked, drops malformed
  entries, fills defaults) for the export→import round-trip (FR-4), and the `GlassLibraryPort`
  interface abstracting persistence + JSON import/export (the F-001 "browser-runnable UI" rule).
- **Project-scope glass commands** `upsertGlass`/`removeGlass` in `commands.ts` (undoable,
  self-inverting) store glasses **by value** in `Project.glasses`, which already serializes with the
  `.vitrum` file — so a shared file renders identically on an empty global library (FR-1).
- **Schema v3 → v4** migration expands any placeholder glass to the rich shape; `CURRENT_SCHEMA_VERSION`
  bumped to 4. The round-trip property test (FR-3/F-002) now also generates glasses via a new `glassArb`.

**UI (`@vitrum/ui`).** `GlassLibraryController` (`.svelte.ts`) mirrors the library into runes,
loads/seeds on mount and persists every edit through the port. `GlassPalette.svelte` is the palette
panel — Library/Project tabs, search `Input`, hue/transparency/texture `Select` filters, a swatch
grid of `Card`s, New/Import/Export — built only from ported `components/core` primitives and tokens
(the canonical home of the vitrail palette). `GlassEditorDialog.svelte` is the create/edit/duplicate/
delete form (`Dialog` + form primitives) including a swatch upload that downscales to 512 px via
`glass/downscale.ts` (`fitWithin` + `<canvas>`). The palette is wired into the **Inspector** default
(no-selection) view: library edits go through the controller; project edits go through document
commands (undoable, serialized). The `AppHost`/`browserHost`/`fakeHost` and the Electron
`main`/`preload` gained a `glassLibrary` port backed by `userData/glass-library.json` (overridable via
`VITRUM_GLASS_LIBRARY_PATH` for E2E isolation).

**Deviations / decisions.**

- **Palette placement.** With glass _assignment_ deferred to F-023, the palette renders inside the
  Inspector rail rather than as a separate dockable region — this keeps the F-004 shell grid and its
  tests stable. F-023 can promote it to a dedicated dock when drag-to-assign lands. Both the palette
  panel and the editor dialog are **net-new screens** to back-port to the Claude Design project.
- **`sheetSizes` gained an optional `label`** (Mathieu's `types.ts` shape) beyond the spec's bare
  dimension list; still no per-size price (Q2 honoured).
- **One formatting-only edit to `types.ts`** (collapsing the `TextureTag` union onto one line) was
  needed for `format:check`; it changes no type shape.

**Tests.** Model: `glass.test.ts` (starter catalog invariants + frozen/copy-on-write, hue buckets,
FR-3 filtering, FR-5 sizing), `glassLibrary.test.ts` (seed/load/ops + FR-4 round-trip/merge/version),
`glassCommands.test.ts` (FR-1 project CRUD + undo + by-value serialization), and the v3→v4 migration
test. UI: `library.test.ts` (controller first-run seed/persist, load, corrupt-fallback, import/export),
`GlassPalette.test.ts` (render, search + facet filters, create/edit via dialog, scope tabs,
add-to-project). E2E: `glass.spec.ts` drives the real app — starter catalog loads (60), search filters,
a created glass **persists across an app relaunch** against the same `userData` library file. Full
suite green: `lint`, `format:check`, `check`, **492 unit**, **15 E2E**.

**Verified by me:** all five gates from the repo root; the E2E relaunch proves the persistence
mechanism; a `pnpm dev:ui` visual pass confirmed the palette and editor match the design system.

**Pending Mathieu (manual, not automatable):** the acceptance-criterion fresh-profile visual
round-trip _with a real uploaded photo swatch_ — build a small personal library with a photo swatch,
use it in a project, reopen the file on a clean profile, confirm identical appearance. The swatch
downscale sizing (`fitWithin`) and library round-trip _logic_ are unit-tested; only the actual image
raster path (jsdom lacks `<canvas>` encoding) and the visual comparison are manual.

**Follow-ups (out of scope):** the "re-link / update project glasses when the library version changes"
flow (Scope bullet) is deferred — it only becomes meaningful once F-023 assigns glass to pieces;
consume-by-value is delivered, the version-diff re-link is not. Live manufacturer catalogs remain
`F-058`. The palette should move to a dedicated Editor dock in/after F-023.
