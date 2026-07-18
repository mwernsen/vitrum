<script lang="ts">
  import type { BBox } from '@vitrum/geometry'
  import { vec2 } from '@vitrum/geometry'
  import type { Segment } from '@vitrum/model'
  import { onMount } from 'svelte'

  import {
    RULER_SIZE,
    drawContent,
    drawGrid,
    drawOverlay,
    drawRuler,
    prepareContext,
    readCanvasPalette,
    type CanvasPalette,
  } from '../canvas/render'
  import type { ViewportController } from '../canvas/viewport.svelte'

  interface Props {
    viewport: ViewportController
    /** The lead-line network to render. Empty until a document is loaded. */
    segments?: readonly Segment[]
    /** World bounds for zoom-to-fit; `null` frames the default panel region. */
    bounds?: BBox | null
  }

  let { viewport, segments = [], bounds = null }: Props = $props()

  let stackEl: HTMLDivElement
  let gridCanvas: HTMLCanvasElement
  let contentCanvas: HTMLCanvasElement
  let overlayCanvas: HTMLCanvasElement
  let rulerTopCanvas: HTMLCanvasElement
  let rulerLeftCanvas: HTMLCanvasElement

  let palette: CanvasPalette | null = null

  // Per-layer dirty flags coalesced into a single rAF so a burst of pointer/wheel events
  // paints at most once per frame (FR-4). Overlays live on their own layer, so moving the
  // cursor never redraws the grid or content.
  const dirty = { grid: false, content: false, overlay: false, rulers: false }
  let frame = 0

  function schedule(...layers: (keyof typeof dirty)[]): void {
    for (const layer of layers) dirty[layer] = true
    if (frame || typeof requestAnimationFrame === 'undefined') return
    frame = requestAnimationFrame(flush)
  }

  function flush(): void {
    frame = 0
    if (!palette) return
    const size = viewport.size
    const dpr = viewport.devicePixelRatio

    if (dirty.grid) {
      const ctx = prepareContext(gridCanvas, size, dpr)
      if (viewport.gridVisible) drawGrid(ctx, viewport.transform, size, palette)
      dirty.grid = false
    }
    if (dirty.content) {
      const ctx = prepareContext(contentCanvas, size, dpr)
      drawContent(ctx, viewport.transform, size, segments, palette)
      dirty.content = false
    }
    if (dirty.overlay) {
      const ctx = prepareContext(overlayCanvas, size, dpr)
      drawOverlay(ctx, size, viewport.cursorScreen, palette)
      dirty.overlay = false
    }
    if (dirty.rulers) {
      const top = prepareContext(rulerTopCanvas, { width: size.width, height: RULER_SIZE }, dpr)
      drawRuler(
        top,
        'x',
        viewport.transform,
        size.width,
        viewport.unit,
        viewport.cursorScreen,
        palette,
      )
      const left = prepareContext(rulerLeftCanvas, { width: RULER_SIZE, height: size.height }, dpr)
      drawRuler(
        left,
        'y',
        viewport.transform,
        size.height,
        viewport.unit,
        viewport.cursorScreen,
        palette,
      )
      dirty.rulers = false
    }
  }

  // Reactive redraw triggers: each effect reads the state it depends on (so Svelte tracks
  // it) then marks the affected layers dirty. The actual paint is deferred to `flush`.
  $effect(() => {
    // grid + content follow the transform, size and grid toggle
    void viewport.transform
    void viewport.width
    void viewport.height
    void viewport.gridVisible
    void segments
    schedule('grid', 'content', 'rulers')
  })
  $effect(() => {
    void viewport.cursorScreen
    void viewport.unit
    void viewport.transform
    schedule('overlay', 'rulers')
  })

  onMount(() => {
    palette = readCanvasPalette(stackEl)

    const measure = () => {
      const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
      viewport.resize(stackEl.clientWidth, stackEl.clientHeight, dpr)
      schedule('grid', 'content', 'overlay', 'rulers')
    }
    measure()

    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(stackEl)
    }
    window.addEventListener('resize', measure)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      if (frame) cancelAnimationFrame(frame)
    }
  })

  // --- Interaction -----------------------------------------------------------

  let panning = $state(false)
  let spaceDown = $state(false)
  let lastPointer: { x: number; y: number } | null = null

  function localPoint(event: PointerEvent) {
    const rect = stackEl.getBoundingClientRect()
    return vec2(event.clientX - rect.left, event.clientY - rect.top)
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button === 1 || spaceDown) {
      panning = true
      lastPointer = { x: event.clientX, y: event.clientY }
      stackEl.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
  }

  function handlePointerMove(event: PointerEvent) {
    viewport.setCursor(localPoint(event))
    if (panning && lastPointer) {
      viewport.pan(event.clientX - lastPointer.x, event.clientY - lastPointer.y)
      lastPointer = { x: event.clientX, y: event.clientY }
    }
  }

  function endPan(event: PointerEvent) {
    if (!panning) return
    panning = false
    lastPointer = null
    if (stackEl.hasPointerCapture(event.pointerId)) stackEl.releasePointerCapture(event.pointerId)
  }

  function handlePointerLeave() {
    viewport.setCursor(null)
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault()
    const rect = stackEl.getBoundingClientRect()
    const anchor = vec2(event.clientX - rect.left, event.clientY - rect.top)
    viewport.setCursor(anchor)
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd-scroll and trackpad pinch (which browsers report as ctrl+wheel) zoom,
      // anchored under the cursor (FR-2). The exponential keeps zoom speed uniform.
      viewport.zoomAt(Math.exp(-event.deltaY * 0.0015), anchor)
    } else {
      // Two-finger trackpad scroll pans.
      viewport.pan(-event.deltaX, -event.deltaY)
    }
  }

  function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    )
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    if (isTyping(event.target)) return
    if (event.code === 'Space' && !spaceDown) {
      spaceDown = true
      event.preventDefault()
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    switch (event.key) {
      case 'f':
      case 'F':
        viewport.zoomToFit(bounds)
        event.preventDefault()
        break
      case '+':
      case '=':
        viewport.zoomIn(viewport.cursorScreen ?? undefined)
        event.preventDefault()
        break
      case '-':
      case '_':
        viewport.zoomOut(viewport.cursorScreen ?? undefined)
        event.preventDefault()
        break
      case '1':
        viewport.zoomToActualSize()
        event.preventDefault()
        break
    }
  }

  function handleWindowKeyUp(event: KeyboardEvent) {
    if (event.code === 'Space') spaceDown = false
  }
</script>

<svelte:window onkeydown={handleWindowKeyDown} onkeyup={handleWindowKeyUp} />

<main class="canvas" aria-label="Design canvas">
  <div class="frame" style="--ruler:{RULER_SIZE}px">
    <div class="corner" aria-hidden="true">{viewport.unit}</div>
    <canvas class="ruler ruler-top" bind:this={rulerTopCanvas}></canvas>
    <canvas class="ruler ruler-left" bind:this={rulerLeftCanvas}></canvas>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="stack"
      class:panning
      class:space={spaceDown}
      bind:this={stackEl}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={endPan}
      onpointercancel={endPan}
      onpointerleave={handlePointerLeave}
      onwheel={handleWheel}
    >
      <canvas class="layer" bind:this={gridCanvas}></canvas>
      <canvas class="layer" bind:this={contentCanvas}></canvas>
      <canvas class="layer" bind:this={overlayCanvas}></canvas>
    </div>
  </div>
</main>

<style>
  .canvas {
    grid-area: canvas;
    position: relative;
    overflow: hidden;
  }

  .frame {
    display: grid;
    grid-template-columns: var(--ruler) 1fr;
    grid-template-rows: var(--ruler) 1fr;
    grid-template-areas:
      'corner rtop'
      'rleft stack';
    width: 100%;
    height: 100%;
  }

  .corner {
    grid-area: corner;
    display: grid;
    place-items: center;
    background: var(--paper-0);
    border-right: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    text-transform: lowercase;
  }

  .ruler {
    display: block;
    width: 100%;
    height: 100%;
  }
  .ruler-top {
    grid-area: rtop;
  }
  .ruler-left {
    grid-area: rleft;
  }

  .stack {
    grid-area: stack;
    position: relative;
    overflow: hidden;
    background: var(--surface-dark);
    touch-action: none;
    cursor: crosshair;
  }
  .stack.space {
    cursor: grab;
  }
  .stack.panning {
    cursor: grabbing;
  }

  .layer {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
