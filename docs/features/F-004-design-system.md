# F-004: Design system integration

|                |                 |
| -------------- | --------------- |
| **Phase**      | 0 — Foundations |
| **Status**     | done            |
| **Depends on** | F-001           |
| **Complexity** | M               |

## Summary

Bring Mathieu's **Vitrum Design System** (Claude Design project
`3c259295-607a-4eba-8cad-3890f7e80063`, "Vitrum Design System") into the codebase as
the single visual source of truth: vendor the tokens and assets, port the core
components to Svelte 5, and enforce that all UI is built from them. Every UI-facing
feature after this one implements its screens against this system — the spec
template's **Design** section names the applicable components/screens.

## The source (canonical, lives in Claude Design)

- `tokens/*.css` + `styles.css` — CSS custom properties: paper/ink neutrals, cobalt
  action accent, the **vitrail palette** (ruby/amber/emerald/violet/cobalt — reserved
  for glass-color data, tags, status), 4px spacing scale, radii, shadows, Onest +
  Geist Mono type ramp.
- `components/core/` — Button, IconButton, Input, Select, Checkbox, Radio, Switch,
  Card, Badge, Tag, Tabs, Dialog, Toast, Tooltip as reference JSX, each with a
  `.d.ts` prop contract and a `.prompt.md` implementation brief.
- `ui_kits/studio/` — the product chrome itself: 56px top bar, 220px left sidebar,
  warm-paper chrome; **Library** (project grid, new-panel dialog) and **Editor**
  (canvas + glass palette + panes list + inspector) screens. F-001's app shell and
  the panels in F-013/F-022/F-023/F-030 must match these.
- `guidelines/`, `readme.md` — brand voice (sentence case, mono eyebrows, no emoji),
  color rules (max one accent per view), animation rules (120–220ms, opacity/
  transform only).
- `ui_kits/website/` — marketing site kit; **not** consumed by this repo.

## Scope

- **Vendor** `tokens/*.css`, `styles.css`, and `assets/logo*.svg` into
  `packages/ui/src/design/` verbatim (tokens are framework-agnostic CSS). Record the
  sync date + source project ID in a header comment.
- **Port** the 14 core components to Svelte 5 in `packages/ui/src/components/`,
  preserving each component's name, props, variants, and states per its `.d.ts` and
  `.prompt.md` (the JSX is reference, not target — no React in this repo).
- **Offline-first packaging**: the desktop app must not fetch at runtime. Bundle the
  Onest and Geist Mono font files locally (Google Fonts download, OFL-licensed) and
  ship Lucide icons via the `lucide-svelte` package or inlined SVGs — replace the
  design system's CDN references.
- **Component gallery**: a dev-only route in `packages/ui` (`pnpm dev:ui`) rendering
  every ported component in all variants/states, for side-by-side visual comparison
  against the Claude Design specimens.
- **Enforcement**: lint rule (stylelint or ESLint) rejecting raw color literals and
  off-scale spacing values in `packages/ui` and `apps/desktop` styles — tokens only.
- **Canvas boundary rule** (documented in CLAUDE.md): app chrome and canvas _overlay_
  colors (selection highlight, snap markers, DRC severity markers) come from design
  tokens (semantic + vitrail); _document content_ colors (rendered glass, lead lines)
  come from document data and are out of the design system's jurisdiction.
- **Re-sync procedure** documented at the top of `packages/ui/src/design/README.md`:
  the Claude Design project is canonical; on design updates, re-read via DesignSync
  (`list_files` → `get_file` diff), update vendored files and affected components in
  one PR, bump the recorded sync date.

### Non-goals

- The marketing website (`ui_kits/website`) — separate deliverable, not this repo.
- Automated CI sync against Claude Design (needs auth in CI; manual re-sync is fine).
- New components or visual redesigns — gaps in the system go back to the design
  project first, then get ported.

## Functional requirements

- FR-1: Vendored token files are content-identical to the source project at the
  recorded sync date; all component styles resolve exclusively through tokens.
- FR-2: Each ported component matches its `.d.ts` contract (props, variants, events)
  and renders visually equivalent to the Claude Design specimen (gallery comparison).
- FR-3: The app runs fully offline: no CDN/network requests for fonts, icons, or
  styles (assert in the Playwright E2E by failing on external requests).
- FR-4: The raw-color/spacing lint rule fails CI on violation (prove once with a
  deliberate violation, then remove).
- FR-5: The existing F-001 app shell (`packages/ui/src/shell/`) is restyled to the
  `ui_kits/studio` Chrome: 56px top bar, 220px sidebar, paper-neutral chrome,
  sentence-case labels; its component and E2E tests stay green.

## Acceptance criteria

- Gallery review with Mathieu: every component side-by-side with its Claude Design
  specimen, approved.
- `pnpm test:e2e` includes the offline assertion (FR-3).
- A follow-up screenshot of the app shell is visually consistent with the
  `ui_kits/studio` Library screen's chrome.

## Open questions

_Resolved by Mathieu 2026-07-18:_

1. **Fonts: ship Onest + Geist Mono** (OFL stand-ins) now; swap to TT Norms Pro once
   the brand is finalized. Tokens keep it a one-file change.
2. **Icons: `lucide-svelte`** dependency (easy updates, tree-shaken).
3. **Vendor the `.prompt.md` briefs** into the repo, next to each ported component.

## Implementation notes

_Implemented 2026-07-18._

**Delivered:**

- **Tokens vendored** verbatim into `packages/ui/src/design/tokens/` (`colors`,
  `typography`, `spacing`, `effects`) + `styles.css`; kept byte-identical to source
  and Prettier-ignored so the repo never reformats them (FR-1). Sync metadata +
  re-sync procedure in `packages/ui/src/design/README.md`.
- **All 14 components ported** to Svelte 5 in `packages/ui/src/components/`, each with
  its verbatim `.prompt.md` and a Testing Library test. React inline-style + hover
  state became scoped CSS with `:hover`/`:checked`/`data-*` variants; token-only
  colors; prop contracts match each `.d.ts`.
- **Component gallery** at `packages/ui/gallery.html` (`pnpm dev:ui` → `/gallery.html`)
  renders every component in its variants for specimen comparison.
- **App shell restyled** to `ui_kits/studio` chrome (FR-5): 56px paper top bar with
  the Shard-V logo, wordmark, Draft badge, Lucide icon actions and avatar; token-only
  throughout; the four regions and their tests stay green.
- **Offline-first (FR-3):** fonts self-hosted via `@fontsource-variable/onest` +
  `@fontsource-variable/geist-mono` (bundled woff2, no CDN); a Playwright E2E test
  fails on any external http(s) request.

**Deviations / decisions to flag:**

- **Lint gate is color-only, not spacing (FR-4).** The rule (stylelint `color-no-hex`,
  wired into `pnpm lint`, proven with a deliberate violation) hard-gates raw hex —
  the load-bearing "colors via tokens" guarantee. A strict "no raw px" rule was
  **not** added: the canonical components themselves use off-scale control-internal
  px (e.g. button padding `9px 20px`, 5–10px gaps), so enforcing spacing tokens would
  force unfaithful ports. `--space-*` remains a soft convention for layout. This
  softens the "no raw hex/px literals" line in CLAUDE.md — worth a second look if you
  want px enforced too.
- **`fonts.css` is the one non-verbatim token file** — its Google Fonts `@import` is
  removed for offline; noted in-file and in the design README.
- **Toast action color:** source uses a raw `#9db6f5`; substituted `var(--cobalt-100)`
  (nearest token on dark) to keep the no-hex rule. Candidate for a real token.
- **Component porting was parallelized across subagents**, which did not have
  `DesignSync` access; their `.prompt.md` and two visuals were reconciled against the
  canonical source afterward (Tabs → underline, Toast → dark snackbar, Radio → white
  face + ink dot, Select → `string | {label,value}` options).

**Remaining for `done` → acceptance:** the gallery has been screenshot-verified by me
and is visually consistent with the specimens, but the **side-by-side gallery review
with Mathieu** (acceptance criterion 1) is still owed. Status set to `done` pending
that sign-off.
