<script lang="ts">
  import { worldToScreen, type Piece, type ResolvedSun } from '@vitrum/core'
  import type { BBox } from '@vitrum/geometry'
  import type { Glass, GlassId, Segment } from '@vitrum/model'
  import { onMount } from 'svelte'

  import type { TechniqueRender } from '../canvas/render'
  import { segmentToWorldPoints } from '../canvas/scene'
  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { CameRibbonInput, GlassPieceInput, TextureTransform } from '../render/glass-gl'

  import { createLightRenderer, type LightRenderer, type LightScene } from './light-gl'

  interface Props {
    viewport: ViewportController
    /** Whether the light simulation is showing (the `light` view mode). Inert otherwise. */
    active: boolean
    /** Detected pieces to render as sun-lit glass. */
    pieces: readonly Piece[]
    /** Effective glass id of a piece, or undefined (rendered as pale clear glass). */
    glassFor: (piece: Piece) => GlassId | undefined
    glasses: Readonly<Record<GlassId, Glass>>
    textureTransformFor: (piece: Piece) => TextureTransform
    /** The lead-line network, rendered as black occluders that break the light rays. */
    segments: readonly Segment[]
    technique?: TechniqueRender
    /** The resolved sun for the current moment (pure core derivation). */
    sun: ResolvedSun
    /** World bounds of the panel, so the solar halo can be placed relative to the content. */
    bounds: BBox | null
    showTextures: boolean
    photoGrain: boolean
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
    sun,
    bounds,
    showTextures,
    photoGrain,
  }: Props = $props()

  let canvas: HTMLCanvasElement
  let renderer: LightRenderer | null = null

  const UNASSIGNED_GLASS = {
    color: '#c9c9c4',
    transparency: 'translucent' as const,
    texture: 'smooth' as const,
  }

  const IDENTITY_TEXTURE: TextureTransform = {
    rotationDeg: 0,
    offsetXmm: 0,
    offsetYmm: 0,
    scale: 1,
  }

  /** Sun position in normalised canvas coords (y-down), placed relative to the panel content. */
  function sunScreen(): { x: number; y: number } {
    const size = viewport.size
    const w = size.width || 1
    const h = size.height || 1
    let cx = w / 2
    let cy = h / 2
    let radius = Math.min(w, h) * 0.5
    if (bounds) {
      const min = worldToScreen(viewport.transform, bounds.min)
      const max = worldToScreen(viewport.transform, bounds.max)
      cx = (min.x + max.x) / 2
      cy = (min.y + max.y) / 2
      radius = Math.max(60, Math.hypot(max.x - min.x, max.y - min.y) * 0.55)
    }
    const sx = cx + sun.inPlaneX * radius
    const sy = cy - sun.inPlaneY * radius // in-plane Y is up; screen Y is down
    return { x: sx / w, y: sy / h }
  }

  function buildScene(): LightScene {
    const pieceInputs: GlassPieceInput[] = pieces.map((piece) => {
      const glassId = glassFor(piece)
      const glass = glassId ? glasses[glassId] : undefined
      return {
        ring: piece.ring,
        holeRings: piece.holeRings,
        bbox: piece.bbox,
        color: glass?.color ?? UNASSIGNED_GLASS.color,
        transparency: glass?.transparency ?? UNASSIGNED_GLASS.transparency,
        texture: glass?.texture ?? UNASSIGNED_GLASS.texture,
        textureTransform: textureTransformFor(piece) ?? IDENTITY_TEXTURE,
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

    return { pieces: pieceInputs, cames, sun, sunScreen: sunScreen(), showTextures, photoGrain }
  }

  onMount(() => {
    // Returns null under jsdom / when WebGL2 is unavailable; the effect then no-ops.
    renderer = createLightRenderer(canvas)
    return () => renderer?.dispose()
  })

  $effect(() => {
    const size = viewport.size
    const dpr = viewport.devicePixelRatio
    const transform = viewport.transform
    void sun
    void pieces
    void segments
    void showTextures
    void photoGrain
    if (!active) return
    renderer?.render(transform, size, dpr, buildScene())
  })
</script>

<canvas class="light-render" class:hidden={!active} bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .light-render {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .light-render.hidden {
    display: none;
  }
</style>
