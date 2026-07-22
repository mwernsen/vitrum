<script lang="ts">
  import { screenToWorld, worldToScreen } from '@vitrum/core'
  import { vec2, type Vec2 } from '@vitrum/geometry'

  import { RULER_SIZE } from '../canvas/render'
  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { ReferenceController } from '../reference/controller.svelte'

  interface Props {
    controller: ReferenceController
    viewport: ViewportController
  }

  let { controller, viewport }: Props = $props()

  let surface: HTMLDivElement | undefined = $state()

  // The selected, editable layer drives handles; a locked layer shows none.
  const layer = $derived(controller.selected)
  const editable = $derived(layer && !layer.locked ? layer : null)

  /** World → overlay-local px (the canvas drawing area is inset by the rulers). */
  function toLocal(p: Vec2): { x: number; y: number } {
    const s = worldToScreen(viewport.transform, p)
    return { x: RULER_SIZE + s.x, y: RULER_SIZE + s.y }
  }

  /** A pointer event's position in world space. */
  function toWorld(event: PointerEvent | MouseEvent): Vec2 {
    const rect = surface!.getBoundingClientRect()
    const sx = event.clientX - rect.left - RULER_SIZE
    const sy = event.clientY - rect.top - RULER_SIZE
    return screenToWorld(viewport.transform, vec2(sx, sy))
  }

  const cornerScreens = $derived(editable ? editable.dstQuad.map(toLocal) : [])
  const centreScreen = $derived.by(() => {
    if (!editable) return null
    const q = editable.dstQuad
    return toLocal({
      x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
      y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
    })
  })
  const markerScreens = $derived(controller.rectifyMarkers?.map(toLocal) ?? [])
  const calibrationScreens = $derived(controller.calibrationPoints.map(toLocal))

  type Drag = { kind: 'corner' | 'move' | 'marker'; index: number; last: Vec2 }
  let drag: Drag | null = null

  function startCorner(event: PointerEvent, index: number) {
    if (!editable) return
    drag = { kind: 'corner', index, last: toWorld(event) }
    capture(event)
  }

  function startMove(event: PointerEvent) {
    if (!editable) return
    drag = { kind: 'move', index: -1, last: toWorld(event) }
    capture(event)
  }

  function startMarker(event: PointerEvent, index: number) {
    drag = { kind: 'marker', index, last: toWorld(event) }
    capture(event)
  }

  function capture(event: PointerEvent) {
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag) return
    const world = toWorld(event)
    if (drag.kind === 'corner' && editable) {
      controller.dragCorner(editable.id, drag.index, world)
    } else if (drag.kind === 'move' && editable) {
      controller.translate(editable.id, world.x - drag.last.x, world.y - drag.last.y)
      drag.last = world
    } else if (drag.kind === 'marker') {
      controller.setRectifyMarker(drag.index, world)
    }
  }

  function onPointerUp() {
    drag = null
  }

  // In calibrate mode the whole surface catches clicks to mark the two measured points.
  function onSurfacePointerDown(event: PointerEvent) {
    if (controller.mode !== 'calibrate' || !controller.selected) return
    controller.addCalibrationPoint(toWorld(event))
    event.preventDefault()
    event.stopPropagation()
  }

  const cornerLabels = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
  const catching = $derived(controller.mode === 'calibrate' && controller.selected !== null)
</script>

<div
  class="reference-overlay"
  class:catching
  role="application"
  aria-label="Reference image editing surface"
  bind:this={surface}
  onpointerdown={onSurfacePointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
>
  {#if editable && controller.mode === 'place'}
    <!-- Edges between the four destination-quad corners. -->
    <svg class="lines" aria-hidden="true">
      <polygon points={cornerScreens.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" />
    </svg>
    {#each cornerScreens as p, i (i)}
      <button
        class="handle corner"
        style="left:{p.x}px; top:{p.y}px"
        aria-label="Move {cornerLabels[i]} corner"
        onpointerdown={(e) => startCorner(e, i)}
      ></button>
    {/each}
    {#if centreScreen}
      <button
        class="handle move"
        style="left:{centreScreen.x}px; top:{centreScreen.y}px"
        aria-label="Move reference layer"
        onpointerdown={startMove}
      ></button>
    {/if}
  {/if}

  {#if controller.mode === 'rectify' && markerScreens.length === 4}
    <svg class="lines rectify" aria-hidden="true">
      <polygon points={markerScreens.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" />
    </svg>
    {#each markerScreens as p, i (i)}
      <button
        class="handle marker"
        style="left:{p.x}px; top:{p.y}px"
        aria-label="Window {cornerLabels[i]} corner"
        onpointerdown={(e) => startMarker(e, i)}
      ></button>
    {/each}
  {/if}

  {#if controller.mode === 'calibrate' && calibrationScreens.length > 0}
    <svg class="lines calibrate" aria-hidden="true">
      {#if calibrationScreens.length === 2}
        <line
          x1={calibrationScreens[0]!.x}
          y1={calibrationScreens[0]!.y}
          x2={calibrationScreens[1]!.x}
          y2={calibrationScreens[1]!.y}
        />
      {/if}
    </svg>
    {#each calibrationScreens as p, i (i)}
      <span class="cal-point" style="left:{p.x}px; top:{p.y}px" aria-hidden="true"></span>
    {/each}
  {/if}
</div>

<style>
  .reference-overlay {
    position: absolute;
    inset: 0;
    /* Transparent to pointer events except on handles, so panning/drawing still works. */
    pointer-events: none;
    z-index: 2;
  }
  .reference-overlay.catching {
    /* Calibrate mode: the whole surface catches the two measurement clicks. */
    pointer-events: auto;
    cursor: crosshair;
  }

  .lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .lines polygon {
    stroke: var(--cobalt-500);
    stroke-width: 1;
    stroke-dasharray: 4 3;
    opacity: 0.8;
  }
  .lines.rectify polygon {
    stroke: var(--cobalt-600);
    stroke-dasharray: none;
  }
  .lines.calibrate line {
    stroke: var(--cobalt-600);
    stroke-width: 1.5;
  }

  .handle {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    padding: 0;
    border: 1px solid var(--cobalt-600);
    background: var(--paper-0);
    border-radius: var(--radius-xs);
    pointer-events: auto;
    cursor: grab;
    touch-action: none;
  }
  .handle:hover {
    background: var(--cobalt-100);
  }
  .handle.move {
    border-radius: 50%;
    background: var(--cobalt-500);
  }
  .handle.marker {
    border-color: var(--cobalt-700);
    background: var(--cobalt-200);
  }

  .cal-point {
    position: absolute;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border-radius: 50%;
    background: var(--cobalt-600);
    pointer-events: none;
  }
</style>
