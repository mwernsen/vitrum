<script lang="ts">
  import type { Snippet } from 'svelte'

  import { DOCK_SECTIONS, type DockSection } from './dock'

  interface Props {
    /** The open section. Mirrors the activity rail selection. */
    section: DockSection
    /** Change the open section (from the tab header). */
    onSelect: (section: DockSection) => void
    /** Live glass content (F-022/F-023), rendered when the glass section is open. */
    glass?: Snippet
  }

  let { section, onSelect, glass }: Props = $props()

  const current = $derived(DOCK_SECTIONS.find((s) => s.id === section) ?? DOCK_SECTIONS[1]!)
</script>

<aside class="dock" aria-label="Panel dock">
  <div class="tabs" role="tablist">
    {#each DOCK_SECTIONS as tab (tab.id)}
      <button
        class="tab"
        class:active={tab.id === section}
        role="tab"
        aria-selected={tab.id === section}
        onclick={() => onSelect(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="body">
    {#if section === 'glass'}
      {@render glass?.()}
    {:else}
      <div class="placeholder">
        <span class="ph-title">{current.label}</span>
        <p class="ph-note">
          {#if section === 'layers'}
            Panel layers and structure will live here.
          {:else if section === 'rules'}
            Design rule checks (near-miss joints, slivers, unassigned glass) surface here once the
            DRC engine lands.
          {:else}
            Cut lists and the bill of materials are generated here from the finished panel.
          {/if}
        </p>
        {#if current.feature}
          <span class="ph-feature">Coming with {current.feature}</span>
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style>
  .dock {
    grid-area: dock;
    width: 270px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--paper-0);
    border-right: 1px solid var(--border-subtle);
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tab {
    padding: 5px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-600);
    font: 600 12px/1 var(--font-sans);
    cursor: pointer;
  }

  .tab:hover {
    color: var(--ink-800);
  }

  .tab.active {
    color: var(--ink-950);
    background: var(--paper-100);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .ph-title {
    font: var(--text-h4);
    color: var(--text-strong);
  }

  .ph-note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .ph-feature {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--ink-500);
    padding: 4px 9px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
  }
</style>
