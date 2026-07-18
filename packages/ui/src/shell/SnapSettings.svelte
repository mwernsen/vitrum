<script lang="ts">
  import { SNAP_KINDS, type SnapKind } from '@vitrum/core'

  import Switch from '../components/Switch.svelte'
  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { SnapController } from '../tools/snap.svelte'

  interface Props {
    snap: SnapController
    viewport: ViewportController
    /** Reversible "clear all guides" command. Absent ⇒ button hidden (isolation tests). */
    onClearGuides?: () => void
  }

  let { snap, viewport, onClearGuides }: Props = $props()

  let open = $state(false)

  // Sentence-case labels for the popover rows (voice: sentence case, lowercase where it reads
  // naturally, no emoji). Priority order mirrors the engine's.
  const KIND_LABELS: Record<SnapKind, string> = {
    endpoint: 'Endpoint',
    intersection: 'Intersection',
    midpoint: 'Midpoint',
    'on-curve': 'On curve',
    grid: 'Grid',
    angle: 'Angle',
  }

  function close() {
    open = false
  }

  function onWindowKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) close()
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="snap">
  <button
    type="button"
    class="chip"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-pressed={snap.master}
    aria-label={`Snapping ${snap.master ? 'on' : 'off'}. Click for snap settings.`}
    onclick={() => (open = !open)}
  >
    Snap
  </button>

  {#if open}
    <!-- Click-away backdrop so the popover dismisses without trapping focus. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={close}></div>
    <div class="popover" role="dialog" aria-label="Snap settings">
      <div class="master">
        <Switch label="Snapping" checked={snap.master} onchange={() => snap.toggleMaster()} />
        <span class="radius">8&nbsp;px mouse · 12&nbsp;px pen</span>
      </div>

      <div class="kinds">
        {#each SNAP_KINDS as kind (kind)}
          <Switch
            label={KIND_LABELS[kind]}
            checked={snap.toggles[kind]}
            disabled={!snap.master}
            onchange={() => snap.toggle(kind)}
          />
        {/each}
      </div>

      <div class="guides">
        <Switch
          label="Show guides"
          checked={viewport.guidesVisible}
          onchange={() => viewport.toggleGuides()}
        />
        {#if onClearGuides}
          <button type="button" class="clear" onclick={() => onClearGuides?.()}>
            Clear all guides
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .snap {
    position: relative;
    display: inline-flex;
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

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .popover {
    position: absolute;
    bottom: calc(100% + var(--space-2));
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 208px;
    padding: var(--space-3);
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
  }

  .master {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  .radius {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .kinds {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .guides {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }

  .clear {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: var(--link);
    font: var(--text-body);
    cursor: pointer;
  }

  .clear:hover {
    color: var(--link-hover);
    text-decoration: underline;
  }
</style>
