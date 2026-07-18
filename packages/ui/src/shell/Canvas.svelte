<script lang="ts">
  interface Props {
    onmove?: (position: { x: number; y: number }) => void
    onleave?: () => void
  }

  let { onmove, onleave }: Props = $props()

  // No viewport transform yet (that is F-003); report pixel coordinates relative
  // to the canvas as a 1:1 millimetre placeholder so the status bar has data.
  function handleMove(event: PointerEvent & { currentTarget: HTMLElement }) {
    const rect = event.currentTarget.getBoundingClientRect()
    onmove?.({ x: event.clientX - rect.left, y: event.clientY - rect.top })
  }
</script>

<main
  class="canvas"
  aria-label="Design canvas"
  onpointermove={handleMove}
  onpointerleave={() => onleave?.()}
>
  <p class="hint">Canvas — drawing tools arrive in a later feature</p>
</main>

<style>
  .canvas {
    grid-area: canvas;
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    background-color: #1c1917;
    /* Faint reference grid so the empty canvas reads as a drawing surface. */
    background-image:
      linear-gradient(#ffffff0d 1px, transparent 1px),
      linear-gradient(90deg, #ffffff0d 1px, transparent 1px);
    background-size: 24px 24px;
    touch-action: none;
  }

  .hint {
    color: #78716c;
    font-size: 0.9rem;
    pointer-events: none;
  }
</style>
