<script lang="ts">
  import {
    DEFAULT_BACKLIGHT,
    hexToRgb,
    litColor,
    textureModulation,
    transmission,
  } from '@vitrum/core'
  import type { Glass } from '@vitrum/model'

  /**
   * A live preview of one glass: its colour under neutral daylight, modulated by the procedural
   * surface texture — the same shading model the F-053 render view uses on the GPU, mirrored on the
   * CPU through `textureModulation`, so picking "hammered" in the glass editor looks like hammered
   * glass will look on the panel. An uploaded swatch photo takes over as the surface (its luminance
   * modulating the base colour), matching what the renderer does with one.
   *
   * Drawn on a 2D canvas: guarded on a null context, so it is inert (but still mounted) in jsdom.
   */
  interface Props {
    /** The glass to preview — read reactively, so it tracks an editor draft as the user types. */
    glass: Pick<Glass, 'color' | 'transparency' | 'texture' | 'swatch'>
    /** Side of the square preview in CSS px. */
    size?: number
  }

  let { glass, size = 132 }: Props = $props()

  /** World mm the preview spans, so texture frequencies (defined per mm) read at a useful scale. */
  const SPAN_MM = 90

  let canvas = $state<HTMLCanvasElement>()
  /** The decoded swatch photo, or null. Reset while a new one decodes. */
  let swatchImage = $state<HTMLImageElement | null>(null)

  $effect(() => {
    const src = glass.swatch
    if (!src) {
      swatchImage = null
      return
    }
    const img = new Image()
    let cancelled = false
    img.onload = () => {
      if (!cancelled) swatchImage = img
    }
    img.src = src
    return () => {
      cancelled = true
    }
  })

  $effect(() => {
    const el = canvas
    if (!el) return
    // Read every input so the effect re-runs on any draft change.
    const { color, transparency, texture } = glass
    const photo = swatchImage

    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    const px = Math.max(1, Math.round(size * dpr))
    el.width = px
    el.height = px
    const ctx = el.getContext('2d')
    if (!ctx) return // jsdom: nothing to draw on, and nothing to assert about pixels.

    const lit = litColor(hexToRgb(color), transmission(transparency), DEFAULT_BACKLIGHT)
    const image = ctx.createImageData(px, px)
    const mmPerPx = SPAN_MM / px
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const m = textureModulation(texture, x * mmPerPx, y * mmPerPx)
        const i = (y * px + x) * 4
        image.data[i] = clampByte(lit.r * m)
        image.data[i + 1] = clampByte(lit.g * m)
        image.data[i + 2] = clampByte(lit.b * m)
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)

    if (photo) {
      // The renderer mixes the photo's luminance into the base colour; `luminosity` over a
      // 60%-opaque draw is the 2D equivalent — hue stays the glass's, structure comes from the photo.
      ctx.save()
      ctx.globalAlpha = 0.6
      ctx.globalCompositeOperation = 'luminosity'
      ctx.drawImage(photo, 0, 0, px, px)
      ctx.restore()
    }
  })

  function clampByte(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v * 255)))
  }
</script>

<!-- The accessible name lives on the wrapper: a <canvas> cannot carry role="img". -->
<div
  class="preview"
  style="width:{size}px; height:{size}px"
  role="img"
  aria-label="Preview of {glass.transparency} {glass.texture} glass"
>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
  .preview {
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .preview canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
