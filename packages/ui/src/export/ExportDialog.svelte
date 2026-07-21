<script lang="ts">
  import type { ExportFormat, Orientation, PdfLook, PdfScaleMode, SvgFlavor } from '@vitrum/paper'

  import Button from '../components/Button.svelte'
  import Checkbox from '../components/Checkbox.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Select from '../components/Select.svelte'

  import type { ExportController } from './controller.svelte'

  interface Props {
    controller: ExportController
    /** Whether there is anything to export (pieces detected + a host export port). */
    canExport: boolean
    /** Outstanding DRC error count (F-030); shown as a warning but never blocks (policy: warn). */
    drcErrorCount: number
    /** Whether DRC has run at least once, so "0 errors" isn't shown before the first check. */
    checksRun: boolean
    /** Fired when the user confirms; the shell builds the scene and writes via the host. */
    onExport: () => void
  }

  let { controller, canExport, drcErrorCount, checksRun, onExport }: Props = $props()

  const FORMAT_OPTIONS = [
    { value: 'svg', label: 'SVG (design + cutting machines)' },
    { value: 'pdf', label: 'PDF (single sheet)' },
    { value: 'dxf', label: 'DXF (CAD, waterjet, plotters)' },
  ]
  const SVG_FLAVOR_OPTIONS = [
    { value: 'linework', label: 'Linework (lead lines)' },
    { value: 'cut', label: 'Cut templates (per piece)' },
    { value: 'render', label: 'Coloured render' },
  ]
  const CUT_LAYOUT_OPTIONS = [
    { value: 'in-place', label: 'In place' },
    { value: 'grid', label: 'Spread on a grid' },
  ]
  const PDF_SCALE_OPTIONS = [
    { value: 'actual', label: 'Actual size (1:1)' },
    { value: 'fit', label: 'Scaled to fit a page' },
  ]
  const PDF_LOOK_OPTIONS = [
    { value: 'render', label: 'Coloured render' },
    { value: 'cartoon', label: 'Cartoon (line work)' },
  ]
  const PAPER_OPTIONS = [
    { value: 'a4', label: 'A4 (210 × 297 mm)' },
    { value: 'a3', label: 'A3 (297 × 420 mm)' },
    { value: 'letter', label: 'Letter (8.5 × 11 in)' },
  ]
  const ORIENTATION_OPTIONS = [
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
  ]

  // Piece numbers apply to every flavour except SVG linework (which is pure geometry).
  const numbersApply = $derived(
    !(controller.format === 'svg' && controller.svgFlavor === 'linework'),
  )
</script>

<Dialog open={controller.open} title="Export" width={560} onClose={() => (controller.open = false)}>
  <div class="export">
    <Select
      size="sm"
      label="Format"
      options={FORMAT_OPTIONS}
      value={controller.format}
      onchange={(v) => (controller.format = v as ExportFormat)}
    />

    {#if controller.format === 'svg'}
      <div class="grid">
        <Select
          size="sm"
          label="Flavour"
          options={SVG_FLAVOR_OPTIONS}
          value={controller.svgFlavor}
          onchange={(v) => (controller.svgFlavor = v as SvgFlavor)}
        />
        {#if controller.svgFlavor === 'cut'}
          <Select
            size="sm"
            label="Layout"
            options={CUT_LAYOUT_OPTIONS}
            value={controller.cutLayout}
            onchange={(v) => (controller.cutLayout = v as 'in-place' | 'grid')}
          />
        {/if}
      </div>
      <p class="note">
        SVG carries physical millimetre dimensions, so 1 mm in the file is 1 mm on the ruler in
        Inkscape or Illustrator.
        {#if controller.svgFlavor === 'cut'}
          Cut templates are one closed path per piece, numbered for Cricut and Silhouette.
        {/if}
      </p>
    {:else if controller.format === 'pdf'}
      <div class="grid">
        <Select
          size="sm"
          label="Scale"
          options={PDF_SCALE_OPTIONS}
          value={controller.pdfScaleMode}
          onchange={(v) => (controller.pdfScaleMode = v as PdfScaleMode)}
        />
        <Select
          size="sm"
          label="Look"
          options={PDF_LOOK_OPTIONS}
          value={controller.pdfLook}
          onchange={(v) => (controller.pdfLook = v as PdfLook)}
        />
        {#if controller.pdfScaleMode === 'fit'}
          <Select
            size="sm"
            label="Page size"
            options={PAPER_OPTIONS}
            value={controller.pdfPaperId}
            onchange={(v) => (controller.pdfPaperId = v)}
          />
          <Select
            size="sm"
            label="Orientation"
            options={ORIENTATION_OPTIONS}
            value={controller.pdfOrientation}
            onchange={(v) => (controller.pdfOrientation = v as Orientation)}
          />
        {/if}
      </div>
      <p class="note">
        A single sheet holding the whole design. Actual size prints 1:1; scaled to fit prints the
        scale factor for reference — for a taped 1:1 cartoon use the 1:1 print instead.
      </p>
    {:else}
      <p class="note">
        DXF exports the lead-line network and cut contours on separate layers (LEAD, BORDER, CUT,
        REBAR) in millimetres — arcs stay arcs, curves become fine polylines. Opens in AutoCAD-class
        and CAM software.
      </p>
    {/if}

    {#if numbersApply}
      <Checkbox
        label="Include piece numbers"
        checked={controller.includeNumbers}
        onchange={(c) => (controller.includeNumbers = c)}
      />
    {/if}

    {#if checksRun && drcErrorCount > 0}
      <p class="drc" role="alert">
        <span class="mono">{drcErrorCount}</span> outstanding design rule
        {drcErrorCount === 1 ? 'error' : 'errors'}. You can still export.
      </p>
    {/if}

    {#if controller.errorMessage}
      <p class="error" role="alert">Export failed: {controller.errorMessage}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => (controller.open = false)}>Cancel</Button>
    <Button
      variant="primary"
      size="sm"
      disabled={!canExport || controller.exporting}
      onclick={onExport}
    >
      {controller.exporting ? 'Exporting…' : 'Export'}
    </Button>
  {/snippet}
</Dialog>

<style>
  .export {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
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

  .drc {
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
