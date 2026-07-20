<script lang="ts">
  import type { NumberingScheme } from '@vitrum/core'

  import type { LegendEntry } from './NumberingPanel.svelte'

  interface Props {
    /** Glass legend rows for glasses in use (FR-4). */
    entries: readonly LegendEntry[]
    /** Active scheme, shown so the reader knows how numbers map to glass. */
    scheme: NumberingScheme
  }

  let { entries, scheme }: Props = $props()

  const schemeLabel = $derived(
    scheme === 'grouped' ? 'Grouped by glass' : scheme === 'sequential' ? 'Sequential' : 'Manual',
  )
</script>

<aside class="legend" aria-label="Cartoon legend">
  <header>
    <span class="title">Legend</span>
    <span class="scheme">{schemeLabel}</span>
  </header>
  {#if entries.length === 0}
    <p class="empty">No glass assigned yet.</p>
  {:else}
    <dl>
      {#each entries as entry (entry.glassId)}
        <div class="row">
          <dt>{entry.code}</dt>
          <dd>
            <span class="name">{entry.name}</span>
            {#if entry.manufacturer}<span class="maker">{entry.manufacturer}</span>{/if}
            <span class="count">×{entry.count}</span>
          </dd>
        </div>
      {/each}
    </dl>
  {/if}
</aside>

<style>
  .legend {
    position: absolute;
    top: calc(var(--space-3) + 22px);
    right: var(--space-3);
    z-index: 6;
    max-width: 232px;
    padding: var(--space-3);
    background: var(--paper-0);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-sm);
    font: var(--text-small);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
  }

  .title {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .scheme {
    font-size: 11px;
    color: var(--ink-500);
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
  }

  dl {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .row {
    display: grid;
    grid-template-columns: 34px 1fr;
    align-items: baseline;
    gap: var(--space-2);
  }

  dt {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--ink-950);
  }

  dd {
    margin: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    color: var(--ink-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .maker,
  .count {
    font-size: 11px;
    color: var(--ink-500);
  }
</style>
