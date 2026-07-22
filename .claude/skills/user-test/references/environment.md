# Test environment dossier

Shared runtime facts for the `user-test` skill and the `user-tester` agent. Update this
file (not the skill or agent) when the app's runtime behavior changes.

## How the app runs under test

- Launch config `ui-dev` in `.claude/launch.json`: `pnpm dev:ui --port 5199 --strictPort`.
  The orchestrator starts it once via `preview_start {name: "ui-dev"}`; testers navigate to
  `http://localhost:5199` and never start or stop the server themselves.
- This is the **browser host** (`packages/ui/src/document/browserHost.ts`), not Electron.
  The renderer is identical to desktop; only the host ports differ (see limits below).

## State reset recipe (run before every feature)

```js
localStorage.removeItem('vitrum:autosave')      // the document autosave (base64 zip)
localStorage.removeItem('vitrum:glass-library') // the global glass library
```

then reload. Clearing the autosave **before** reloading also avoids the native
"Recover unsaved work…" `window.confirm` prompt, which automation cannot answer.

## Native dialogs — do not trigger them

`window.confirm` backs "Discard unsaved changes?" and "Recover unsaved work…?", and a
`beforeunload` prompt fires on reload/navigation while the document is dirty. Native
prompts are invisible to the browser tools and can wedge the session. **Never
force-reload while the document is dirty and an autosave exists** — a 2026-07-22 run
proved this wedges the Browser pane hard enough to take the managed dev server down
with it. Verify persistence by decoding `vitrum:autosave` instead (base64 zip;
`document.json` inside; deflate-raw entries) and mark the reload-and-recover flow
`env-limited`.

## Standing environment limits (mark `env-limited`, do not re-diagnose)

- **File open / import** (`.vitrum`, SVG, reference images, glass-library JSON) uses a
  native `<input type=file>` picker — not automatable from the page.
- **Save / save-as / every export** (PDF, SVG, DXF, CSV, PNG) triggers an anchor
  download — the click can be exercised and errors observed, but the produced file
  cannot be inspected.
- **Autosave** is localStorage (base64) — persistence across reload IS testable.
- **Packaged-build-only behavior** (`file://` quirks, e.g. the F-030 worker note) is out
  of reach; the DRC Web Worker works fine on the dev server and must respond.
- **Physical checks** in specs (print at 1:1, tape and measure) are `manual`, never
  attempted.

## Shell map (where things live)

Grid rows: menu / readiness / body / status.

- **TopBar** — title, view-mode switch (design/cartoon/…), zoom-fit, export, import.
- **ReadinessStrip** — workflow pills: piece count, unassigned glass, unnumbered, DRC
  error/warning/info counts. Prime textual oracle for canvas-side effects.
- **ActivityRail** — the sole panel switcher (sections: Layers, Glass, Rules, Make,
  Versions) → **DockPanel** renders the active section. Overlay/visibility toggles live
  in the Layers panel.
- **Canvas stage** — 2D `<canvas>` with the floating **Toolbar** card (offset past the
  rulers). **Inspector** on the right shows the current selection only and collapses
  when empty. **StatusBar**: cursor · grid/snap · zoom · units.
- Unbuilt roadmap surfaces exist as disabled placeholders tagged with their F-0XX id —
  a disabled placeholder is expected, not a bug.

## Canvas oracle strategy

The `<canvas>` is invisible to `read_page` — never claim a canvas assertion from the
accessibility tree alone. Verify drawing/selection/assignment effects through:
Inspector contents, StatusBar readouts, ReadinessStrip pills, dock panel lists
(Layers/Glass/Rules), and zoomed screenshots (`computer {action: "zoom"}`).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Cmd/Ctrl+Z / Shift+Z / Y | undo / redo |
| Cmd/Ctrl+S / Shift+S | save / save as |
| Cmd/Ctrl+O | open |
| Cmd/Ctrl+K | command/debug palette |
| L A B R C P | tools: line, arc, bezier, rectangle, circle, polygon |
| G | construction guide |
| (toolbar only) | panel border tool |
| Space / drag | pan; snap modifiers held during draw |
| Escape | cancel gesture / close dialog |

Tool keys are ignored while a modifier is held or during numeric entry.

## Selector guidance

Prefer role-based targeting (`read_page` refs, `find`) — the Electron E2E suite in
`apps/desktop/e2e/` drives everything through role locators like
`getByRole('toolbar', {name: 'Tools'})` and `getByRole('main', {name: 'Design canvas'})`;
a control that cannot be found by role + accessible name is an accessibility finding.
Pixel clicks (`computer` with coordinates) are for the canvas only. On macOS,
Ctrl+click becomes a right-click — never hold Ctrl to suppress snapping; toggle the
snap master instead.

Automation quirks observed in practice (2026-07-22 run):

- Synthetic Enter/Return does not finish a line gesture and Escape discards it
  silently — commit gestures by double-clicking the last point, and confirm via the
  Cmd+K debug palette's segment count before judging document state.
- `computer` ref-clicks can land on stale coordinates after Svelte re-renders —
  re-screenshot and click by fresh coordinates when a panel toggle seems to misfire.
- The readiness "Checks" pill is a cheap canvas oracle: one open line contributes 2
  dangling-end diagnostics per symmetry sector, so diagnostic counts quantify replica
  multiplicity without seeing the canvas.
