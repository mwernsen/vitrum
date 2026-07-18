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
    height: 28px;
    padding: 0 var(--space-3);
    background: var(--paper-50);
    border-top: 1px solid var(--border-subtle);
    font: var(--text-caption);
    color: var(--text-muted);
  }

  .coords {
    font-family: var(--font-mono);
  }

  .unit {
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    color: var(--text-body);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 1px 8px;
    cursor: pointer;
  }

  .unit:hover {
    border-color: var(--border-strong);
  }
</style>
