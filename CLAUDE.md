# Vitrum — conventions for implementing agents

Vitrum is a desktop application for stained glass design. Read [ROADMAP.md](ROADMAP.md)
for the product vision and the feature workflow; each feature has a spec in
`docs/features/`.

## Stack

- **Svelte 5** (runes) + **Vite** for the UI; **Electron** (via electron-vite) as the
  desktop shell. Decided by Mathieu 2026-07-18, superseding the web/React draft in F-001.
- **TypeScript 5.x strict** everywhere. TS 7 (native) migration is planned once
  svelte-check support stabilizes (~TS 7.1); see README.
- **pnpm workspace** monorepo. **Vitest** for unit/component tests,
  **Playwright** (`_electron`) for E2E, **ESLint** flat config + **Prettier**.

## Layout and dependency rules

| Package         | Role                                                          |
| --------------- | ------------------------------------------------------------- |
| `packages/core` | Pure domain logic + geometry. No DOM, no Svelte, no Electron. |
| `packages/ui`   | Svelte components. Browser-compatible; no Electron imports.   |
| `apps/desktop`  | Electron main/preload/renderer. Thin; delegates to `ui`.      |

Dependency direction is `core ← ui ← desktop`, enforced by `no-restricted-imports`
in [eslint.config.js](eslint.config.js) — do not weaken those rules. Later roadmap
features add packages (e.g. geometry kernel F-010, document model F-002); keep new
packages on the same principle: domain logic must be testable without a UI.

## Design system

All UI must follow the **Vitrum Design System** (Claude Design project
`3c259295-607a-4eba-8cad-3890f7e80063`; vendored into `packages/ui/src/design/` by
F-004). Non-negotiables for implementing agents:

- Style exclusively through the design tokens (`--paper-*`, `--ink-*`, `--cobalt-*`,
  `--space-*`, `--radius-*`, …) — no raw hex/px literals (lint-enforced once F-004
  lands). The vitrail palette is for glass data, tags, and status only; max one
  accent per view.
- Build screens from the ported `components/core` primitives; app chrome follows
  `ui_kits/studio` (56px top bar, 220px sidebar, warm-paper neutrals).
- Canvas boundary: chrome + canvas overlays (selection, snap markers, DRC markers)
  use tokens; rendered document content (glass, lead) is data-driven and exempt.
- Copy in sentence case, no emoji, no exclamation marks; numbers in mono. See the
  design project's `readme.md` for voice rules.
- Missing a design? Don't invent it in code — flag it to Mathieu so it's added to
  the Claude Design project first, then port it. The design project is canonical;
  changes flow design → repo via the re-sync procedure in
  `packages/ui/src/design/README.md`, never the reverse.

## Commands (run from the repo root)

```sh
pnpm dev           # Electron app, hot reload
pnpm dev:ui        # UI alone in a browser
pnpm lint          # ESLint
pnpm format:check  # Prettier (format with `pnpm format`)
pnpm check         # tsc + svelte-check, all packages
pnpm test          # Vitest (core + ui)
pnpm test:e2e      # builds the app, then Playwright drives Electron
```

## Workflow

- Trunk-based development: short-lived branches onto `main`, small PRs, CI green
  before merge. CI runs all of the commands above.
- Every change ships with tests at the right level: core logic → Vitest unit tests,
  components → Testing Library, user-facing flows → one Playwright E2E test.
- Feature work follows the spec workflow in ROADMAP.md: pick the lowest-numbered
  unblocked feature, resolve open questions with Mathieu first, update the spec's
  `Status` and add implementation notes when done.
