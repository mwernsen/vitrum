<script lang="ts">
  import type { BBox } from '@vitrum/geometry'
  import type { Orientation, PdfLook, PdfScaleMode, PrintContent, SvgFlavor } from '@vitrum/paper'

  import Button from '../components/Button.svelte'
  import Checkbox from '../components/Checkbox.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import type { BomController } from '../bom/controller.svelte'
  import type { PrintController } from '../print/controller.svelte'
  import type { QuoteController } from '../quote/controller.svelte'

  import type {
    BomFileFormat,
    DesignFileFormat,
    ExportController,
    OutputDocType,
  } from './controller.svelte'

  interface Props {
    /** The hub's own state (document type + design/PDF/PNG options). */
    controller: ExportController
    /** The F-041 print controller — drives the 1:1 tiled document type. */
    print: PrintController
    /** The F-042 BOM controller — drives the cutting-list document type. */
    bom: BomController
    /** The F-056 quote controller — drives the client quote document type. */
    quote: QuoteController
    /** Content bounds to tile over (panel ∪ geometry), for the tiled tile-count summary. */
    bounds: BBox | null
    pieceCount: number
    /** Whether a live BOM report exists (cutting list has content). */
    hasBom: boolean
    /** Whether a live quote report exists (glass priced). */
    hasQuote: boolean
    /** Outstanding DRC error count (F-030); shown as a warning but never blocks (policy: warn). */
    drcErrorCount: number
    /** Whether DRC has run at least once, so "0 errors" isn't shown before the first check. */
    checksRun: boolean
    /** Fired when the user confirms; the shell dispatches to the right runner for the doc type. */
    onExport: () => void
  }

  let {
    controller,
    print,
    bom,
    quote,
    bounds,
    pieceCount,
    hasBom,
    hasQuote,
    drcErrorCount,
    checksRun,
    onExport,
  }: Props = $props()

  const DOC_TYPE_OPTIONS = [
    { value: 'design-sheet', label: 'Design sheet (PDF)' },
    { value: 'design-files', label: 'Design files (SVG, DXF)' },
    { value: 'tiled', label: 'Cutting template — 1:1 tiled (PDF)' },
    { value: 'bom', label: 'Cutting list & BOM (PDF, CSV)' },
    { value: 'quote', label: 'Client quote (PDF)' },
    { value: 'png', label: 'Image snapshot (PNG)' },
  ]
  const DESIGN_FILE_OPTIONS = [
    { value: 'svg', label: 'SVG (design + cutting machines)' },
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
  const BOM_FORMAT_OPTIONS = [
    { value: 'pdf', label: 'PDF (bench sheet)' },
    { value: 'csv', label: 'CSV (spreadsheet)' },
  ]
  const PAPER_OPTIONS = [
    { value: 'a4', label: 'A4 (210 × 297 mm)' },
    { value: 'a3', label: 'A3 (297 × 420 mm)' },
    { value: 'letter', label: 'Letter (8.5 × 11 in)' },
    { value: 'custom', label: 'Custom…' },
  ]
  const PAGE_OPTIONS = PAPER_OPTIONS.slice(0, 3)
  const ORIENTATION_OPTIONS = [
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
  ]
  const CONTENT_OPTIONS = [
    { value: 'cartoon', label: 'Cartoon (line work + numbers)' },
    { value: 'cut', label: 'Cut contours' },
    { value: 'render', label: 'Coloured render' },
  ]

  // The 1:1 tiled document type reuses the print controller's live tiling for the summary + preview.
  const tiling = $derived(controller.docType === 'tiled' ? print.tilingFor(bounds) : null)
  const pageCount = $derived(tiling ? tiling.tiles.length + (print.includeOverviewMap ? 1 : 0) : 0)

  // Piece numbers apply to the design PDF and to design files except SVG linework (pure geometry).
  const numbersApply = $derived(
    controller.docType === 'design-sheet' ||
      (controller.docType === 'design-files' &&
        !(controller.designFileFormat === 'svg' && controller.svgFlavor === 'linework')),
  )

  const busy = $derived(
    controller.docType === 'tiled'
      ? print.exporting
      : controller.docType === 'bom'
        ? bom.exporting
        : controller.docType === 'quote'
          ? quote.exporting
          : controller.exporting,
  )
  const errorMessage = $derived(
    controller.docType === 'tiled'
      ? print.errorMessage
      : controller.docType === 'bom'
        ? bom.errorMessage
        : controller.docType === 'quote'
          ? quote.errorMessage
          : controller.errorMessage,
  )

  const canExport = $derived(
    pieceCount > 0 &&
      !busy &&
      (controller.docType === 'tiled'
        ? tiling !== null
        : controller.docType === 'bom'
          ? hasBom
          : controller.docType === 'quote'
            ? hasQuote
            : true),
  )

  function num(value: string, fallback: number): number {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : fallback
  }
</script>

<Dialog open={controller.open} title="Export" width={560} onClose={() => (controller.open = false)}>
  <div class="export">
    <Select
      size="sm"
      label="What to export"
      options={DOC_TYPE_OPTIONS}
      value={controller.docType}
      onchange={(v) => (controller.docType = v as OutputDocType)}
    />

    {#if controller.docType === 'design-sheet'}
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
            options={PAGE_OPTIONS}
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
        scale factor for reference — for a taped 1:1 cartoon use the cutting template below.
      </p>
    {:else if controller.docType === 'design-files'}
      <div class="grid">
        <Select
          size="sm"
          label="Format"
          options={DESIGN_FILE_OPTIONS}
          value={controller.designFileFormat}
          onchange={(v) => (controller.designFileFormat = v as DesignFileFormat)}
        />
        {#if controller.designFileFormat === 'svg'}
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
        {/if}
      </div>
      <p class="note">
        {#if controller.designFileFormat === 'svg'}
          SVG carries physical millimetre dimensions, so 1 mm in the file is 1 mm on the ruler in
          Inkscape or Illustrator.
          {#if controller.svgFlavor === 'cut'}
            Cut templates are one closed path per piece, numbered for Cricut and Silhouette.
          {/if}
        {:else}
          DXF exports the lead-line network and cut contours on separate layers (LEAD, BORDER, CUT,
          REBAR) in millimetres — arcs stay arcs, curves become fine polylines.
        {/if}
      </p>
    {:else if controller.docType === 'tiled'}
      <div class="grid">
        <Select
          size="sm"
          label="Paper size"
          options={PAPER_OPTIONS}
          value={print.paperId}
          onchange={(v) => (print.paperId = v)}
        />
        <Select
          size="sm"
          label="Orientation"
          options={ORIENTATION_OPTIONS}
          value={print.orientation}
          onchange={(v) => (print.orientation = v as Orientation)}
        />
        {#if print.paperId === 'custom'}
          <Input
            size="sm"
            label="Sheet width (mm)"
            value={String(print.customWidthMm)}
            onchange={(v) => (print.customWidthMm = num(v, print.customWidthMm))}
          />
          <Input
            size="sm"
            label="Sheet height (mm)"
            value={String(print.customHeightMm)}
            onchange={(v) => (print.customHeightMm = num(v, print.customHeightMm))}
          />
        {/if}
        <Input
          size="sm"
          label="Margin (mm)"
          value={String(print.marginMm)}
          onchange={(v) => (print.marginMm = num(v, print.marginMm))}
        />
        <Input
          size="sm"
          label="Overlap (mm)"
          value={String(print.overlapMm)}
          onchange={(v) => (print.overlapMm = num(v, print.overlapMm))}
        />
        <Select
          size="sm"
          label="Content"
          options={CONTENT_OPTIONS}
          value={print.content}
          onchange={(v) => (print.content = v as PrintContent)}
        />
      </div>

      <fieldset class="includes">
        <legend>Include</legend>
        <Checkbox
          label="Piece numbers"
          checked={print.includeNumbers}
          onchange={(c) => (print.includeNumbers = c)}
        />
        <Checkbox
          label="Glass legend"
          checked={print.includeGlassCodes}
          onchange={(c) => (print.includeGlassCodes = c)}
        />
        <Checkbox
          label="Alignment marks"
          checked={print.includeAlignmentMarks}
          onchange={(c) => (print.includeAlignmentMarks = c)}
        />
        <Checkbox
          label="Page labels"
          checked={print.includePageLabels}
          onchange={(c) => (print.includePageLabels = c)}
        />
        <Checkbox
          label="Calibration ruler"
          checked={print.includeCalibrationRuler}
          onchange={(c) => (print.includeCalibrationRuler = c)}
        />
        <Checkbox
          label="Overview map page"
          checked={print.includeOverviewMap}
          onchange={(c) => (print.includeOverviewMap = c)}
        />
      </fieldset>

      <div class="summary" aria-live="polite">
        {#if tiling}
          <span class="tiles"
            >{tiling.cols} × {tiling.rows} tiles · <span class="mono">{pageCount}</span> pages</span
          >
          <span class="detail">{print.paper.label} {print.orientation}</span>
        {:else}
          <span class="warn">Margins leave no printable area — reduce the margin.</span>
        {/if}
      </div>

      <p class="note">
        Every sheet carries a 100 mm calibration ruler. Set your printer to
        <strong>100% (actual size)</strong> — the tile grid is previewed on the canvas.
      </p>
    {:else if controller.docType === 'bom'}
      <Select
        size="sm"
        label="Format"
        options={BOM_FORMAT_OPTIONS}
        value={controller.bomFormat}
        onchange={(v) => (controller.bomFormat = v as BomFileFormat)}
      />
      <p class="note">
        The cutting list and bill of materials, always in sync with the design. The list itself is
        in the Manufacturing panel; here it exports as a bench PDF or a spreadsheet CSV.
        {#if !hasBom}
          <span class="warn">Assign glass to pieces to build the list.</span>
        {/if}
      </p>
    {:else if controller.docType === 'quote'}
      <fieldset class="includes">
        <legend>Include</legend>
        <Checkbox
          label="Rendered panel image"
          checked={quote.includePanelImage}
          onchange={(c) => (quote.includePanelImage = c)}
        />
        <Checkbox
          label="Internal cost breakdown"
          checked={quote.includeBreakdown}
          onchange={(c) => (quote.includeBreakdown = c)}
        />
      </fieldset>
      <p class="note">
        A client-ready quote from the current design and prices. The full cost builder (labor model,
        price book, margins) is in the Cost panel. By default the internal cost breakdown is hidden
        — the client sees the panel work, any line items and the total.
        {#if !hasQuote}
          <span class="warn">Assign glass to pieces to build the quote.</span>
        {/if}
      </p>
    {:else}
      <p class="note">
        A PNG raster snapshot of the design as drawn on the canvas — quick to share, not to physical
        scale.
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

    {#if errorMessage}
      <p class="error" role="alert">Export failed: {errorMessage}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="secondary" size="sm" onclick={() => (controller.open = false)}>Cancel</Button>
    <Button variant="primary" size="sm" disabled={!canExport} onclick={onExport}>
      {busy ? 'Exporting…' : 'Export'}
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

  .note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .warn {
    color: var(--warning-600);
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
