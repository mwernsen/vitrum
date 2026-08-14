# F-063: Glass library home

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | agreed             |
| **Depends on** | F-022, F-058       |
| **Complexity** | M                  |

## Summary

The launch screen's "Glass library" destination, made real: a cross-document home for
the global glass catalog (F-022), browsable and editable without opening a panel.
Today the catalog is reachable only through the editor's Inspector palette, so
maintaining your glass collection means opening some panel first. F-058 built the
portal rail with this destination as a disabled placeholder; this feature turns it
live — and it is the only remaining placeholder, after the 2026-08-14 cleanup removed
the unowned Cut lists / Versions / Settings rows.

## User story

As a stained glass designer, I want to browse and maintain my glass collection from
the launch screen — add the sheets I just bought, prune what I no longer stock —
without opening a panel first, so that the library reflects my real shelf when I next
design.

## Scope

- **Rail navigation**: the portal gains a view state (`panels | glass`). "Glass
  library" in the F-058 nav rail becomes live; clicking it swaps the content area,
  "Panels" swaps back. The active row carries `aria-current="page"`, exactly as
  "Panels" does today. The rail's glass count stays real (library size).
- **Glass grid**: a full-page swatch grid of the global library — swatch (color /
  texture preview via `GlassPreview`, or the uploaded photo), name, manufacturer +
  SKU where present, transparency class, texture tag, thickness. Renders the starter
  catalog on first run (the F-022 seed behaviour, unchanged).
- **Search and facets**: a search field plus hue / transparency / texture filters,
  with the exact matching semantics of F-022 FR-3 (`filterGlasses` is reused, not
  reimplemented). A query matching nothing shows a distinct "no glass matches" state.
- **CRUD**: create, edit, duplicate, delete through the existing
  `GlassEditorDialog`; import / export library JSON through the existing
  `GlassLibraryPort` flows. All mutations go through the app-level
  `GlassLibraryController`, so the editor palette and this screen can never disagree.
- **Header search scoping**: the F-058 top-bar search field follows the active view —
  placeholder "Search panels" on the panels view (unchanged), "Search glass" on the
  glass view, each remembering its own query. This closes F-058's deliberate
  "glass search waits for a cross-document glass home" gap (its FR-11 note).

### Non-goals

- **Per-project glass scope.** A project's own glasses live inside its document and
  need it open; the editor palette's Project tab (F-022) keeps that job. This screen
  is the _global_ library only.
- **Manufacturer catalogs** (Bullseye, Wissmach, …) → backlog F-062.
- **Usage indexing** ("used in 3 panels", delete warnings driven by it). Projects
  consume glass by value (F-022 FR-1), so deleting a library glass never damages a
  panel — a usage count is informational and needs a save-time index extension
  (F-058 FR-10 pattern). Deferred; see Open question 2.
- **Cross-document re-link / bulk replace** ("update every panel using X to Y") —
  the F-022 follow-up, still deferred; it only makes sense per open document.

## Design

There is no canonical design for a full-page glass home — `#2a`
([docs/design/portal-redesign.dc.html](../design/portal-redesign.dc.html)) draws the
rail row and its count but never the destination. Per CLAUDE.md this screen may be
designed in code, **must** match the Vitrum Design System, and is a **net-new screen
to back-port** to the Claude Design project.

- Chrome is F-058's portal, untouched: 56px header, 210px `--paper-50` rail; the
  content area alone swaps.
- The grid composes `Card`, `Input`, `Select`, `Dialog`, `Tag` from
  `components/core`; the editor's `GlassPalette` is the secondary reference for facet
  and swatch treatment. Swatches are glass data — the canonical home of the
  **vitrail palette** — and exempt from the token rule; surrounding chrome is not.
- Numbers (thickness, price) in mono; copy in sentence case.

## Functional requirements

- FR-1: Clicking "Glass library" in the rail shows the glass view; clicking "Panels"
  returns. The active rail row is marked `aria-current="page"`; neither destination
  is ever a disabled button once this ships. The panels view's state (query, scroll,
  hero) survives a round trip.
- FR-2: The glass view lists every glass in the global library with swatch, name,
  and its metadata; on a fresh profile it shows the 60-glass starter catalog.
- FR-3: Search and hue / transparency / texture facets filter the grid with F-022's
  semantics; a no-match state is shown that is distinct from an (impossible-today)
  empty library.
- FR-4: Create, edit, duplicate and delete persist through the port and are visible
  in the editor's palette on next open — and vice versa, library edits made in the
  editor appear here. One controller instance, no cache to invalidate.
- FR-5: Export produces the F-022 JSON; import merges (incoming wins by id) and
  reports how many glasses arrived. Round-trip is lossless (F-022 FR-4 unchanged).
- FR-6: The header search field targets the active view, with per-view placeholder
  text and independent queries.
- FR-7: Deleting a glass leaves every existing panel pixel-identical (consume by
  value); the delete confirmation states this so the user is not scared off pruning.

## Technical guidance

- `App.svelte` already constructs the app-level `GlassLibraryController` (it feeds
  the rail count). Pass it into the portal; do not create a second instance.
- The view state belongs in the portal layer (`LibraryScreen` or a thin
  `PortalScreen` wrapper that owns rail + header and slots the active view). Keep it
  out of `App.svelte`'s `library | editor` state — FR-1/FR-5 precedence there
  (recovery → file argument → launch screen) must not grow a third arm.
- `rail.ts` items gain an `onSelect`/active mechanism instead of the `live: false`
  tooltip branch; keep the `RailItem` shape so future destinations stay declarative.
- Reuse from F-022: `filterGlasses`/`matchesGlass` and hue buckets from
  `@vitrum/model`, `GlassEditorDialog`, `GlassPreview`, the import/export port
  methods. The new surface is essentially `GlassPalette`'s Library tab at page scale
  — consider extracting shared pieces rather than duplicating the facet row.
- The screen must work in `pnpm dev:ui` (browser host persists the library in
  `localStorage` already).

## Acceptance criteria

- Component: rail navigation both ways with `aria-current` moving; grid renders the
  starter catalog; search + each facet filters; no-match state; create/edit/delete
  through the dialog updates the grid; header search scoping (FR-6).
- Unit: any extracted filter/facet helpers (most logic already tested under F-022 —
  do not re-test `filterGlasses` itself).
- E2E (Playwright, packaged app): launch → Glass library → create a glass → relaunch
  → still there → open a panel → the editor palette lists it. This extends the F-022
  `glass.spec.ts` persistence proof across the new surface.
- Manual (Mathieu): visual sign-off of the net-new screen; confirm it is back-ported
  to the Claude Design project.

## Open questions

_All resolved 2026-08-14: Mathieu greenlit implementation with the proposals standing
(resolution by delegation, the F-058 Q7 pattern)._

1. ~~**Grid density**: compact swatch tiles or richer cards?~~ **Resolved: richer
   cards** with the commercial metadata visible (manufacturer, SKU, price per m²) —
   this is the management surface, the editor palette is the picking surface.
2. ~~**Usage counts** ("used in 2 panels") via a save-time index extension?~~
   **Resolved: deferred** until asked for; FR-7's wording keeps deletion safe
   without it. No `PanelFacts` schema change in this feature.
3. ~~**Delete confirmation**: always, or only for curated glasses?~~ **Resolved:
   always confirm**, one `Dialog`, consistent with the editor palette.

## Implementation notes

_(Filled in by the implementing agent after completion.)_
