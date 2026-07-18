# F-004: Design system integration

|                |                 |
| -------------- | --------------- |
| **Phase**      | 0 — Foundations |
| **Status**     | draft           |
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

1. Font licensing: Onest/Geist Mono are the stand-ins for TT Norms Pro (commercial).
   Buy TT Norms Pro now or ship Onest until the brand is finalized? (Spec assumes
   Onest for now.)
2. Lucide packaging: `lucide-svelte` dependency (easy updates) vs inlined SVG subset
   (smaller, pinned)? Recommendation: `lucide-svelte`.
3. Should the `.prompt.md` component briefs be vendored into the repo too (agents
   working offline benefit), or always read from Claude Design? Recommendation:
   vendor them next to each ported component.
