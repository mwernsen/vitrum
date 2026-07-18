# F-022: Glass catalog

|                |                          |
| -------------- | ------------------------ |
| **Phase**      | 2 — Stained glass domain |
| **Status**     | draft                    |
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

1. Starter catalog curation: generate programmatically (hue sweep) or hand-curate to
   mimic real glass lines? Recommendation: hand-curate ~60 with plausible names.
2. Price fields: per m² only, or per common sheet size too? (Affects F-056 accuracy.)
