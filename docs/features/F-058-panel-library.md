# F-058: Panel library & launch screen

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
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
  design first) → [F-060](F-060-pattern-templates.md), now specced as parametric
  generators. The "Start a panel" card should leave room for the third path.
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

**Round 2 (2026-08-06) — delivered.** Built the real `#2a` surface against the vendored
design and added the deferred tests. Status → `done` pending Mathieu's visual sign-off and
the two manual OS checks below.

### What shipped

**`@vitrum/model` — `library.ts`** (pure, no DOM/Svelte/Electron):

- Recents store: `PanelEntry` / `PanelLibrary`, `recordPanelOpened` (front-insert, dedupe
  by path, cap at 50 with oldest-evicted), `forgetPanel`, `relocatePanel` (absorbs a
  duplicate at the destination so "locate" can never leave two), `panelThumbnailKey(path,
mtime)`, and a deliberately tolerant `deserializePanelLibrary` — malformed JSON or a bad
  entry yields an empty library / drops that entry, because the library must never block
  startup (FR-7).
- **Save-time index** (FR-10): `PanelFacts` = `{ panes, paintedPanes, leadLengthMm,
checksOutstanding, checksRun }`. Raw counts, not percentages, so the surface derives
  "Glass 86%" and "geometry complete" and the presentation can change without a migration.
  `panelEntryFor(path, project, at, facts?)` stamps `lastSavedAt` **only** when facts are
  passed, so merely opening a panel never claims it was edited. `recordPanelOpened` merges
  over the previous entry, so re-opening keeps the figures from the last save.
  Back-compat is explicit: a half-written `facts` block is dropped **wholesale** rather
  than half-trusted, and an entry from a pre-index build renders without figures.
- `panelMatches(entry, query)` for search (FR-11): name plus file name, case-insensitive.
  Not the rest of the path, which would match far too much.
- `LibraryPort` (load/save/stat/loadThumbnail/saveThumbnail) — the F-022 / F-055 pattern.
  `stat` returns `mtimeMs | null` per path: one call yields both the missing state (FR-2)
  and the thumbnail cache key (FR-6).
- `StoragePort` gained optional `readFile(path)`. Dialog-only file access cannot serve a
  library that opens by path, a launch argument, or a drop.

**`@vitrum/core` — `newPanel.ts`**: `validateNewPanel`, unit-aware, comma decimals
accepted, per-field messages, `MAX_PANEL_MM` sanity ceiling. In `core` not `model` because
it is unit conversion; the `NewPanelSpec` the caller assembles is the model's own type.

**`packages/ui/src/library/`**:

- `LibraryScreen.svelte` — the real `#2a`: 56px header (logo, wordmark, "Studio", 220px
  search field, 30px avatar), 210px `--paper-50` rail, the Continue hero (80×104
  thumbnail, mono figure line, readiness pills including the conic-gradient glass dial,
  "Resume editing" / "Version history"), "All panels" + the inert filter row + the
  `--cobalt-600` "New panel" pill, the 4-column grid, and the "Start a panel" cell. Tokens
  only; the design's raw `#fff` became `--paper-0`, its `-0.02em` wordmark tracking became
  `--tracking-tight` (matching the cockpit's own wordmark), and its 3px dial radius became
  `--radius-xs`.
- `rail.ts` — the nav destinations, mirroring `shell/dock.ts` / `viewmode.ts`. "Panels"
  live; the other four disabled with a tooltip. **See the follow-up on their tags below.**
- `format.ts` — `relativeTime` in the design's own vocabulary ("12 min ago", "5d ago",
  "2w ago"), `panelFigures` ("36 panes · 8.2 m came", and "seam" for a foil panel, where
  "came" would simply be wrong), `readinessPills`, `editedAt` (prefers the last save).
  Plain TS so the `Date` arithmetic stays out of a Svelte module, where
  `svelte/prefer-svelte-reactivity` rightly objects to raw `Date` instances.
- `controller.svelte.ts` — `LibraryController`: `hero` (most recently edited, **skipping a
  missing file**), `gridRows` (everything but the hero, narrowed by the query — the design
  shows the in-flight panel once), `noMatches` as a state distinct from an empty library,
  `recordSaved`, and lazy thumbnails via the F-055 `requestThumbnail` / `thumbnailUrl`
  split. Search deliberately does **not** touch the hero: filtering the grid must not move
  the thing you were working on out from under you.
- `NewPanelDialog.svelte` — name / width × height / units / technique, errors held back
  until first submit, mono numerals, plus the "A photo or scan to trace" checkbox (FR-12),
  hidden on a host that cannot import images.

**Wiring.** `DocumentController` gained `indexFacts` (set by the shell, read on the save
path only — mirroring `onBeforeSave` / `collectAssets`), `onSaved`, `openPath`,
`openBytes`, `newPanel`, `confirmDiscardIfDirty`, `onNewPanel`; `open()` now reports
cancellation. `AppShell` supplies `indexFacts` from data it already computes for the
editor — which is the whole argument for indexing at save rather than at browse — using the
same three judgements as `ReadinessMeter`, so the library and the cockpit can never
disagree about whether a panel is ready. `App.svelte` owns the `library | editor` state and
FR-1 precedence (recovery → launch argument → launch screen).

**Hosts.** `library` / `launchScreen` / `initialFile` / `onOpenFile` / `filePathFor` on
`AppHost`; desktop main writes `userData/library/` (`VITRUM_LIBRARY_PATH`), routes
`open-file` + argv, and `webUtils.getPathForFile` resolves drops (`File.path` is gone in
Electron 43). `browserHost` adds a small localStorage virtual disk so `pnpm dev:ui` can
exercise the grid end to end; it opens on the **editor** by default so component work needs
no click-through, with `?library` to opt in.

### Deviations from the design, and why

1. **Lifecycle badges and filters are absent** — deferred to `F-061` per Open question 5.
   The card and filter-row geometry are built; the filter row is disabled with a tooltip
   naming F-061, and the card's badge slot carries technique · dimensions instead. The
   design's layout is not re-flowed.
2. **Search reads "Search panels", not "Search panels & glass"** — glass search is out
   (Open question 7), and a placeholder promising it would be a lie.
3. **"Start a panel" reads "blank or photo"**, not "blank, template or photo" — templates
   are `F-060`. The two paths are offered inside the new-panel dialog rather than as two
   cards, which keeps `#2a`'s single-cell geometry.
4. **Nav-rail counts are real** (recents count, glass-catalog size) rather than the
   design's sample 6 / 42.
5. **The card's figure line is omitted, not zeroed**, for an entry with no indexed facts.

### Net-new for back-port

`LibraryScreen` is a faithful build of `#2a` rather than a new screen, but three details
were designed in code and should be back-ported: the **missing-file card state**
(`File not found` + locate / remove — `#2a` never shows one), the **"no panels match"**
search state, and the **disabled-with-tooltip treatment** of the four rail placeholders.

### Verification

All five gates green from the repo root: `pnpm lint`, `format:check`, `check`, `test`
(**1 264 unit tests**, 161 files), `test:e2e` (**32 Playwright tests**).

New tests: 25 model (`library.test.ts` — store, index, back-compat, search), 11 core
(`newPanel.test.ts`), 24 `format.test.ts`, 14 `LibraryScreen.test.ts` (chrome, grid, hero,
search — every state the acceptance criteria name), 7 `NewPanelDialog.test.ts`. New E2E
`library.spec.ts`: the full round trip (launch screen → new panel → draw a closed border →
save → back to library → the hero shows **"1 pane"**, which is the assertion that proves
FR-10 end to end, since the figure comes from the library entry and not the open document →
reopen → 4 segments intact), plus the file-argument bypass (which really launches Electron
with the path in `argv`).

**Pending Mathieu:** visual sign-off against `#2a` (lines 245–336); macOS double-click a
`.vitrum` file; drag-and-drop onto the launch screen. The last two need a packaged,
file-associated install and a real OS drag, neither of which Playwright can drive.

### Follow-ups (out of scope)

- **The four rail placeholders have no roadmap ids.** They are cross-document _destinations_
  (Glass library, Cut lists, Versions, Settings) and nothing on the roadmap owns them, so
  each is tagged with the feature that owns the capability _inside the editor_ today
  (F-022 / F-042 / F-055) and Settings says only "Not built yet". If `#2a`'s portal is the
  intended direction, these want specs of their own — flagged rather than invented.
- Opening a second instance with a file (Windows/Linux double-click while running) creates a
  second window; `requestSingleInstanceLock` + `second-instance` routing is unimplemented.
  macOS is handled via `open-file`.
- The Continue hero reads indexed facts, so a panel edited-but-not-saved shows its
  last-saved figures. Correct, but a "unsaved changes" hint on the hero would be kinder.
- A pruned thumbnail leaves its cached PNG on disk (the same orphan issue F-055 noted).

### Incidental fixes (disclose — unrelated to F-058, drop from the PR if preferred)

- **`pnpm check` was red on `main`.** Commit `b9423cc` added `process.env.VITEST_COVERAGE`
  to `packages/geometry/src/intersect.test.ts`, a package that deliberately ships no
  `@types/node`. Narrowed off `globalThis` in a local helper. _(Isolated as its own commit
  for cherry-picking.)_
- **`e2e/nesting.spec.ts` was red on `main`** — verified by running it on `f192c84~1`. It
  asserted the nest controls live in the Inspector, which nest view hides; they are in the
  dock's widened `wide` mode, and its "Reshuffle" button is called "Try another layout".
  Re-pointed the locators. **Note for F-001:** its cockpit-v2 table still says "F-057 nest
  controls → the inspector"; the code disagrees and the code is right (the sheet table needs
  the column width). That line is stale.
- **E2E app-data isolation.** The launch screen made every spec read the panel library at
  boot, which would have read and written the developer's real `userData/library` and made
  startup order-dependent between specs. Added `e2e/appdata.ts` `isolatedAppData()` — a
  fresh `mkdtemp` root per launch — spread into all 25 launching specs, plus a run-wide
  backstop in `playwright.config.ts` for the next spec that forgets. Verified: no
  `userData/Vitrum` directory is created by a full run.
- `e2e/editor.ts` `editorWindow(app)`: the 24 editor specs now step past the launch screen
  via the new-panel dialog, whose defaults (300 × 400 mm, lead) match the panel the editor
  used to boot with. `VITRUM_SAVE_AS_PATH` added to main so an E2E can save a `.vitrum`
  without the native dialog — the same override idiom the export handlers use.
- `App.test.ts` / `app.spec.ts` expectations moved from `Sample panel` to the document's
  real name: the shell reads `Project.settings` now, which is FR-3 working.
