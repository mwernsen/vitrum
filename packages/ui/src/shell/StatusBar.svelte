<script lang="ts">
  import { formatLength } from '@vitrum/core'

  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { SnapController } from '../tools/snap.svelte'

  import SnapSettings from './SnapSettings.svelte'

  interface Props {
    viewport: ViewportController
    /** The snapping controller (F-012). Absent ⇒ no snap chip. */
    snap?: SnapController
    /** Zoom-to-fit needs document bounds, which the shell owns; wired through here. */
    onfit?: () => void
    /** Open the 1:1 calibration dialog. */
    oncalibrate?: () => void
    /** Reversible "clear all guides" command (F-012). */
    onClearGuides?: () => void
    /** Count of pieces with no glass assigned (F-023 FR-3; input to F-030's ERC). */
    unassignedCount?: number
  }

  let { viewport, snap, onfit, oncalibrate, onClearGuides, unassignedCount = 0 }: Props = $props()

  const coords = $derived.by(() => {
    const world = viewport.cursorWorld
    if (!world) return 'X —   Y —'
    const opts = { fractional: viewport.unit === 'in' }
    return `X ${formatLength(world.x, viewport.unit, opts)}   Y ${formatLength(world.y, viewport.unit, opts)}`
  })

  const zoom = $derived(`${Math.round(viewport.zoomFactor * 100)}%`)
</script>

<section class="statusbar" aria-label="Status bar">
  <div class="group">
    <span class="coords" aria-label="Cursor position">{coords}</span>
    <span
      class="unassigned"
      class:warn={unassignedCount > 0}
      aria-label={`${unassignedCount} unassigned pieces`}
      data-testid="unassigned-count"
    >
      Unassigned: {unassignedCount}
    </span>
  </div>

  <div class="group">
    <button
      type="button"
      class="chip"
      aria-pressed={viewport.glassVisible}
      aria-label={`Glass ${viewport.glassVisible ? 'on' : 'off'}. Click to toggle.`}
      onclick={() => viewport.toggleGlass()}
    >
      Glass
    </button>
    <button
      type="button"
      class="chip"
      aria-pressed={viewport.gridVisible}
      aria-label={`Grid ${viewport.gridVisible ? 'on' : 'off'}. Click to toggle.`}
      onclick={() => viewport.toggleGrid()}
    >
      Grid
    </button>
    <button
      type="button"
      class="chip"
      aria-pressed={viewport.piecesVisible}
      aria-label={`Piece overlay ${viewport.piecesVisible ? 'on' : 'off'}. Click to toggle.`}
      onclick={() => viewport.togglePieces()}
    >
      Pieces
    </button>
    <button
      type="button"
      class="chip"
      aria-pressed={viewport.cutsVisible}
      aria-label={`Cut-contour overlay ${viewport.cutsVisible ? 'on' : 'off'}. Click to toggle.`}
      onclick={() => viewport.toggleCuts()}
    >
      Cuts
    </button>
    {#if snap}
      <SnapSettings {snap} {viewport} {onClearGuides} />
    {/if}
    <button type="button" class="chip" aria-label="Zoom to fit" onclick={() => onfit?.()}>
      Fit
    </button>
    <button
      type="button"
      class="chip"
      aria-label="Zoom to actual size"
      onclick={() => viewport.zoomToActualSize()}
    >
      1:1
    </button>
    <span class="zoom" aria-label="Zoom level">{zoom}</span>
    <button
      type="button"
      class="chip"
      aria-label="Calibrate physical size"
      onclick={() => oncalibrate?.()}
    >
      Calibrate
    </button>
    <button
      type="button"
      class="chip unit"
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
    height: 28px;
    padding: 0 var(--space-3);
    background: var(--paper-50);
    border-top: 1px solid var(--border-subtle);
    font: var(--text-caption);
    color: var(--text-muted);
  }

  .group {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .coords,
  .zoom {
    font-family: var(--font-mono);
    color: var(--text-body);
  }

  .unassigned {
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .unassigned.warn {
    color: var(--warning-600);
  }

  .zoom {
    min-width: 44px;
    text-align: right;
  }

  .chip {
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    color: var(--text-body);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 1px 8px;
    cursor: pointer;
  }

  .chip:hover {
    border-color: var(--border-strong);
  }

  .chip[aria-pressed='true'] {
    background: var(--ink-950);
    border-color: var(--ink-950);
    color: var(--text-inverse);
  }

  .unit {
    text-transform: lowercase;
  }
</style>
