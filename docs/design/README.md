# Vendored design screens

Design **screens** live here so implementing agents can read them from disk.

## Why this directory exists

The canonical designs live in Claude Design projects, and the `DesignSync` tool reads
them — but **`DesignSync` is only available in a main Claude Code session, not to
subagents**. F-058's implementing agent discovered this the hard way: it was pointed
at a design panel it had no way to open, and correctly stopped rather than inventing
one. A spec that cites a design panel is therefore only actionable if the panel is
vendored here first.

Rule for supervisors: **before handing a UI ticket to an agent, vendor the design it
cites into this directory** (main session: `DesignSync get_file` → write the file
here). Rule for agents: read designs from this directory; if the design a spec cites
is missing, stop and ask — do not improvise the surface, and do not treat "I can't
reach it" as "no design exists".

## What is vendored

| File                      | Source project                                                                      | Fetched    |
| ------------------------- | ----------------------------------------------------------------------------------- | ---------- |
| `portal-redesign.dc.html` | Portal redesign (`1ec655e3-ab21-4450-b3be-f2caaca64ea3`), `Portal redesign.dc.html` | 2026-08-06 |

`portal-redesign.dc.html` is the exact file content (887 lines). **Read only the panel
you need** — `Read` it with `offset`/`limit` from the map below rather than pulling the
whole 151 KB file into context. Line numbers are for the vendored copy and must be
re-checked after any re-fetch.

| Panel | Lines   | What it is                                                        |
| ----- | ------- | ----------------------------------------------------------------- |
| `#3a` | 69–98   | Layers rail panel — visibility, overlays, symmetry                |
| `#3b` | 99–128  | Glass rail panel — catalog & assignment                           |
| `#3c` | 129–163 | Rules rail panel — DRC engine & violations                        |
| `#3d` | 164–203 | Make rail panel — numbering, cutting list, BOM, export            |
| `#3e` | 204–244 | Versions rail panel — snapshots & restore                         |
| `#2a` | 245–336 | **Launch — resume & library. Canonical for F-058.**               |
| `#2b` | 337–476 | Cockpit editor — superseded by turn 3                             |
| `#1a` | 477–587 | Original launch — project library; superseded by `#2a`            |
| `#1b` | 588–675 | Workshop stages (Draw→Glass→Check→Produce) — explicitly abandoned |
| `#1c` | 676–790 | CAD cockpit — superseded by turn 3                                |
| `#1d` | 791–887 | Studio desk — superseded by turn 3                                |

- **turn 3** (`#3a`–`#3e`) — the editor cockpit's five rail panels. **Canonical for the
  editor IA**; implemented in `packages/ui/src/shell/`.
- **turn 2** — `#2a` the launch screen (canonical, F-058) and `#2b` the cockpit editor.
- **turn 1** (`#1a`–`#1d`) — three explored directions plus the original launch; kept
  for reference. `#1b`'s forced linear stages were dropped deliberately: the work isn't
  linear, and a per-facet readiness signal replaced them.

Turn 3 supersedes turns 1–2 **for the editor**; it never revisited the launch screen,
so `#2a` remains the design of record there (turn 2's own intro says it keeps turn 1's
launch).

## Reading it

Open the file directly to read markup and inline style values — that is what matters
for implementation, and it is self-describing. It will **not** render pixel-perfect in
a browser from this directory: it links tokens and a bundle from its own project's
`_ds/` folder. Those same tokens are already vendored for the app at
`packages/ui/src/design/tokens/`, which is what the implementation must use.

## Not vendored (fetch on demand)

- The **Vitrum Design System**'s `ui_kits/studio` and `ui_kits/website` screens
  (project `3c259295-607a-4eba-8cad-3890f7e80063`). The studio kit is secondary
  reference for chrome — superseded by Portal turn 3 where they disagree. Its tokens,
  logo assets and the 14 `components/core` briefs are already vendored into
  `packages/ui/src/design/` and `packages/ui/src/components/*.prompt.md` by F-004.

## Keeping this in sync

The Claude Design projects stay canonical — this is a read-only mirror, never edited
here. When a design changes, re-fetch the file, replace it wholesale, update the
Fetched date above, and note in the affected spec what changed. See
`packages/ui/src/design/README.md` for the token/component re-sync procedure.
