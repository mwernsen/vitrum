# F-058: Panel library & launch screen

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | in-progress        |
| **Depends on** | F-002, F-055       |
| **Complexity** | M                  |

## Summary

The home page: a launch screen that shows your panels as a visual library (thumbnail
grid of recent files), a proper "new panel" dialog, and a way back to the library
from the editor. Today the app boots straight into the editor with a scratch
document, the TopBar document chip's menu is inert (recorded in F-001's cockpit-v2
notes), and project settings like panel size and technique have no entry point at
creation time. This closes the last gap between "an editor" and "an application".

## User story

As a designer, I open Vitrum and see my panels — I pick up where I left off, or
start a new panel with its real dimensions and technique, without hunting through
the file system.

## Scope

- **Launch screen** shown at startup (unless the app was opened with a `.vitrum`
  file, or crash recovery takes over — those go straight to the editor). Per the
  Portal redesign's launch screen panel "2a" (see Design).
- **Project grid**: recently opened `.vitrum` files with thumbnail, name, panel
  dimensions, technique, and last-opened time. Files that moved or vanished render
  in a distinct missing state with "locate…" and "remove from library" actions —
  the library is a _view over the user's files_, never a vault that owns them
  (local-first principle).
- **New panel dialog**: name, panel width × height (unit-aware), technique
  (lead / foil), units — the `Project.settings` + `technique` fields that exist
  since F-002/F-021 but have no creation-time UI. Creates the document and enters
  the editor with clean undo history and unsaved state.
- **Open from disk**: native open dialog button, plus drag-and-drop of a `.vitrum`
  file onto the launch screen.
- **Back to the library** from the editor via the TopBar document chip's menu
  (making the design's chevron real): guarded by the existing unsaved-changes flow.
  The just-closed panel appears in the grid with a fresh thumbnail.
- **Recents store**: a `LibraryPort` on `AppHost` (the F-022 `GlassLibraryPort` /
  F-055 `VersionPort` pattern): `userData`-backed on desktop with a
  `VITRUM_LIBRARY_PATH` env override for E2E, stubbed in `browserHost`. Stores
  entries (path, display metadata, last-opened) — not document content.
- **Thumbnails**: rendered lazily on browse and cached keyed by file path + mtime,
  placeholder on failure — same discipline as F-055's version thumbnails (FR-6
  there); reuse its renderer.
- **`#2a` chrome**: 56px header (logo, wordmark, search field, account avatar) and
  the 210px `--paper-50` nav rail. "Panels" is live; **"Glass library", "Cut lists",
  "Versions" and "Settings" render as disabled placeholders tagged with their feature
  ids**, the repo's established convention for unbuilt surfaces (`dock.ts`,
  `viewmode.ts`). This keeps `#2a`'s geometry honest without inventing three screens.
  Note "Cut lists" and "Versions" are per-document today (F-042/F-055) and have no
  cross-document meaning yet.
- **"Continue" hero card, in full** — thumbnail, title, "edited … · N panes · N m
  came", the readiness pills ("Geometry complete"; "Glass 86%" with a conic-gradient
  dot; "N checks to review"), and the "Resume editing" / "Version history" actions.
  This is the design's thesis and costs nothing new: the in-flight document is loaded,
  so the F-020/F-030/F-042 controllers already compute these live.
- **Save-time library index**: when the editor saves, write the panel's derived facts
  (panes, came metres, glass %, checks) into its library entry, since they are already
  computed at that moment. The grid then shows real numbers without opening files.
  Never index at browse time — that would run piece detection across every file.
- **Search field**: rendered per `#2a`, filtering recents by name. Glass search waits
  for a cross-document glass home.
- **"Start a panel"** trailing card offering **blank** or **from a photo** (the latter
  is new-panel-then-F-051-reference-import — the restoration on-ramp). Templates are
  deferred, so the card reads "blank or photo".

### Non-goals

- **Panel lifecycle** — `#2a`'s Active/Fired/Archived filters and its Awaiting glass /
  Breakage badges. Real workshop vocabulary, but a persisted domain concept with
  unsettled questions (is "Fired" set by hand or derived? does any status gate
  anything?) → its own spec, `F-061`.
- Templates gallery / starter patterns (Glass Eye ships 400+; ours needs content
  design first) → `F-060`. The "Start a panel" card should leave room for the third
  path.
- Glass search, pinning, folders (revisit when real libraries grow).
- Managed storage, cloud sync, or importing files into an app-owned folder.
- Multi-window / multiple simultaneously open panels (resolved: replace in place).

## Design

The canonical launch screen is panel **`#2a`** of
[docs/design/portal-redesign.dc.html](../design/portal-redesign.dc.html) — vendored
into the repo 2026-08-06 (`DesignSync` cannot be reached from a subagent; see
[docs/design/README.md](../design/README.md)). **Read that panel before building any
of this surface.** Turn 3 of the same file governs the editor cockpit (already
implemented) and never revisited the launch screen, so `#2a` stands. The design
system's older `ui_kits/studio` Library screen is secondary reference; where they
disagree `#2a` wins.

Compose from `components/core` (`Card`, `Button`, `Dialog`, `Input`, `Select`,
`IconButton`), tokens only. Thumbnails are rendered document content (data-driven
colors, exempt); surrounding chrome is not.

**What `#2a` actually specifies** (1180×720 frame — recorded here because the first
draft of this spec under-scoped it badly; the panel itself remains authoritative):

- 56px header: logo + "Vitrum Studio", a "Search panels & glass" field (~34px), a
  30px round account avatar.
- 210px `--paper-50` left nav (radius-10 rows): Panels (6) · Glass library (42) ·
  Cut lists · Versions · Settings — the launch screen is a **portal** with
  cross-document destinations, not only a grid.
- A **"Continue" hero card** (radius-16, 16px padding) for the in-flight panel:
  80×104 thumbnail, title, "edited 12 min ago · 128 panes · 24.6 m came", readiness
  pills ("Geometry complete"; "Glass 86%" with a conic-gradient dot at 86%; "2 checks
  to review" with a `--ruby-600` dot), then a primary `--ink-950` pill "Resume
  editing" and a secondary "Version history".
- "All panels" heading, segmented filters **Active / Fired / Archived** on a
  `--paper-100` track, and a `--cobalt-600` "New panel" pill.
- A 4-column grid (gap 16, cards radius 16, 120px thumbnail): name, "36 panes ·
  8.2 m came", a lifecycle badge (`--emerald-100` "Fired" / `--amber-100` "Awaiting
  glass" / `--ruby-100` "Breakage") and relative time.
- A trailing "Start a panel" card: "blank, template or photo".

The design's thesis is printed on it: _"opens on what's in flight, not an empty
grid."_ Three elements were new **domain** concepts rather than layout, so they were
taken to Mathieu rather than left to the implementer; all three are settled — see
Scope and Open questions 4–6. The lifecycle badge and its filters are the only part
of `#2a` deliberately absent from v1 (deferred to `F-061`); build the card and filter
row's geometry without them rather than re-flowing the design.

## Functional requirements

- FR-1: Startup shows the launch screen; opening the app _with_ a file (double-click
  / `open` / CLI arg) bypasses it into the editor; the crash-recovery prompt takes
  precedence over both.
- FR-2: The grid lists recents newest-first with thumbnail, name, dimensions,
  technique, last-opened; opening any entry loads that file. Missing files show the
  missing state with locate/remove; locate rebinds the entry to the new path.
- FR-3: The new-panel dialog validates dimensions (> 0, unit-aware, mono numerals),
  creates a project with the chosen settings/technique, and enters the editor with
  empty undo history; Cmd-N opens the same dialog from anywhere.
- FR-4: Drag-and-drop of a `.vitrum` file onto the launch screen opens it; invalid
  files produce a clear non-blocking error.
- FR-5: "Back to library" from the document chip menu honors the unsaved-changes
  guard; after returning, the file's entry shows an up-to-date thumbnail.
- FR-6: Thumbnails never render during save/snapshot paths (no editing hitch), are
  cached by path + mtime, and degrade to a neutral placeholder.
- FR-7: The recents store survives restarts, caps at a sane length (e.g. 50,
  oldest evicted), and never blocks startup on missing/slow disk entries.
- FR-8: The launch screen matches `#2a`'s chrome: 56px header and 210px nav rail with
  "Panels" live and the other four destinations visibly disabled and labelled with
  their feature ids — never silently absent, never fake-clickable.
- FR-9: The Continue hero shows the most-recently-edited panel with its real derived
  figures (panes, came metres, glass %, outstanding checks) and its readiness pills;
  "Resume editing" opens it, "Version history" opens it with the history panel active.
  With no recent panel, the hero is replaced by the empty state, not left blank.
- FR-10: Saving writes the panel's derived facts into its library entry, so grid cards
  show real panes/came figures without opening the files. An entry saved by an older
  build (no indexed facts) renders without them rather than erroring, and gains them
  on the next save.
- FR-11: The search field filters recents by name, case-insensitively, leaving the
  Continue hero in place; a query matching nothing shows a "no panels match" state
  distinct from the empty library.
- FR-12: "Start a panel → from a photo" creates the panel then runs F-051's
  reference-image import against it; cancelling the import leaves a valid empty panel,
  not a half-created document.

## Technical guidance

- The launch screen is a top-level app state (`library | editor`) above the shell's
  view modes — not a dock section, not a `viewmode.ts` entry. `AppShell` (or a thin
  wrapper) switches between `LibraryScreen` and the existing cockpit.
- Desktop: recents JSON in `userData`; file-open integration comes from Electron's
  `open-file` event (macOS) and `process.argv` (Windows/Linux) routed through
  `AppHost` so `packages/ui` stays Electron-free.
- Thumbnail rendering: reuse F-055's document→bitmap renderer; a shared
  `renderThumbnail(project)` should end up in one place consumed by both features.
- The editor currently boots with a scratch document; keep that path reachable in
  `pnpm dev:ui` (browser host can default to a "scratch" library entry) so component
  development doesn't grow a dialog-clicking ritual.

## Acceptance criteria

- Unit: recents store (add/evict/rebind/missing), new-panel validation, thumbnail
  cache keyed by path + mtime (fake fs/clock).
- Component: `LibraryScreen` states (populated, empty, missing file, search-no-match),
  the Continue hero (with and without a recent panel), the nav rail's live-vs-disabled
  split, and the new-panel dialog.
- E2E (Playwright, packaged app): launch → new panel via dialog → draw a segment →
  save → back to library → the entry is listed with a thumbnail and real panes figure
  → reopen it → content intact. Second E2E: launch with a file argument bypasses the
  library.
- Manual (Mathieu): macOS double-click a `.vitrum` file; drag-drop onto the launch
  screen; visual sign-off against `#2a` (lines 245–336 of the vendored design).

## Open questions

_All resolved by Mathieu 2026-08-06 — this spec is `agreed`._

1. **First save location for new panels** → **keep "Save-As decides".** A new panel
   is an unsaved document until the user chooses where it lives; no app-owned
   default folder. Files stay fully user-owned (local-first).
2. **Opening a panel while one is open** → **replace in the same window**, behind
   the existing unsaved-changes guard. Single-window for v1; multi-window would
   touch F-002's single-slot autosave/recovery design and is backlog.
3. **Surface unsaved scratch work in the library?** → **No** (my call, delegated).
   The autosave slot is a single recovery slot and F-002's startup recovery prompt
   already claims it, taking precedence over the launch screen (FR-1). A second
   entry point to resurrect the same unsaved state would create two paths with
   unclear precedence. The library stays a view over real files on disk; recovered
   scratch work enters it the moment the user saves it somewhere.

_Questions 4–6 arose after the first draft was written, when panel `#2a` was finally
read and found to contain three new domain concepts the spec had missed. Resolved by
Mathieu 2026-08-06:_

4. **How faithful is v1 to `#2a`?** → **Resume-first cut.** Build `#2a`'s real chrome
   and its thesis — header, nav rail (Panels live, four tagged disabled placeholders),
   the Continue hero in full, the grid geometry, New panel, Start a panel. Defer only
   the lifecycle taxonomy.
5. **Where does the lifecycle taxonomy belong?** → **Its own spec, `F-061`.** Active /
   Fired / Archived plus Awaiting glass / Breakage is real bench vocabulary but a
   persisted domain concept, and it must first settle whether a status is set by hand
   or derived, and whether any status gates anything. Out of F-058.
6. **How do grid cards know panes/came without opening files?** → **A save-time
   index** (the implementer's counter-proposal, better than either option offered):
   write the derived facts when the editor saves, because they are already computed
   then. Browse-time indexing was rejected — it would run F-020 detection across every
   file in the library.
7. **The two elements the first draft called non-goals** → **both in**, my call at
   Mathieu's delegation: the search field (name-only filtering, ~10 lines, and leaving
   it out makes the header visibly depart from the design) and "from a photo" (F-051
   already exists, so it is new-panel-then-import; it is the restoration on-ramp and
   brings the Start-a-panel card closer to the design's "blank, template or photo").
   Glass search and templates stay out.

## Implementation status

**Round 1 (2026-08-06) — paused on the `#2a` scope question, now resolved.** Branch
`f-058-panel-library`. The design-independent half is built and green (recents store,
new-panel validation, `LibraryController`, shared `renderThumbnail`, the
`library | editor` app state with FR-1 precedence, host + desktop wiring, `.vitrum`
association, drag-and-drop). `LibraryScreen.svelte` and `NewPanelDialog.svelte` from
that round are **provisional scaffolding written from spec prose, not a design
proposal** — the implementer could not reach the design (`DesignSync` is unavailable to
subagents; fixed by vendoring it, see [docs/design](../design/README.md)) and correctly
declined to invent one. Component and E2E tests were deferred with them.

**Round 2** builds the real `#2a` surface against the vendored design, per the
decisions above, and adds the deferred tests.

**Blocker.** Portal panel "2a" is materially wider than this spec's Scope/FR list. Three
of its elements are new domain concepts rather than layout, so they cannot be absorbed
silently: (1) a panel lifecycle taxonomy (Active / Fired / Archived, plus "Awaiting
glass" / "Breakage" states) — a new persisted concept absent from the whole roadmap;
(2) per-panel readiness and metadata (pane count, came metres, glass %, checks
outstanding) shown _without opening the file_ — derived from F-020/F-023/F-030/F-042 and
requiring a cached library index refreshed on save; (3) templates and "from a photo" as
creation paths — explicitly a non-goal above. The rest of 2a (portal left-nav with
cross-document destinations, search, a "Continue" hero card, segmented filters, the
4-column grid, a "Start a panel" cell) is layout and can be built once scope is agreed.

**Also recorded:** this session had no `DesignSync` access, so the implementing agent
could not read "2a" itself; the summary above came from the coordinating agent. Any
launch-screen work still needs a read of the canonical file before it is trustworthy.

Built so far, and independent of how 2a's scope lands:

- `@vitrum/model` `library.ts` — the pure recents store (`PanelEntry` / `PanelLibrary`,
  `recordPanelOpened` with cap + eviction, `forgetPanel`, `relocatePanel`,
  tolerant (de)serialization, `panelThumbnailKey(path, mtime)`, `createPanelProject`) and
  the `LibraryPort` interface. `StoragePort` gained `readFile(path)`.
- `@vitrum/core` `newPanel.ts` — `validateNewPanel`, unit-aware and pure.
- `packages/ui` — `LibraryController` (runes bridge, missing-state via `stat`, lazy
  thumbnails split `requestThumbnail` / `thumbnailUrl`), the shared
  `renderThumbnail` moved to `src/thumbnail.ts` and consumed by both F-055 and F-058,
  `DocumentController.{openPath,openBytes,newPanel,confirmDiscardIfDirty,onNewPanel,onSaved}`,
  the `library | editor` top-level state in `App.svelte` with FR-1 precedence
  (recovery → launch argument → launch screen), and a live "back to library" button
  replacing the inert TopBar placeholder.
- Hosts — `LibraryPort` + `launchScreen` / `initialFile` / `onOpenFile` / `filePathFor`
  on `AppHost`, implemented in `browserHost` (localStorage, plus a virtual disk so
  `pnpm dev:ui` can exercise the grid), `fakeHost`, and desktop main/preload
  (`userData/library/`, `VITRUM_LIBRARY_PATH` override, `open-file` + argv routing,
  `webUtils.getPathForFile` for drops, `.vitrum` file association).
- The shell now reads the _document's_ name and panel size instead of the hardcoded
  "Sample panel" placeholder, so what the new-panel dialog sets is what the cockpit shows.

`LibraryScreen.svelte` and `NewPanelDialog.svelte` exist as a **provisional** pass built
from this spec's prose before "2a" was read. Treat them as scaffolding, not as the design.

Gates: `pnpm lint`, `format:check`, `check` green; 1 210 unit tests pass (16 new model,
11 new core). Component tests and the two E2E flows are deliberately **not yet written** —
they would encode copy and roles that the scope decision may change.
