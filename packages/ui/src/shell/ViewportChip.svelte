<script lang="ts">
  import Minus from 'lucide-svelte/icons/minus'
  import Plus from 'lucide-svelte/icons/plus'

  import type { ViewportController } from '../canvas/viewport.svelte'

  interface Props {
    viewport: ViewportController
    /** Zoom-to-fit needs document bounds, which the shell owns; wired through here. */
    onFit?: () => void
    /** Open the 1:1 calibration dialog, so "1:1" can be trusted as physical size. */
    onCalibrate?: () => void
  }

  let { viewport, onFit, onCalibrate }: Props = $props()

  const zoom = $derived(`${Math.round(viewport.zoomFactor * 100)}%`)
</script>

<!--
  Viewport controls, pinned to the corner of the stage they act on (Cockpit v2). These used to be
  mono chips in the status bar, a long way from the canvas they zoom.
-->
<div class="chip" aria-label="Viewport">
  <button class="icon" aria-label="Zoom out" onclick={() => viewport.zoomOut()}>
    <Minus size={14} />
  </button>
  <span class="zoom" aria-label="Zoom level">{zoom}</span>
  <button class="icon" aria-label="Zoom in" onclick={() => viewport.zoomIn()}>
    <Plus size={14} />
  </button>
  <span class="rule" aria-hidden="true"></span>
  <button class="text" aria-label="Zoom to fit" onclick={() => onFit?.()}>Fit</button>
  <button class="text" aria-label="Zoom to actual size" onclick={() => viewport.zoomToActualSize()}>
    1:1
  </button>
  {#if onCalibrate}
    <button class="text" aria-label="Calibrate physical size" onclick={() => onCalibrate?.()}>
      Calibrate
    </button>
  {/if}
</div>

<style>
  .chip {
    position: absolute;
    right: 16px;
    bottom: 16px;
    z-index: 8;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    /* Translucent so the panel stays readable underneath the chip. */
    background: color-mix(in srgb, var(--paper-0) 94%, transparent);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-xs);
  }

  .icon {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    border-radius: var(--radius-full);
    color: var(--ink-700);
    cursor: pointer;
  }

  .text {
    height: 26px;
    padding: 0 9px;
    border: none;
    background: transparent;
    border-radius: var(--radius-full);
    font: 600 11.5px/1 var(--font-sans);
    color: var(--ink-700);
    cursor: pointer;
  }

  .icon:hover,
  .text:hover {
    background: var(--paper-100);
    color: var(--ink-950);
  }

  .zoom {
    min-width: 44px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--ink-800);
  }

  .rule {
    width: 1px;
    height: 16px;
    background: var(--border-subtle);
    margin: 0 3px;
  }
</style>
