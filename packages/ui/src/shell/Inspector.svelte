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
    padding: 1rem;
    background: #292524;
    border-left: 1px solid #44403c;
    overflow-y: auto;
  }

  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }

  h3 {
    margin: 1.25rem 0 0.5rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #a8a29e;
  }

  .props {
    margin: 0;
    display: grid;
    gap: 0.4rem;
  }

  .props div {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
  }

  .props dt {
    color: #a8a29e;
  }

  .props dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
</style>
