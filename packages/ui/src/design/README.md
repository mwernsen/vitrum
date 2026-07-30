# Vitrum Design System (vendored)

This directory is a **vendored copy** of the canonical Vitrum Design System, which
lives in the Claude Design project and is the single source of truth for visual
design. Do not hand-edit tokens or invent new ones here — changes flow
**design → repo**, never the reverse.

|                    |                                                                 |
| ------------------ | --------------------------------------------------------------- |
| **Source project** | `3c259295-607a-4eba-8cad-3890f7e80063` ("Vitrum Design System") |
| **Last synced**    | 2026-07-18                                                      |
| **Synced by**      | F-004                                                           |

## What's here

- `styles.css` — entry that `@import`s the token files, verbatim from source.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `effects.css` are
  **content-identical** to source. `fonts.css` is the one deliberate deviation:
  its Google Fonts `@import` is replaced with local `@font-face` declarations,
  because the desktop app must run offline (F-004 FR-3). See below.
- `index.ts` — the import surface for apps: pulls in `styles.css` (which imports
  `fonts.css`, so the fonts come with it). Import this once per entry point.
- `assets/` — `logo.svg` (Shard V, for light surfaces) and `logo-on-dark.svg`.

Ported components live one level up in `packages/ui/src/components/`, each next to
the `.prompt.md` brief and `.d.ts` contract it was ported from.

## Fonts (offline)

The source specifies Onest (a stand-in for the commercial TT Norms Pro) and Geist
Mono. Rather than fetch from Google Fonts at runtime, the woff2 files bundled by
`@fontsource-variable/onest` and `@fontsource-variable/geist-mono` are declared as
`@font-face` rules in `tokens/fonts.css`.

**Do not import those packages' own stylesheets.** They name their families
`"Onest Variable"` / `"Geist Mono Variable"`, which is not what the canonical
`--font-sans` / `--font-mono` tokens ask for — the mismatch silently drops the whole
UI to the OS fallback sans, and no screenshot reveals it (found by user test run
`docs/testing/runs/2026-07-29-a`, fixed 2026-07-29). `fonts.css` therefore declares
the faces under the canonical family names, and `src/design.fonts.test.ts` fails if
that bridge breaks. The oracle when auditing by hand: every entry of
`[...document.fonts]` reads `unloaded` and
`performance.getEntriesByType('resource')` contains no `woff2`.

When TT Norms Pro is licensed, swap the font files in `fonts.css` and update
`--font-sans` at the source, then re-sync.

## Re-sync procedure

The Claude Design project is canonical. When it changes:

1. Diff structure: `DesignSync list_files` on the source project, compare against
   this directory and `../components/`.
2. For each changed path, `DesignSync get_file` and update the vendored file or the
   ported Svelte component in **one PR**. Re-apply the `fonts.css` offline deviation
   (keep the CDN `@import` out).
3. Re-port any component whose `.jsx`/`.d.ts`/`.prompt.md` changed, preserving its
   prop contract; update its test.
4. Bump **Last synced** above to the new date.
5. Run `pnpm lint && pnpm check && pnpm test` — the raw-literal lint rule and the
   component tests guard against drift.

Never push from the repo back to the design project; `DesignSync` write methods are
not used by this repo.
