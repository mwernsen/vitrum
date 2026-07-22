<script lang="ts">
  import type { Piece } from '@vitrum/core'
  import type { Glass, GlassId, Segment } from '@vitrum/model'
  import { onMount } from 'svelte'

  import type { TechniqueRender } from '../canvas/render'
  import { segmentToWorldPoints } from '../canvas/scene'
  import type { ViewportController } from '../canvas/viewport.svelte'

  import {
    createGlassRenderer,
    type CameRibbonInput,
    type GlassPieceInput,
    type GlassRenderer,
    type GlassScene,
    type TextureTransform,
  } from './glass-gl'
  import { SwatchCache } from './swatchCache'

  interface Props {
    viewport: ViewportController
    /** Whether the realistic render is showing (the `render` view mode). Inert otherwise. */
    active: boolean
    /** Detected pieces to render as backlit glass. */
    pieces: readonly Piece[]
    /** Effective glass id of a piece, or undefined (rendered as pale clear glass). */
    glassFor: (piece: Piece) => GlassId | undefined
    glasses: Readonly<Record<GlassId, Glass>>
    /** Per-piece texture placement (identity when the user has not set one). */
    textureTransformFor: (piece: Piece) => TextureTransform
    /** The lead-line network, rendered as dimensional came / solder ribbons. */
    segments: readonly Segment[]
    technique?: TechniqueRender
    backlight: { intensity: number; warmth: number }
  }

  let {
    viewport,
    active,
    pieces,
    glassFor,
    glasses,
    textureTransformFor,
    segments,
    technique,
    backlight,
  }: Props = $props()

  let canvas: HTMLCanvasElement
  let renderer: GlassRenderer | null = null

  // Decoded swatch photos live in a plain cache; `sourcesVersion` bumps when one decodes, forcing the
  // render effect to re-run (the renderer reads decoded sources through `swatches.resolve`).
  let sourcesVersion = $state(0)
  const swatches = new SwatchCache(() => (sourcesVersion += 1))

  const UNASSIGNED_GLASS = {
    color: '#c9c9c4',
    transparency: 'translucent' as const,
    texture: 'smooth' as const,
  }

  /** Build the render scene from the current document derivations. */
  function buildScene(): GlassScene {
    const pieceInputs: GlassPieceInput[] = pieces.map((piece) => {
      const glassId = glassFor(piece)
      const glass = glassId ? glasses[glassId] : undefined
      if (glass?.swatch) swatches.ensure(glass.id, glass.swatch)
      return {
        ring: piece.ring,
        holeRings: piece.holeRings,
        bbox: piece.bbox,
        color: glass?.color ?? UNASSIGNED_GLASS.color,
        transparency: glass?.transparency ?? UNASSIGNED_GLASS.transparency,
        texture: glass?.texture ?? UNASSIGNED_GLASS.texture,
        ...(glass?.swatch ? { swatchKey: glass.id } : {}),
        textureTransform: textureTransformFor(piece),
      }
    })

    const cames: CameRibbonInput[] = []
    if (technique) {
      for (const segment of segments) {
        if (segment.role === 'construction') continue
        const points = segmentToWorldPoints(segment.geometry)
        if (points.length < 2) continue
        const kind =
          technique.kind === 'foil' ? 'foil' : segment.role === 'border' ? 'border' : 'lead'
        const widthMm =
          technique.kind === 'foil' ? 1.6 : technique.leadWidthMm(segment.id, segment.role)
        cames.push({ points, widthMm, kind })
      }
    }

    return {
      pieces: pieceInputs,
      cames,
      backlight,
      solderFinish: technique?.solderFinish ?? 'silver',
    }
  }

  onMount(() => {
    // Returns null under jsdom / when WebGL2 is unavailable; the effect then no-ops.
    renderer = createGlassRenderer(canvas)
    return () => renderer?.dispose()
  })

  $effect(() => {
    void sourcesVersion
    const size = viewport.size
    const dpr = viewport.devicePixelRatio
    const transform = viewport.transform
    if (!active) return
    renderer?.render(transform, size, dpr, buildScene(), swatches.resolve)
  })
</script>

<canvas class="glass-render" class:hidden={!active} bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .glass-render {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .glass-render.hidden {
    display: none;
  }
</style>
