<script lang="ts">
  import { formatLength, type LengthUnit } from '@vitrum/core'
  import Table from 'lucide-svelte/icons/table'

  import type { ViewportController } from '../canvas/viewport.svelte'

  interface Props {
    viewport: ViewportController
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
    widthMm,
    heightMm,
    hint = '',
    onToggleDrawer,
    drawerOpen = false,
  }: Props = $props()

  const coords = $derived.by(() => {
    const world = viewport.cursorWorld
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
    {#if hint}<span class="hint">{hint}</span>{/if}
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
