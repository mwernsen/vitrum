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
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.06);
  }

  .swatch {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.3);
    flex-shrink: 0;
  }

  .label {
    flex: 1;
  }

  .stats {
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
    font-size: 0.875rem;
  }
</style>
