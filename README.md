# Vitrum

Desktop application for stained glass design, built with Svelte 5 and Electron.

## Structure

pnpm workspace monorepo:

| Package         | Purpose                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `packages/core` | Pure TypeScript domain logic (panels, glass pieces, geometry). No UI dependencies. |
| `packages/ui`   | Svelte 5 components. Can run standalone in a browser for fast iteration.           |
| `apps/desktop`  | Electron shell (main, preload, renderer) built with electron-vite.                 |

## Getting started

```sh
pnpm install
pnpm dev        # Electron app with hot reload
pnpm dev:ui     # UI only, in the browser
```

## Quality gates

Every change must pass all of these (CI enforces them on every push and PR):

```sh
pnpm lint          # ESLint (flat config, TypeScript + Svelte)
pnpm format:check  # Prettier
pnpm check         # tsc + svelte-check per package
pnpm test          # Vitest unit/component tests (core + ui)
pnpm test:e2e      # Playwright driving the built Electron app
```

## Workflow: trunk-based development

- `main` is the trunk and is always releasable.
- Work in short-lived branches (hours to a couple of days), merged via small PRs.
- Every PR runs the full quality gate; merge only on green.
- New code ships with tests: domain logic in `core` gets unit tests, components in
  `ui` get Testing Library tests, and user-facing flows get a Playwright E2E test.
- Prefer feature flags over long-lived branches for incomplete work.

## TypeScript

The repo uses stable TypeScript 5.x. TypeScript 7 (the native compiler) is stable
since July 2026, but Svelte template type-checking against it is still experimental.
Once `svelte-check` support stabilizes (expected with TS 7.1), switch by updating the
`typescript` dependency and adding `--tsgo` to the `check` script in `packages/ui`.
