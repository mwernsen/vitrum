<script lang="ts">
  import type { DrawRole, InkMask } from '@vitrum/core'

  import { segmentToWorldPoints } from '../canvas/scene'
  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Select from '../components/Select.svelte'
  import Slider from '../components/Slider.svelte'
  import Switch from '../components/Switch.svelte'

  import type { TraceController } from './controller.svelte'

  interface Props {
    controller: TraceController
    /** Fired when the user confirms; the shell merges the traced network as one undo step. */
    onTrace: () => void
  }

  let { controller, onTrace }: Props = $props()

  /**
   * The autotrace dialog (F-059).
   *
   * No design exists for this screen in the Claude Design project, so it is built in code against the
   * design system — and deliberately in **F-050's `ImportDialog` language** rather than a second
   * dialog idiom: the same shape of problem (a preview, tolerance sliders, and a live piece count),
   * so the same layout, the same `Slider` primitive, and the same live-count affordance. Tokens only,
   * `components/core` primitives, sentence case, numbers in mono.
   *
   * The one thing it adds is that the preview shows the **binarised mask** under the traced linework,
   * not just the linework. The threshold is the control that does the real work here — bold marker
   * versus mid-grey pencil is what keeps hand annotations out of the geometry (FR-8) — and a piece
   * count alone cannot tell you whether you have lost a line or gained a smudge.
   */

  const ROLE_OPTIONS = [
    { value: 'lead', label: 'Lead lines' },
    { value: 'construction', label: 'Construction guides' },
  ]

  const preview = $derived(controller.preview)
  const options = $derived(controller.options)

  let canvasEl = $state<HTMLCanvasElement | null>(null)

  // Redraw whenever the trace changes. Chrome/overlay colours come from leaf design tokens (semantic
  // aliases resolve to var(...) and are unusable on a 2D canvas); the draw is guarded on a null
  // context so the component renders under jsdom in tests.
  $effect(() => {
    const canvas = canvasEl
    const p = preview
    if (!canvas) return
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    const cssW = canvas.clientWidth || 512
    const cssH = canvas.clientHeight || 260
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    if (!p) return

    const cs = getComputedStyle(canvas)
    const ink = cs.getPropertyValue('--ink-800').trim() || '#1f1f1f'
    const accent = cs.getPropertyValue('--cobalt-500').trim() || '#2f63e8'
    const faint = cs.getPropertyValue('--ink-300').trim() || '#b9b9b9'

    // The sheet fits the box; the mask and the geometry are drawn through the *same* transform, via
    // the traced grid's own mm-per-pixel — so a traced line sits exactly on the ink it came from, and
    // a line the threshold lost shows up as bare ink with nothing on it.
    const { mask } = p
    const grid = controller.grid
    if (mask.width === 0 || mask.height === 0 || !grid) return
    const pad = 10
    const scale = Math.min((cssW - 2 * pad) / mask.width, (cssH - 2 * pad) / mask.height)
    const drawW = mask.width * scale
    const drawH = mask.height * scale
    const ox = (cssW - drawW) / 2
    const oy = (cssH - drawH) / 2

    const raster = maskCanvas(mask, faint)
    if (raster) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(raster, ox, oy, drawW, drawH)
    }

    /** World mm → preview box. */
    const toBox = (pt: { x: number; y: number }) => ({
      x: ox + ((pt.x - grid.origin.x) / grid.mmPerPx) * scale,
      y: oy + ((pt.y - grid.origin.y) / grid.mmPerPx) * scale,
    })

    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // Everything in ink, then the healed subset over it in accent — `healed` is a filtered copy, so
    // it cannot be identified inside `segments` by identity, and overdrawing is both simpler and
    // exactly what should be seen.
    for (const [list, colour, width] of [
      [p.segments, ink, 1],
      [p.healed, accent, 1.6],
    ] as const) {
      ctx.strokeStyle = colour
      ctx.lineWidth = width
      for (const seg of list) {
        const pts = segmentToWorldPoints(seg.geometry)
        ctx.beginPath()
        pts.forEach((pt, i) => {
          const { x, y } = toBox(pt)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }
    }
  })

  /** An offscreen canvas holding the ink mask, so it can be scaled into the preview box. */
  function maskCanvas(mask: InkMask, colour: string): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null
    const el = document.createElement('canvas')
    el.width = mask.width
    el.height = mask.height
    const ctx = el.getContext('2d')
    if (!ctx) return null
    const image = ctx.createImageData(mask.width, mask.height)
    const [r, g, b] = parseColour(colour)
    for (let i = 0; i < mask.data.length; i++) {
      const o = i * 4
      image.data[o] = r
      image.data[o + 1] = g
      image.data[o + 2] = b
      image.data[o + 3] = mask.data[i] === 1 ? 255 : 0
    }
    ctx.putImageData(image, 0, 0)
    return el
  }

  /** `#rgb`/`#rrggbb` to a triple; anything else falls back to a mid grey. */
  function parseColour(value: string): [number, number, number] {
    const hex = value.replace('#', '')
    if (hex.length === 3) {
      return [
        Number.parseInt(hex[0]! + hex[0]!, 16),
        Number.parseInt(hex[1]! + hex[1]!, 16),
        Number.parseInt(hex[2]! + hex[2]!, 16),
      ]
    }
    if (hex.length === 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ]
    }
    return [180, 180, 180]
  }
</script>

<Dialog
  open={controller.open}
  title="Autotrace reference image"
  width={560}
  onClose={() => controller.close()}
>
  <div class="trace">
    {#if controller.error}
      <p class="error" role="alert">{controller.error}</p>
    {:else}
      {#if controller.layerName}
        <p class="file">{controller.layerName}</p>
      {/if}

      <canvas bind:this={canvasEl} aria-label="Autotrace preview"></canvas>

      <div class="stats" aria-live="polite">
        <span>
          Pieces detected: <span class="mono" data-testid="trace-piece-count">
            {preview?.pieceCount ?? 0}
          </span>
        </span>
        <span class="detail">
          <span class="mono" data-testid="trace-segment-count">{preview?.segments.length ?? 0}</span
          >
          segments ·
          <span class="mono">{controller.grid?.width ?? 0}×{controller.grid?.height ?? 0}</span> px
          {#if controller.busy}· working{/if}
        </span>
      </div>

      <Slider
        label="Ink threshold"
        min={40}
        max={200}
        step={1}
        value={options.thresholdLuma}
        valueLabel={`${options.thresholdLuma}`}
        onchange={(v) => controller.set({ thresholdLuma: v })}
      />
      <p class="note">
        The control that matters. Bold marker is near-black and pencil is mid-grey, so this is what
        keeps hand-written piece numbers and colour notes out of the geometry. Raise it until every
        drawn line shows in the preview, then stop.
      </p>

      <Slider
        label="Despeckle"
        min={0}
        max={600}
        step={10}
        value={options.minBlobPx}
        valueLabel={`${options.minBlobPx} px`}
        onchange={(v) => controller.set({ minBlobPx: v })}
      />

      <Slider
        label="Simplification"
        min={0}
        max={3}
        step={0.05}
        value={options.simplifyMm}
        valueLabel={`${options.simplifyMm.toFixed(2)} mm`}
        onchange={(v) => controller.set({ simplifyMm: v })}
      />

      <Slider
        label="Curve fit"
        min={0}
        max={3}
        step={0.05}
        value={options.fitMm}
        valueLabel={`${options.fitMm.toFixed(2)} mm`}
        onchange={(v) => controller.set({ fitMm: v })}
      />
      <p class="note">
        At <span class="mono">0.00 mm</span> the trace stays a chain of straight segments; above it, smooth
        runs become curves and straight runs stay straight.
      </p>

      <Slider
        label="Healing tolerance"
        min={0}
        max={5}
        step={0.05}
        value={options.healMm}
        valueLabel={`${options.healMm.toFixed(2)} mm`}
        onchange={(v) => controller.set({ healMm: v })}
      />
      <p class="note">
        Welds endpoints that miss and splits lines that cross; healed edges are shown in blue.
        {#if preview}
          Snapped <span class="mono">{preview.summary.snapped}</span> · split
          <span class="mono">{preview.summary.split}</span> · dropped
          <span class="mono">{preview.summary.dropped}</span>.
        {/if}
      </p>

      <div class="grid">
        <Select
          size="sm"
          label="Trace as"
          options={ROLE_OPTIONS}
          value={options.role}
          onchange={(v) => controller.set({ role: v as DrawRole })}
        />
        <div class="toggle">
          <Switch
            label="Outer contour is the panel border"
            checked={options.outerAsBorder}
            onchange={(on) => controller.set({ outerAsBorder: on })}
          />
        </div>
      </div>
      <p class="note">
        Off by default: it is a guess at intent. Turn it on when the cartoon draws its own panel
        edge.
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => controller.close()}>Cancel</Button>
    <Button variant="primary" size="sm" disabled={!controller.canTrace} onclick={onTrace}>
      Add lead lines
    </Button>
  {/snippet}
</Dialog>

<style>
  .trace {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .file {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  canvas {
    width: 100%;
    height: 260px;
    box-sizing: border-box;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }

  .stats {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    font: var(--text-small);
    color: var(--text-body);
  }

  .stats .detail {
    color: var(--text-muted);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    align-items: end;
  }

  .toggle {
    padding-bottom: var(--space-2);
  }

  .note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .error {
    margin: 0;
    font: var(--text-small);
    color: var(--danger-600);
  }
</style>
