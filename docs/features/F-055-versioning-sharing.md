# F-055: Versioning & sharing

|                |                                      |
| -------------- | ------------------------------------ |
| **Phase**      | 5 — Power features                   |
| **Status**     | draft (expand before implementation) |
| **Depends on** | F-002                                |
| **Complexity** | M                                    |

## Summary

Design history and hand-off: automatic version snapshots with visual browsing and
restore (Diafane parity), named manual versions ("client draft 2"), and packaged
sharing of a self-contained project file. Local-first: no accounts or server in this
feature.

## Scope

- Automatic snapshots on meaningful boundaries (time + command-count heuristics),
  stored compactly (delta vs full, using F-002's command log where practical) in
  the app-data directory alongside the autosave.
- Version browser: thumbnail grid (small rendered previews), timestamps, named
  versions; restore (as a new undoable state) and "open copy".
- Manual "save version" with name/note.
- Share/export: the `.vitrum` file already is the sharing unit (F-002, self-contained
  incl. glasses and embedded images per F-022/F-051); this feature adds "export
  package for sharing" polish (strip autosave/history, optional watermark note) and
  a read-only "view mode" when opening someone else's file (explicit "edit a copy").

### Non-goals

- Cloud sync, realtime collaboration, accounts. Pattern marketplace. (All far-future;
  local-first architecture keeps them possible.)

## Functional requirements (sketch — refine at expansion)

- FR-1: Restore any of ≥50 snapshots of a working session; document equals the
  snapshot exactly.
- FR-2: History storage for a heavy session stays under a sane budget (target
  <50 MB) via deltas/pruning.
- FR-3: Shared package opens on a clean profile with identical rendering and no
  history leakage.

## Open questions

1. Is snapshot thumbnails' rendering cost acceptable at save time, or generate
   lazily on browse?
