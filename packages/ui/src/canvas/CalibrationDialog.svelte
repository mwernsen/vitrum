<script lang="ts">
  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Select from '../components/Select.svelte'

  import {
    CREDIT_CARD_WIDTH_MM,
    clearCalibration,
    defaultPxPerMm,
    saveCalibration,
  } from './calibration'
  import type { ViewportController } from './viewport.svelte'

  interface Props {
    open?: boolean
    viewport: ViewportController
    onClose?: () => void
  }

  let { open = $bindable(false), viewport, onClose }: Props = $props()

  const references = [
    { label: 'Credit card — 85.6 mm', value: String(CREDIT_CARD_WIDTH_MM) },
    { label: 'Ruler — 100 mm', value: '100' },
    { label: 'Ruler — 2 in', value: '50.8' },
  ]

  let referenceValue = $state(references[0]!.value)
  const referenceMm = $derived(Number.parseFloat(referenceValue))

  // Width, in CSS px, of the on-screen bar the user matches to the physical reference.
  let barWidthPx = $state(defaultPxPerMm() * CREDIT_CARD_WIDTH_MM)

  const computedPxPerMm = $derived(barWidthPx / referenceMm)
  const computedDpi = $derived(computedPxPerMm * 25.4)

  // Re-seed the bar from the current calibration whenever the dialog opens or the
  // reference changes, so it starts matching the display's present scale.
  $effect(() => {
    if (open) barWidthPx = viewport.pxPerMm * referenceMm
  })

  let dragging = false
  let dragStartX = 0
  let dragStartWidth = 0

  function startDrag(event: PointerEvent) {
    dragging = true
    dragStartX = event.clientX
    dragStartWidth = barWidthPx
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function onDrag(event: PointerEvent) {
    if (!dragging) return
    barWidthPx = Math.max(40, dragStartWidth + (event.clientX - dragStartX))
  }

  function endDrag(event: PointerEvent) {
    dragging = false
    const el = event.currentTarget as HTMLElement
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
  }

  function save() {
    viewport.setCalibration(computedPxPerMm)
    saveCalibration(computedPxPerMm)
    onClose?.()
  }

  function reset() {
    clearCalibration()
    viewport.setCalibration(defaultPxPerMm())
    barWidthPx = defaultPxPerMm() * referenceMm
  }
</script>

<Dialog bind:open title="Calibrate 1:1 size" width={480} {onClose}>
  <div class="calibrate">
    <p class="intro">
      Hold the reference object flat against the screen and drag the bar until it matches the
      object's real width. This sets the physical scale for 1:1 zoom on this display.
    </p>

    <Select label="Reference" options={references} bind:value={referenceValue} size="sm" />

    <div class="stage">
      <div class="bar" style="width:{barWidthPx}px">
        <span class="bar-label">{referenceMm.toFixed(1)} mm</span>
        <button
          class="handle"
          type="button"
          aria-label="Drag to match the reference width"
          onpointerdown={startDrag}
          onpointermove={onDrag}
          onpointerup={endDrag}
          onpointercancel={endDrag}
        ></button>
      </div>
    </div>

    <dl class="readout">
      <div>
        <dt>Scale</dt>
        <dd>{computedPxPerMm.toFixed(3)} px/mm</dd>
      </div>
      <div>
        <dt>Density</dt>
        <dd>{Math.round(computedDpi)} dpi</dd>
      </div>
    </dl>
  </div>

  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={reset}>Reset to default</Button>
    <Button variant="secondary" size="sm" onclick={() => onClose?.()}>Cancel</Button>
    <Button variant="primary" size="sm" onclick={save}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .calibrate {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .intro {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .stage {
    padding: var(--space-4) 0;
    overflow-x: auto;
  }

  .bar {
    position: relative;
    height: 44px;
    min-width: 40px;
    display: flex;
    align-items: center;
    padding-left: var(--space-3);
    background: var(--cobalt-50);
    border: 1px solid var(--cobalt-500);
    border-radius: var(--radius-sm);
  }

  .bar-label {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--cobalt-700);
  }

  .handle {
    position: absolute;
    right: -7px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 36px;
    padding: 0;
    background: var(--cobalt-500);
    border: none;
    border-radius: var(--radius-xs);
    cursor: ew-resize;
    touch-action: none;
  }

  .readout {
    display: flex;
    gap: var(--space-6);
    margin: 0;
  }

  .readout div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .readout dt {
    font: var(--text-caption);
    color: var(--text-muted);
  }

  .readout dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--text-strong);
  }
</style>
