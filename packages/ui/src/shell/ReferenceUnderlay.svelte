<script lang="ts">
  import { onMount } from 'svelte'

  import type { ViewportController } from '../canvas/viewport.svelte'
  import {
    createReferenceRenderer,
    type ReferenceRenderer,
    type RenderLayer,
    type ResolveSource,
  } from '../reference/gl'

  interface Props {
    viewport: ViewportController
    layers: readonly RenderLayer[]
    resolveSource: ResolveSource
    /** Bumped when a texture source finishes decoding, to force a redraw. */
    version?: number
  }

  let { viewport, layers, resolveSource, version = 0 }: Props = $props()

  let canvas: HTMLCanvasElement
  let renderer: ReferenceRenderer | null = null

  onMount(() => {
    // Returns null under jsdom / when WebGL is unavailable; the effect then no-ops.
    renderer = createReferenceRenderer(canvas)
    return () => renderer?.dispose()
  })

  // Redraw whenever the viewport moves, the layers change, or a source decodes.
  $effect(() => {
    void version
    const size = viewport.size
    const dpr = viewport.devicePixelRatio
    const transform = viewport.transform
    const current = layers
    renderer?.render(transform, size, dpr, current, resolveSource)
  })
</script>

<canvas class="reference-underlay" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .reference-underlay {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
