<script lang="ts">
  import type { HealSegment } from '@vitrum/core'
  import { bboxOf, bboxUnion, type BBox } from '@vitrum/geometry'

  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import Slider from '../components/Slider.svelte'
  import { segmentToWorldPoints } from '../canvas/scene'

  import type { ImportController } from './controller.svelte'

  interface Props {
    controller: ImportController
    /** Fired when the user confirms; the shell merges the healed network as one undo step. */
    onImport: () => void
  }

  let { controller, onImport }: Props = $props()

  const ROLE_OPTIONS = [
    { value: 'lead', label: 'Lead lines' },
    { value: 'construction', label: 'Construction guides' },
  ]

  const MAX_TOLERANCE_MM = 5

  const preview = $derived(controller.preview)
  const dropped = $derived(preview?.dropped ?? [])
  const canImport = $derived((preview?.segments.length ?? 0) > 0)

  let canvasEl = $state<HTMLCanvasElement | null>(null)

  /** Bounding box of a healed network (world mm), or null when empty. */
  function boundsOf(segments: readonly HealSegment[]): BBox | null {
    let box: BBox | null = null
    for (const s of segments) box = box ? bboxUnion(box, bboxOf(s.geometry)) : bboxOf(s.geometry)
    return box
  }

  // Redraw the preview whenever the healed network changes. Chrome/overlay colours are read from
  // leaf design tokens (semantic aliases resolve to var(...) and are unusable on a 2D canvas); the
  // draw is guarded on a null context so the component renders under jsdom in tests.
  $effect(() => {
    const canvas = canvasEl
    const p = preview
    if (!canvas) return
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    const cssW = canvas.clientWidth || 512
    const cssH = canvas.clientHeight || 240
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    if (!p || p.segments.length === 0) return

    const cs = getComputedStyle(canvas)
    const ink = cs.getPropertyValue('--ink-800').trim() || '#1f1f1f'
    const accent = cs.getPropertyValue('--cobalt-500').trim() || '#2f63e8'

    const box = boundsOf(p.segments)
    if (!box) return
    const pad = 16
    const w = Math.max(box.max.x - box.min.x, 1e-6)
    const h = Math.max(box.max.y - box.min.y, 1e-6)
    const scale = Math.min((cssW - 2 * pad) / w, (cssH - 2 * pad) / h)
    const ox = (cssW - w * scale) / 2 - box.min.x * scale
    const oy = (cssH - h * scale) / 2 - box.min.y * scale
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Draw unchanged segments first (ink), then changed segments on top (accent) so healing shows.
    for (const changed of [false, true]) {
      ctx.strokeStyle = changed ? accent : ink
      ctx.lineWidth = changed ? 2 : 1
      for (const seg of p.segments) {
        if (p.heal.changedIds.has(seg.id) !== changed) continue
        const pts = segmentToWorldPoints(seg.geometry)
        ctx.beginPath()
        pts.forEach((pt, i) => {
          const x = pt.x * scale + ox
          const y = pt.y * scale + oy
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }
    }
  })

  function num(value: string, fallback: number): number {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : fallback
  }
</script>

<Dialog open={controller.open} title="Import SVG" width={560} onClose={() => controller.close()}>
  <div class="import">
    {#if controller.error}
      <p class="error" role="alert">Could not read the file: {controller.error}</p>
    {:else if !preview}
      <p class="note">Choose an SVG file to import.</p>
    {:else}
      <p class="file">{controller.fileName}</p>

      <canvas bind:this={canvasEl} aria-label="Import preview"></canvas>

      <div class="stats" aria-live="polite">
        <span>Pieces detected: <span class="mono">{preview.pieceCount}</span></span>
        <span class="detail">
          snapped <span class="mono">{preview.heal.summary.snapped}</span> · split
          <span class="mono">{preview.heal.summary.split}</span> · dropped
          <span class="mono">{preview.heal.summary.dropped}</span>
        </span>
      </div>

      <Slider
        label="Healing tolerance"
        min={0}
        max={MAX_TOLERANCE_MM}
        step={0.05}
        value={controller.sliderMm}
        valueLabel={`${controller.sliderMm.toFixed(2)} mm`}
        onchange={(v) => controller.setTolerance(v)}
      />
      <p class="note">
        A higher tolerance welds endpoints that miss and splits paths that cross; healed edges are
        shown in blue. At <span class="mono">0.00 mm</span> only exact coincidences merge.
      </p>

      <div class="grid">
        <Select
          size="sm"
          label="Import as"
          options={ROLE_OPTIONS}
          value={controller.role}
          onchange={(v) => (controller.role = v as 'lead' | 'construction')}
        />
        {#if controller.ambiguous}
          <Input
            size="sm"
            label="Artwork width (mm)"
            value={String(Math.round(controller.targetWidthMm * 100) / 100)}
            onchange={(v) => controller.setTargetWidth(num(v, controller.targetWidthMm))}
          />
        {/if}
      </div>

      {#if controller.ambiguous}
        <p class="note">
          This file has no physical size, so its scale is set here — the default is 1 SVG unit = 1
          mm. Set the artwork width to rescale the whole drawing proportionally.
        </p>
      {/if}

      {#if dropped.length > 0}
        <p class="dropped" role="note">
          Unsupported content was dropped: {dropped.join(', ')}.
        </p>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => controller.close()}>Cancel</Button>
    <Button variant="primary" size="sm" disabled={!canImport} onclick={onImport}>Import</Button>
  {/snippet}
</Dialog>

<style>
  .import {
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
    height: 240px;
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
  }

  .note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .dropped {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warning-100);
    color: var(--warning-600);
    font: var(--text-small);
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
