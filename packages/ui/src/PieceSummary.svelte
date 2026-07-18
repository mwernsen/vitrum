<script lang="ts">
  import { pieceArea, piecePerimeter, type GlassPiece } from '@vitrum/core'

  interface Props {
    piece: GlassPiece
  }

  let { piece }: Props = $props()

  const areaCm2 = $derived(pieceArea(piece) / 100)
  const leadCm = $derived(piecePerimeter(piece) / 10)

  const format = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
</script>

<li class="piece">
  <span class="swatch" style:background-color={piece.color} aria-hidden="true"></span>
  <span class="label">{piece.label}</span>
  <span class="stats">{format.format(areaCm2)} cm² · {format.format(leadCm)} cm lead</span>
</li>

<style>
  .piece {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--paper-50);
    border: 1px solid var(--border-subtle);
  }

  .swatch {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-strong);
    flex-shrink: 0;
  }

  .label {
    flex: 1;
    font: var(--text-small);
    color: var(--text-body);
  }

  .stats {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
