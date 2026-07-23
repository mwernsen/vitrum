# F-055: Versioning & sharing

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
| **Depends on** | F-002              |
| **Complexity** | M                  |

## Summary

Design history and hand-off: automatic version snapshots with visual browsing and
restore (Diafane parity), named manual versions ("client draft 2"), and packaged
sharing of a self-contained project file. Local-first: no accounts or server in this
feature.

## Scope

- Automatic snapshots on meaningful boundaries (time + command-count heuristics),
  stored compactly (delta vs full) in the app-data directory alongside the autosave.
- Version browser: thumbnail grid (small rendered previews), timestamps, named
  versions; restore (as a new undoable state) and "open copy".
- Manual "save version" with name/note.
- Share/export: the `.vitrum` file already is the sharing unit (F-002, self-contained
  incl. glasses and embedded images per F-022/F-051); this feature adds "export
  package for sharing" polish (optional watermark note) and a read-only "view mode"
  when opening someone else's file (explicit "edit a copy").

### Non-goals

- Cloud sync, realtime collaboration, accounts. Pattern marketplace. (All far-future;
  local-first architecture keeps them possible.)
- Per-snapshot embedding of reference-image asset bytes (photos/scans). Snapshots
  capture the document; asset bytes stay shared from the live session (see Decision §6).
- Glass-filled colour thumbnails; v1 thumbnails are lead-line linework (Decision §5).

## Functional requirements

- **FR-1 — Automatic snapshots.** While a document is dirty, the app records automatic
  snapshots on meaningful boundaries: a command-count threshold **or** a time threshold
  since the last snapshot, whichever comes first, and never when the document is
  unchanged since the previous snapshot. A session of ≥ 50 snapshots is retained and
  every one is restorable.
- **FR-2 — Exact restore & open-copy.** Restoring a snapshot yields a document
  **deep-equal** to the one captured. Restore replaces the working document as a single
  **undoable** step (Cmd-Z returns to the pre-restore state). "Open a copy" loads the
  snapshot as a fresh untitled document, leaving the current file untouched.
- **FR-3 — Manual named versions.** The user can save a manual version with a name and
  optional note at any time; it appears in the browser labelled and dated, and is never
  removed by automatic pruning.
- **FR-4 — Compact storage & pruning.** History is stored as keyframe-plus-delta and
  compressed, so a heavy working session stays under a sane budget (target < 50 MB).
  Pruning keeps every manual version and the most recent automatic snapshots (≥ 50),
  dropping the oldest automatic ones first.
- **FR-5 — Version browser.** The cockpit "Versions" dock section lists snapshots newest
  first with their timestamp, kind (auto/named), name/note, and a lazily-rendered
  thumbnail; it offers restore, open-copy, rename (name + note) and delete per entry,
  plus a "Save version…" action. Deleting a snapshot that a later delta depends on keeps
  every remaining snapshot restorable.
- **FR-6 — Lazy thumbnails.** Thumbnails are generated **lazily on browse** and cached to
  disk keyed by snapshot id — never rendered at snapshot/save time, so automatic
  snapshots add no editing hitch (Open question 1). A missing/failed thumbnail degrades
  to a neutral placeholder, never an error.
- **FR-7 — Share package.** "Export for sharing…" writes a self-contained `.vitrum` copy
  carrying no version history and no autosave state (both live outside the file), with an
  optional embedded share note. The working document and its own history are unchanged.
- **FR-8 — Read-only view mode.** Opening a file exported for sharing opens it in a
  read-only view (edits are inert, a banner explains why). "Edit a copy" detaches it into
  a fresh editable untitled document (history cleared, read-only flag dropped) so the
  original hand-off file is never overwritten in place.

## Design

No dedicated design exists in the Portal redesign project for the version browser; the
"Versions" dock section is an unbuilt placeholder scaffold (turn 3, 3d/3e). This feature
designs the panel in code per the Vitrum Design System: composed from `components/core`
primitives (`Button`, `Dialog`, `Input`, `IconButton`), styled through tokens only,
sentence-case copy, numbers in mono. It is a **dock section** (activated via the existing
activity-rail "Versions" entry), not new chrome, and is noted below for back-port to the
Claude Design project.

## Technical guidance

- App-data history is **not** part of the document/undo model → it follows the F-022
  storage pattern: a `VersionPort` on `AppHost` (stubbed in `browserHost`/`fakeHost`,
  `userData`-backed on desktop with a `VITRUM_VERSIONS_PATH` env override for E2E), plus a
  runes `VersionController` in `packages/ui`.
- Delta-vs-full storage: the spec's "lean on the command log where practical" is honoured
  in spirit by a **structural document delta** rather than the persisted semantic command
  log (Decision §3). Keep the diff/patch pure in `@vitrum/model` with a property test.
- Restore is a single `replaceProject` command so it is one undo entry (F-002 command
  pattern), keeping the store the sole mutator.

## Acceptance criteria

- Unit (core): property test that `applyProjectDelta(a, diffProject(a, b))` deep-equals
  `b` and that a round-trip through the archive (add → serialize → deserialize → resolve)
  reproduces every snapshot exactly (FR-2); pruning keeps all manual + ≥ 50 auto and
  every survivor resolves (FR-4); a ≥ 50-snapshot heavy session serializes well under the
  budget (FR-4).
- Unit (ui): `VersionController` auto-snapshots on the command/time thresholds and not on
  an unchanged document (FR-1); restore/open-copy/rename/delete behave (FR-2/FR-3/FR-5);
  read-only gating and edit-a-copy (FR-8); share-package strips history and carries the
  note (FR-7). `VersionsPanel` component test.
- E2E: save a named version, see it listed, edit the document, restore the version and
  confirm the document returns to the saved state; undo the restore.

## Open questions

1. Is snapshot thumbnails' rendering cost acceptable at save time, or generate lazily on
   browse?
   **Resolved 2026-07-22 (Mathieu): generate lazily on browse, cached to disk** — never
   at snapshot/save time, so auto-snapshots add no editing hitch and the storage budget
   (FR-4) is helped. See FR-6.

## Decisions (spec expansion, 2026-07-22)

Recorded per Mathieu's authorisation to expand this Phase-5 draft in-session.

1. **History is per-document, keyed by file path.** The `VersionPort` is keyed by a
   document key derived from the open file path (an unsaved document uses the `scratch`
   key; saving adopts the path's key). This mirrors autosave's single-file model while
   still separating histories of different files. Cross-rename history migration is a
   follow-up.
2. **Auto-snapshot heuristic.** Snapshot when ≥ 24 commands have been executed since the
   last snapshot, or ≥ 90 s have elapsed while dirty, whichever first; skip if the
   document is byte-identical to the last snapshot. Manual "save version" always
   snapshots immediately. Thresholds are controller constants, easily tuned.
3. **Structural delta, not the persisted command log.** The `DocumentStore` does not
   expose its semantic command log, and persisting it would be a larger cross-feature
   refactor. A generic structural JSON delta over the `Project` gives equivalent
   compactness (only changed entities travel) with a provable exact-restore property, so
   it is used instead. This is a deviation from advisory technical guidance, not an FR.
4. **Keyframe + delta chain.** Snapshots form a linear chain; every Nth (N = 10) is a full
   keyframe, the rest deltas against the previous snapshot. Restore resolves from the
   nearest keyframe forward. Add/delete/prune are expressed as "resolve all → transform
   the list → rebuild", which is O(n) over a small n (≤ ~150) and trivially correct.
5. **Thumbnails are lead-line linework.** v1 thumbnails render the (symmetry-expanded)
   output network as dark linework on paper, fit to bounds — cheap, recognizable, robust
   under jsdom (degrades to a placeholder). Glass-filled colour thumbnails are a follow-up.
6. **Snapshots store the project only, not reference-image asset bytes.** Asset bytes are
   large (fighting the < 50 MB budget) and content-addressed; a restored snapshot reuses
   whatever assets the live reference session still holds. A layer whose asset was removed
   shows the standard missing-image placeholder. Documented limitation.
7. **Read-only via a document flag.** Export-for-sharing sets `settings.sharedReadOnly`
   (and optional `settings.shareNote`) on the exported copy. Opening a file with the flag
   enters read-only mode; "edit a copy" clears the flag into a fresh untitled document.
   No accounts are involved.

## Implementation notes

_Delivered 2026-07-22._ Spec expanded in-session (Decisions above) per Mathieu's authorisation;
Open question 1 resolved lazy-on-browse.

**`@vitrum/model` — pure version core (`versions.ts`).**

- **Structural delta** `diffProject`/`applyProjectDelta`: a generic recursive JSON patch (`$set` for
  primitives/arrays/type-changes, `$obj`/`$del` for objects), so only changed entities travel. A
  fast-check property test proves `apply(a, diff(a, b))` deep-equals `b` over arbitrary projects
  (FR-2). Chosen over persisting F-002's semantic command log, which the store doesn't expose
  (Decision §3) — a recorded deviation from advisory guidance, not an FR change.
- **Keyframe + delta archive** (`VersionArchive`): full snapshot every `KEYFRAME_INTERVAL` (10), the
  rest deltas against the previous snapshot; `resolveSnapshot` walks the nearest keyframe forward.
  `addSnapshot`/`deleteSnapshot`/`pruneArchive` use a "resolve-all → transform → rebuild" pattern so
  a deleted base never strands a dependent delta (FR-5). `serializeArchive` deflates the whole thing
  with `fflate` (reused from F-051's container) — a 60-snapshot / 2 000-segment session is < 5 MB,
  far under the 50 MB budget (FR-4). `pruneArchive` keeps every manual version and the most recent
  `DEFAULT_MAX_AUTO_SNAPSHOTS` (100 ≥ 50) auto ones (FR-4).
- **Sharing helpers** `sharedProject`/`isReadOnly`/`editableCopy` operate on new
  `ProjectSettings.sharedReadOnly` / `shareNote` fields (Decision §7).
- **`VersionPort`** (per-document, keyed by file path or `scratch`) mirrors F-022's `GlassLibraryPort`
  split; `replaceProject` command added to `commands.ts` for undoable restore.
- **No schema bump.** `sharedReadOnly`/`shareNote` are optional additive settings, so a pre-F-055
  file loads unchanged and no migration is needed (avoids churn/merge-conflicts on
  `CURRENT_SCHEMA_VERSION` with the parallel F-054/F-056 work); `mergeSettings` was widened to carry
  the new fields through `updateSettings`.

**`packages/ui`.**

- **`VersionController`** (`versions/controller.svelte.ts`): runes bridge that mirrors the archive,
  owns the auto-snapshot heuristic (≥ 24 changes or ≥ 90 s while dirty, skipping an unchanged doc —
  Decision §2), and the user ops. Restore re-enters the document through
  `DocumentController.restoreProject` → one `replaceProject` command (single undo step, FR-2). Clock
  and id generator are injectable for deterministic tests.
- **Thumbnails** (`versions/thumbnail.ts`) are lead-line linework of the symmetry-expanded output
  network, rendered lazily via a split `requestThumbnail` (side-effecting, called from a panel
  `$effect`) + `thumbnailUrl` (pure read) so the template never mutates reactive state; cached to
  disk through the port (FR-6). Degrades to a neutral placeholder under jsdom (`getContext` null).
- **`DocumentController`**: `readOnly` rune gates `execute`/`undo`/`redo` (and the debug helpers,
  rerouted through `execute`) so a shared file can't be edited in place; `open`/`recover` set it from
  the document flag; `editCopy` detaches an editable untitled copy (FR-8); `exportForSharing` writes
  a flagged copy via `saveFileAs` without touching the working doc (FR-7).
- **UI surface**: the "Versions" dock section is now live (`dock.ts`), rendered by the new
  `shell/VersionsPanel.svelte` — a design-system panel (Button/Dialog/Input/IconButton, tokens only)
  with save/rename/share/delete dialogs, restore + open-copy per row, and a read-only banner. A slim
  read-only banner also floats over the canvas stage in `AppShell`. Wiring lives in `App.svelte`
  (controller) and `AppShell` (two effects: `useDocument` on path change, `onChange` per command).

**Net-new screen for back-port.** `VersionsPanel` has no design in the Portal redesign project (the
"Versions" section was a placeholder scaffold). Built in code per the design system; flag for
back-port to the Claude Design project.

**Hosts.** `AppHost.versionStore` (named to avoid clashing with the preload's existing `versions`
version-strings) is implemented in `browserHost` (localStorage, base64), `fakeHost` (in-memory maps),
and desktop main (`userData/versions/<key>/archive.zip` + `thumbs/<id>.png`, with
`VITRUM_VERSIONS_PATH` for E2E isolation).

**Verification.** `pnpm lint`, `format:check`, `check` green; 990 unit tests pass (14 model version
tests incl. the delta property test + budget test; 12 `VersionController`; 6 `VersionsPanel`; 3 new
`DocumentController` sharing/read-only tests). New E2E `versions.spec.ts` (save named version → list →
edit → restore → undo) green.

**Incidental (disclose):** `pnpm format:check` was already red on `main` for three docs committed
un-prettified by the F-053 / user-test work (`F-053-realistic-render.md`,
`docs/testing/runs/2026-07-22-a/{F-052,SUMMARY}.md`); formatted them so the root gate passes. Pure
whitespace, unrelated to F-055 — drop from the PR if preferred.

**Follow-ups (out of scope):**

- History key does not migrate when a document is renamed / saved-as to a new path (Decision §1);
  the old path keeps its history. A rename-follow / merge is future work.
- Glass-filled colour thumbnails (v1 is linework, Decision §5).
- Snapshots don't embed reference-image asset bytes (Decision §6) — a restored layer whose asset was
  since removed shows the missing-image placeholder.
- Pruned auto snapshots leave their cached thumbnail files on disk (orphaned); a cleanup sweep is a
  minor future nicety.
