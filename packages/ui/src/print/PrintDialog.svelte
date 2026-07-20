<script lang="ts">
  import type { BBox } from '@vitrum/geometry'
  import type { Orientation, PrintContent } from '@vitrum/paper'

  import Button from '../components/Button.svelte'
  import Checkbox from '../components/Checkbox.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'

  import type { PrintController } from './controller.svelte'

  interface Props {
    controller: PrintController
    /** Content bounds to tile over (panel ∪ geometry), for the live tile-count summary. */
    bounds: BBox | null
    pieceCount: number
    /** Outstanding DRC error count (F-030); shown as a warning but never blocks (policy: warn). */
    drcErrorCount: number
    /** Whether DRC has run at least once, so "0 errors" isn't shown before the first check. */
    checksRun: boolean
    /** Fired when the user confirms export; the shell builds the scene and writes via the host. */
    onExport: () => void
  }

  let { controller, bounds, pieceCount, drcErrorCount, checksRun, onExport }: Props = $props()

  const PAPER_OPTIONS = [
    { value: 'a4', label: 'A4 (210 × 297 mm)' },
    { value: 'a3', label: 'A3 (297 × 420 mm)' },
    { value: 'letter', label: 'Letter (8.5 × 11 in)' },
    { value: 'custom', label: 'Custom…' },
  ]
  const ORIENTATION_OPTIONS = [
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
  ]
  const CONTENT_OPTIONS = [
    { value: 'cartoon', label: 'Cartoon (line work + numbers)' },
    { value: 'cut', label: 'Cut contours' },
    { value: 'render', label: 'Coloured render' },
  ]

  const tiling = $derived(controller.tilingFor(bounds))
  const pageCount = $derived(
    tiling ? tiling.tiles.length + (controller.includeOverviewMap ? 1 : 0) : 0,
  )
  const canExport = $derived(pieceCount > 0 && tiling !== null && !controller.exporting)

  function num(value: string, fallback: number): number {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : fallback
  }
</script>

<Dialog
  open={controller.open}
  title="Print cartoon 1:1"
  width={560}
  onClose={() => (controller.open = false)}
>
  <div class="print">
    <div class="grid">
      <Select
        size="sm"
        label="Paper size"
        options={PAPER_OPTIONS}
        value={controller.paperId}
        onchange={(v) => (controller.paperId = v)}
      />
      <Select
        size="sm"
        label="Orientation"
        options={ORIENTATION_OPTIONS}
        value={controller.orientation}
        onchange={(v) => (controller.orientation = v as Orientation)}
      />
      {#if controller.paperId === 'custom'}
        <Input
          size="sm"
          label="Sheet width (mm)"
          value={String(controller.customWidthMm)}
          onchange={(v) => (controller.customWidthMm = num(v, controller.customWidthMm))}
        />
        <Input
          size="sm"
          label="Sheet height (mm)"
          value={String(controller.customHeightMm)}
          onchange={(v) => (controller.customHeightMm = num(v, controller.customHeightMm))}
        />
      {/if}
      <Input
        size="sm"
        label="Margin (mm)"
        value={String(controller.marginMm)}
        onchange={(v) => (controller.marginMm = num(v, controller.marginMm))}
      />
      <Input
        size="sm"
        label="Overlap (mm)"
        value={String(controller.overlapMm)}
        onchange={(v) => (controller.overlapMm = num(v, controller.overlapMm))}
      />
      <Select
        size="sm"
        label="Content"
        options={CONTENT_OPTIONS}
        value={controller.content}
        onchange={(v) => (controller.content = v as PrintContent)}
      />
    </div>

    <fieldset class="includes">
      <legend>Include</legend>
      <Checkbox
        label="Piece numbers"
        checked={controller.includeNumbers}
        onchange={(c) => (controller.includeNumbers = c)}
      />
      <Checkbox
        label="Glass legend"
        checked={controller.includeGlassCodes}
        onchange={(c) => (controller.includeGlassCodes = c)}
      />
      <Checkbox
        label="Alignment marks"
        checked={controller.includeAlignmentMarks}
        onchange={(c) => (controller.includeAlignmentMarks = c)}
      />
      <Checkbox
        label="Page labels"
        checked={controller.includePageLabels}
        onchange={(c) => (controller.includePageLabels = c)}
      />
      <Checkbox
        label="Calibration ruler"
        checked={controller.includeCalibrationRuler}
        onchange={(c) => (controller.includeCalibrationRuler = c)}
      />
      <Checkbox
        label="Overview map page"
        checked={controller.includeOverviewMap}
        onchange={(c) => (controller.includeOverviewMap = c)}
      />
    </fieldset>

    <div class="summary" aria-live="polite">
      {#if tiling}
        <span class="tiles"
          >{tiling.cols} × {tiling.rows} tiles · <span class="mono">{pageCount}</span> pages</span
        >
        <span class="detail">{controller.paper.label} {controller.orientation}</span>
      {:else}
        <span class="warn">Margins leave no printable area — reduce the margin.</span>
      {/if}
    </div>

    <p class="calibration">
      Every sheet carries a 100 mm calibration ruler. Set your printer to <strong
        >100% (actual size)</strong
      > — do not use "fit to page", or the print will not be 1:1.
    </p>

    {#if checksRun && drcErrorCount > 0}
      <p class="drc" role="alert">
        <span class="mono">{drcErrorCount}</span> outstanding design rule
        {drcErrorCount === 1 ? 'error' : 'errors'}. You can still print.
      </p>
    {/if}

    {#if controller.errorMessage}
      <p class="error" role="alert">Export failed: {controller.errorMessage}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => (controller.open = false)}>Cancel</Button>
    <Button variant="primary" size="sm" disabled={!canExport} onclick={onExport}>
      {controller.exporting ? 'Exporting…' : 'Export PDF'}
    </Button>
  {/snippet}
</Dialog>

<style>
  .print {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .includes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .includes legend {
    padding: 0 var(--space-2);
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .summary {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    font: var(--text-small);
    color: var(--text-body);
  }

  .summary .detail {
    color: var(--text-muted);
  }

  .summary .warn {
    color: var(--warning-600);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .calibration {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .drc {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warning-100);
    color: var(--warning-600);
    font: var(--text-small);
  }

  .error {
    margin: 0;
    font: var(--text-small);
    color: var(--danger-600);
  }
</style>
