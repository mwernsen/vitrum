<script lang="ts">
  import { formatLength, type LengthUnit, type SnapKind } from '@vitrum/core'
  import Table from 'lucide-svelte/icons/table'

  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { SnapController } from '../tools/snap.svelte'

  interface Props {
    viewport: ViewportController
    /**
     * The snapping controller (F-012). When a snap is active its position is what the readout
     * shows — the number the next click will actually commit, not where the mouse happens to be
     * (run 2026-08-16-b). Absent ⇒ the raw cursor is shown.
     */
    snap?: SnapController
    /** Panel size in mm, shown in the active unit. */
    widthMm?: number
    heightMm?: number
    /** What the active tool's next click does — the same line the Draw palette shows. */
    hint?: string
    /** Toggle the bench-outputs drawer (F-042). Absent ⇒ the button hides. */
    onToggleDrawer?: () => void
    /** Whether the drawer is open, so the button reads as a toggle. */
    drawerOpen?: boolean
  }

  let {
    viewport,
    snap,
    widthMm,
    heightMm,
    hint = '',
    onToggleDrawer,
    drawerOpen = false,
  }: Props = $props()

  /** Snap names as the Draw section's chips write them, so the two surfaces agree. */
  const KIND_LABELS: Record<SnapKind, string> = {
    endpoint: 'Endpoint',
    intersection: 'Intersection',
    midpoint: 'Midpoint',
    'on-curve': 'On curve',
    grid: 'Grid',
    angle: 'Angle',
  }

  // A live snap wins over the raw pointer: the readout should be the coordinate the next click
  // commits. `hit.world` is already in the space the marker is drawn in, so a snap taken in a
  // symmetry replica sector reads under the cursor rather than in the source sector (F-052).
  const snapped = $derived(snap?.hit ?? null)
  const coords = $derived.by(() => {
    const world = snapped?.world ?? viewport.cursorWorld
    if (!world) return 'X —   Y —'
    const opts = { fractional: viewport.unit === 'in' }
    return `X ${formatLength(world.x, viewport.unit, opts)}   Y ${formatLength(world.y, viewport.unit, opts)}`
  })

  /** Panel size as one measurement with a single unit suffix, the way a maker writes it down. */
  function size(w: number, h: number, unit: LengthUnit): string {
    const strip = (text: string) => text.replace(/\s*(mm|in)$/, '')
    return `${strip(formatLength(w, unit))} × ${formatLength(h, unit)}`
  }
</script>

<!--
  Cockpit v2 trims the status bar to a readout: coordinates and what the tool is about to do on the
  left, the panel's size and its two global switches on the right. Grid and snapping moved to the
  Draw section, zoom and fit to the viewport chip on the canvas they act on.
-->
<section class="statusbar" aria-label="Status bar">
  <div class="group">
    <span class="coords" aria-label="Cursor position">{coords}</span>
    {#if snapped}
      <!-- Which snap produced the number above, so a snapped reading is never mistaken for a
           coincidence of the pointer. -->
      <span class="hint" aria-label="Active snap">{KIND_LABELS[snapped.kind]}</span>
    {:else if hint}
      <span class="hint">{hint}</span>
    {/if}
  </div>

  <div class="group">
    {#if widthMm !== undefined && heightMm !== undefined}
      <span class="dims" aria-label="Panel dimensions">
        {size(widthMm, heightMm, viewport.unit)}
      </span>
      <span class="rule" aria-hidden="true"></span>
    {/if}
    {#if onToggleDrawer}
      <button
        type="button"
        class="text-btn"
        aria-pressed={drawerOpen}
        aria-label="Cutting list"
        onclick={() => onToggleDrawer?.()}
      >
        <Table size={13} />
        Cutting list
      </button>
      <span class="rule" aria-hidden="true"></span>
    {/if}
    <button
      type="button"
      class="text-btn unit"
      aria-label={`Measurement unit: ${viewport.unit}. Click to switch.`}
      onclick={() => viewport.toggleUnit()}
    >
      {viewport.unit}
    </button>
  </div>
</section>

<style>
  .statusbar {
    grid-area: status;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    flex: none;
    padding: 0 12px;
    background: var(--paper-50);
    border-top: 1px solid var(--border-subtle);
    font: var(--text-caption);
    color: var(--text-muted);
  }

  .group {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .coords {
    font-family: var(--font-mono);
    color: var(--ink-800);
    white-space: pre;
  }

  .hint {
    font-family: var(--font-mono);
    color: var(--ink-500);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dims {
    font-family: var(--font-mono);
    color: var(--ink-500);
    white-space: nowrap;
  }

  .rule {
    width: 1px;
    height: 13px;
    background: var(--border-subtle);
  }

  .text-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-700);
    cursor: pointer;
  }

  .text-btn:hover {
    color: var(--ink-950);
  }

  .text-btn[aria-pressed='true'] {
    color: var(--ink-950);
  }

  .unit {
    text-transform: lowercase;
  }
</style>
