# F-001: Architecture & project scaffolding

|                |                 |
| -------------- | --------------- |
| **Phase**      | 0 — Foundations |
| **Status**     | done            |
| **Depends on** | —               |
| **Complexity** | M               |

## Summary

Establish the technology stack, repository layout, and engineering conventions that
every later feature builds on. Produces a running (empty) application shell plus the
tooling to keep quality high across many independent agent-implemented features.

## Proposed stack (decision for supervisor — see Open questions)

- **Platform**: web application, local-first (same positioning as Diafane: no install,
  works on tablets with stylus, works offline). A desktop wrapper (Tauri) can be added
  later without rework if the core stays browser-compatible.
- **Language**: TypeScript everywhere, `strict` mode.
- **UI**: React for panels/chrome; the drawing canvas is rendered imperatively
  (Canvas2D behind a thin renderer interface, so WebGL can replace it for F-053/F-054).
- **Build/test**: Vite, Vitest, Playwright for a small set of end-to-end smoke tests.
- **Monorepo** (npm workspaces or pnpm):

```
vitrum/
  packages/
    geometry/   # F-010: pure geometry kernel, zero DOM deps
    model/      # F-002: document model, commands, serialization
    drc/        # F-030+: rule engine + rule packs (depends on model+geometry)
  apps/
    studio/     # the React application
  docs/
```

The package boundaries are load-bearing: `geometry` and `model` must never import
from `apps/studio`, which keeps them unit-testable and keeps agents from entangling
domain logic with UI.

## Scope

- Monorepo scaffolding with the four workspaces above, shared tsconfig/eslint/prettier.
- `apps/studio` renders an app shell: menu bar, left toolbar, right inspector panel,
  central canvas area (empty), status bar (cursor coordinates placeholder, unit display).
- CI script (`npm run check`) running typecheck, lint, and tests across workspaces.
- A `CLAUDE.md` at the repo root describing conventions, the package dependency rules,
  and the feature-doc workflow from ROADMAP.md.

### Non-goals

- Any drawing functionality (F-011), persistence (F-002), or real canvas content (F-003).
- Deployment/hosting, accounts, or backend of any kind (nothing needs a server yet).

## Functional requirements

- FR-1: `npm install && npm run dev` starts the studio app; `npm run check` passes clean.
- FR-2: Package dependency direction is enforced (lint rule or eslint import boundary):
  geometry ← model ← drc ← studio; no back-edges.
- FR-3: The app shell is responsive down to tablet width and renders the four regions
  (toolbar, canvas, inspector, status bar).
- FR-4: `CLAUDE.md` documents stack, layout, commands, and the spec workflow.

## Acceptance criteria

- Fresh clone to running app in two commands, verified on macOS.
- A trivial unit test exists in each package and runs via `npm run check`.
- Importing `apps/studio` code from `packages/*` fails the lint step (prove with a
  temporary violation in a test).

## Open questions

1. **Confirm web/local-first over native desktop.** Tauri-from-day-one is the
   alternative if offline file handling in the browser (File System Access API is
   Chromium-only) feels too limiting. Recommendation: pure web now, Tauri later.
2. npm vs pnpm workspaces — any preference?
3. App working title is "Vitrum" (repo name). Confirm.

## Implementation notes

_Scaffolding implemented 2026-07-18. Open questions were resolved by Mathieu in
session, deviating from the proposal above:_

1. **Native desktop (Electron), not web-first.** Chosen partly for Playwright's
   first-party Electron support. `packages/ui` is kept strictly browser-compatible
   (lint-enforced, no Electron imports), so a web or Tauri build remains possible.
2. **pnpm** workspaces.
3. Name **Vitrum** confirmed.
4. **Svelte 5, not React** — per Mathieu's stated preference. The canvas-behind-a-
   renderer-interface principle is unaffected.
5. TypeScript 5.x strict for now; TS 7 (native compiler) once svelte-check support
   stabilizes (~TS 7.1).

_Delivered:_ pnpm monorepo (`packages/core`, `packages/ui`, `apps/desktop`) with
shared tsconfig/ESLint/Prettier; lint-enforced dependency direction
`core ← ui ← desktop` (FR-2, violation test performed); unit/component tests in each
package plus Playwright E2E launching the built Electron app; CI workflow for
trunk-based development on `main`; `CLAUDE.md` (FR-4). Package names differ from the
proposal: `core` will split into `geometry`/`model` when F-002/F-010 land.

_App shell (FR-3):_ the renderer is a four-region CSS-grid shell in
`packages/ui/src/shell/` — `MenuBar` (File/Edit/View/Help, inert until F-002),
`Toolbar` (placeholder tools, active tool highlighted; real tools in F-011), `Canvas`
(empty reference-grid surface reporting cursor position — real viewport is F-003),
`Inspector` (sample-panel properties + piece list), and `StatusBar` (live cursor
coordinates + mm/inch unit toggle). Unit conversion/formatting lives in
`packages/core/src/units.ts` so it stays UI-independent and tested. The shell is
responsive down to tablet width via a fixed toolbar, fluid canvas, and a clamped
inspector. Covered by component tests (`AppShell.test.ts`) and E2E
(`app.spec.ts`) asserting the four regions and the unit toggle.

All functional requirements (FR-1…FR-4) and acceptance criteria are met; status →
done. The KiCad-style four-region chrome now hosts later features without rework.

_Follow-up:_ the shell shipped with placeholder styling, before the Vitrum Design
System existed. F-004 vendors the design system and restyles this shell to the
`ui_kits/studio` Chrome (56px top bar, 220px sidebar, warm-paper neutrals).
