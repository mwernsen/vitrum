# F-063: Glass library home

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
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

_Delivered 2026-08-14. Branch `f-063-glass-library-home`._

### What shipped

- **`packages/ui/src/library/rail.ts`** — the "Glass library" placeholder became a **live**
  destination. `RailItem` keeps its declarative shape (and its `live: false` + `note` branch, for the
  next unbuilt surface); both current rows are now `live: true`. The launch screen owns a
  `panels | glass` view state.
- **`packages/ui/src/library/LibraryScreen.svelte`** — the portal now owns the view state (FR-1). The
  rail rows are buttons that select the view; the active one carries `aria-current="page"`. The header
  search field targets the active view with per-view placeholder ("Search panels" / "Search glass")
  and **independent queries** (FR-6) — panels search stays on `controller.query` (F-058 behaviour),
  glass search on a local `glassQuery`. The content area swaps between the existing panels view and
  the new glass view; a panels ⇄ glass round trip leaves the panels state (hero, query) untouched
  because that state never moves. The rail count reads the live library size.
- **`packages/ui/src/glass/GlassLibraryView.svelte`** (net-new) — the full-page glass home: header
  (title, Import / Export, New glass), a facet row (hue / transparency / texture) with the mono
  "N of M" count, and a grid of **rich cards** (Open question 1) — swatch, name, manufacturer · SKU,
  transparency / texture / thickness `Tag`s, price per m². Clicking a card opens the existing
  `GlassEditorDialog`; **delete always confirms** through one `Dialog` (Open question 3) whose copy
  states panels are unharmed (consume-by-value, FR-7). Search + facets reuse F-022's `filterGlasses`
  (not reimplemented); the no-match state is distinct from an empty library (FR-3). All mutations and
  import / export go through the **app-level `GlassLibraryController`** that `App.svelte` already
  constructs and now passes into the portal, so this screen and the editor palette can never disagree
  (FR-4).
- **`packages/ui/src/glass/facets.ts`** (net-new, extracted) — the shared facet-row plumbing
  (`HUE_OPTIONS` / `TRANSPARENCY_OPTIONS` / `TEXTURE_OPTIONS`, `toGlassFilter`, `hasActiveFacets`).
  `GlassPalette.svelte` was refactored onto it, removing the duplicated option lists / filter
  assembly the spec's Technical guidance flagged; the palette and the home cannot drift.
- **`packages/ui/src/App.svelte`** — passes `glassLibrary` (the controller) into `LibraryScreen`
  instead of the bare `glassCount`.

### Tests

- Unit: `glass/facets.test.ts` (option lists, sentinel-dropping filter assembly, `hasActiveFacets`).
  `filterGlasses` itself is not re-tested (F-022 owns it, per the acceptance criteria).
- Component: `glass/GlassLibraryView.test.ts` (grid + metadata, header-query filtering, facet
  filtering, no-match vs empty-library states, create through the dialog updates the grid + the shared
  controller, always-confirm delete with the FR-7 wording, import / export routed through the port).
  `library/LibraryScreen.test.ts` gained rail-navigation tests (both ways, `aria-current` moving, the
  glass region appearing / the panels region leaving) and a per-view search-query test (FR-6); its
  "#2a chrome" test was updated — both rows are live now, so nothing in the rail is disabled and the
  count comes from the seeded `GlassLibraryController`.
- E2E: `glass.spec.ts` gained a test that drives the launch-screen glass home end to end — starter
  catalog renders full-page, header "Search glass" filters, a glass created there **persists across an
  app relaunch**, and the same glass appears in the **editor palette** (the one-controller proof,
  FR-4). `library.spec.ts`'s FR-8 assertion flipped from "Glass library disabled" to
  **"Glass library enabled"** (it is a live destination now); the removed Settings row stays absent.

### Deviations

- **No "clear filters" control shipped**, though `hasActiveFacets` exists in `facets.ts` for it —
  the facets each carry an "Any …" option that clears them, so a separate reset felt redundant. Left
  the helper in place (and tested) as the seam for one if wanted.
- The header search drives the glass grid but the **facets are local** to the view (not in the
  header), mirroring the editor palette; only the free-text query is the header's job, which is what
  FR-6 scopes.

### Net-new for back-port

`GlassLibraryView` is a **net-new screen** with no canonical design (the spec's Design section says
so — `#2a` draws only the rail row and count). It follows the Vitrum Design System: composed from
`components/core` (`Card`-style cards, `Select`, `Dialog`, `Tag`, `Button`), tokens only for chrome,
swatches exempt as glass data, sentence-case copy, mono numerals. **Back-port to the Claude Design
project (`3c259295-607a-4eba-8cad-3890f7e80063`).** The rail's live-both-rows treatment and the
always-confirm delete dialog are also new in-code details worth reflecting there.

### Pending Mathieu

- Visual sign-off of the net-new glass home (acceptance criteria "Manual"), and confirmation it is
  back-ported to the Claude Design project.

### Follow-ups (out of scope)

- Usage counts ("used in N panels"), cross-document re-link / bulk replace, and manufacturer catalogs
  (F-062) remain deferred exactly as the spec's Non-goals state.
