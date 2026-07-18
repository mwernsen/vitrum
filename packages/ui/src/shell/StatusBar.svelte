<script lang="ts">
  import { formatLength, type LengthUnit } from '@vitrum/core'

  interface Props {
    cursor: { x: number; y: number } | null
    unit: LengthUnit
    ontoggleunit?: () => void
  }

  let { cursor, unit, ontoggleunit }: Props = $props()

  const coords = $derived(
    cursor ? `X ${formatLength(cursor.x, unit)}   Y ${formatLength(cursor.y, unit)}` : 'X —   Y —',
  )
</script>

<section class="statusbar" aria-label="Status bar">
  <span class="coords" aria-label="Cursor position">{coords}</span>
  <button
    type="button"
    class="unit"
    aria-label={`Measurement unit: ${unit}. Click to switch.`}
    onclick={() => ontoggleunit?.()}
  >
    {unit}
  </button>
</section>

<style>
  .statusbar {
    grid-area: status;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 1.75rem;
    padding: 0 0.75rem;
    background: #292524;
    border-top: 1px solid #44403c;
    font-size: 0.8rem;
    color: #a8a29e;
  }

  .coords {
    font-variant-numeric: tabular-nums;
  }

  .unit {
    background: #1c1917;
    border: 1px solid #44403c;
    border-radius: 0.25rem;
    color: #d6d3d1;
    font: inherit;
    padding: 0.05rem 0.5rem;
    cursor: pointer;
    text-transform: lowercase;
  }

  .unit:hover {
    border-color: #57534e;
  }
</style>
