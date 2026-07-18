<script lang="ts">
  import { formatLength, totalLeadLength, type LengthUnit, type Panel } from '@vitrum/core'

  import PieceSummary from '../PieceSummary.svelte'

  interface Props {
    panel: Panel
    unit: LengthUnit
  }

  let { panel, unit }: Props = $props()

  const width = $derived(formatLength(panel.widthMm, unit))
  const height = $derived(formatLength(panel.heightMm, unit))
  const leadMeters = $derived(totalLeadLength(panel) / 1000)
</script>

<aside class="inspector" aria-label="Inspector">
  <h2>{panel.name}</h2>
  <dl class="props">
    <div>
      <dt>Size</dt>
      <dd>{width} × {height}</dd>
    </div>
    <div>
      <dt>Pieces</dt>
      <dd>{panel.pieces.length}</dd>
    </div>
    <div>
      <dt>Lead</dt>
      <dd>{leadMeters.toFixed(2)} m</dd>
    </div>
  </dl>

  <h3>Pieces</h3>
  <ul>
    {#each panel.pieces as piece (piece.id)}
      <PieceSummary {piece} />
    {/each}
  </ul>
</aside>

<style>
  .inspector {
    grid-area: inspector;
    width: clamp(14rem, 20vw, 20rem);
    padding: var(--space-4);
    background: var(--paper-0);
    border-left: 1px solid var(--border-subtle);
    overflow-y: auto;
  }

  h2 {
    margin: 0 0 var(--space-3);
    font: var(--text-h4);
    color: var(--text-strong);
  }

  h3 {
    margin: var(--space-5) 0 var(--space-2);
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .props {
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }

  .props div {
    display: flex;
    justify-content: space-between;
    font: var(--text-small);
  }

  .props dt {
    color: var(--text-muted);
  }

  .props dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--text-body);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
