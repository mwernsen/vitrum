<script lang="ts">
  import Eye from 'lucide-svelte/icons/eye'
  import EyeOff from 'lucide-svelte/icons/eye-off'
  import Layers from 'lucide-svelte/icons/layers'

  import type { ViewportController } from '../canvas/viewport.svelte'

  interface Props {
    viewport: ViewportController
  }

  let { viewport }: Props = $props()

  let open = $state(false)

  // What the old Layers panel was really for: which overlays are drawn over the panel. It is a
  // canvas concern, so in Cockpit v2 it lives on the canvas — a chip that reports "3/5" at a
  // glance and opens the toggles in place.
  const overlays = $derived([
    { label: 'Glass fills', on: viewport.glassVisible, toggle: () => viewport.toggleGlass() },
    { label: 'Piece regions', on: viewport.piecesVisible, toggle: () => viewport.togglePieces() },
    { label: 'Cut contours', on: viewport.cutsVisible, toggle: () => viewport.toggleCuts() },
    { label: 'Piece numbers', on: viewport.numbersVisible, toggle: () => viewport.toggleNumbers() },
    { label: 'Guides', on: viewport.guidesVisible, toggle: () => viewport.toggleGuides() },
  ])

  const onCount = $derived(overlays.filter((o) => o.on).length)

  function onWindowKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) open = false
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="cluster">
  {#if open}
    <div class="popover" role="group" aria-label="Overlay visibility">
      {#each overlays as overlay (overlay.label)}
        <button
          class="row"
          class:off={!overlay.on}
          aria-pressed={overlay.on}
          aria-label={`${overlay.label} ${overlay.on ? 'shown' : 'hidden'}. Click to toggle.`}
          onclick={overlay.toggle}
        >
          {#if overlay.on}<Eye size={14} strokeWidth={1.7} />{:else}<EyeOff
              size={14}
              strokeWidth={1.7}
            />{/if}
          <span class="label">{overlay.label}</span>
        </button>
      {/each}
    </div>
  {/if}

  <button
    class="chip"
    aria-expanded={open}
    aria-label={`Overlays, ${onCount} of ${overlays.length} shown`}
    onclick={() => (open = !open)}
  >
    <Layers size={14} strokeWidth={1.7} />
    <span class="name">Overlays</span>
    <span class="count">{onCount}/{overlays.length}</span>
  </button>
</div>

<style>
  .cluster {
    position: absolute;
    left: 16px;
    bottom: 16px;
    z-index: 8;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 11px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    /* Translucent so the panel stays readable underneath the chip. */
    background: color-mix(in srgb, var(--paper-0) 94%, transparent);
    color: var(--ink-700);
    box-shadow: var(--shadow-xs);
    cursor: pointer;
  }

  .chip:hover {
    border-color: var(--border-strong);
  }

  .name {
    font: 600 12px/1 var(--font-sans);
    color: var(--ink-800);
  }

  .count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
  }

  .popover {
    width: 210px;
    padding: 6px;
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--ink-900);
    cursor: pointer;
    text-align: left;
  }

  .row:hover {
    background: var(--paper-50);
  }

  .row.off {
    color: var(--paper-400);
  }

  .label {
    flex: 1;
    font: 500 12px/1 var(--font-sans);
  }
</style>
