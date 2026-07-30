<script lang="ts">
  import { formatAreaLarge, type BomReport, type LengthUnit, type QuoteReport } from '@vitrum/core'
  import type { BomSettings } from '@vitrum/model'
  import ChevronDown from 'lucide-svelte/icons/chevron-down'

  import type { BomController, CutSort } from '../bom/controller.svelte'

  import BomPanel from './BomPanel.svelte'
  import CutListTable, { type PieceNote } from './CutListTable.svelte'
  import QuoteTable from './QuoteTable.svelte'

  /** Which bench output the drawer is showing. */
  export type DrawerTab = 'cut' | 'bom' | 'quote'

  interface Props {
    tab: DrawerTab
    onTab: (tab: DrawerTab) => void
    onClose: () => void
    /** The live cutting list / BOM (F-042). Null before any piece exists. */
    report: BomReport | null
    /** The live quote (F-056). Null before any piece exists. */
    quote: QuoteReport | null
    unit: LengthUnit
    /** Cutting-list sort order, shared with the BOM controller. */
    sort: CutSort
    onSort: (sort: CutSort) => void
    /** Persisted estimation factors (F-042 FR-5). */
    factors: BomSettings
    onSetFactor: (patch: Partial<BomSettings>) => void
    /** Canvas highlight, for row traceability. */
    bom: BomController
    /** Per-piece notes (today: the DRC issue blocking that piece), keyed by piece display id. */
    notes?: Readonly<Record<string, PieceNote>>
    /** Export the visible table as CSV (F-042). Absent ⇒ the button hides. */
    onExportCsv?: () => void
  }

  let {
    tab,
    onTab,
    onClose,
    report,
    quote,
    unit,
    sort,
    onSort,
    factors,
    onSetFactor,
    bom,
    notes = {},
    onExportCsv,
  }: Props = $props()

  const TABS: { id: DrawerTab; label: string }[] = [
    { id: 'cut', label: 'Cutting list' },
    { id: 'bom', label: 'Bill of materials' },
    { id: 'quote', label: 'Quote' },
  ]

  // One line saying what the open table sums to, so the header is worth reading before the rows.
  const meta = $derived.by(() => {
    if (tab === 'quote') {
      if (!quote) return ''
      return `${quote.currency.symbol}${quote.total.toFixed(2)} total · ${Math.round(quote.labor.hours * 10) / 10} h labour`
    }
    if (!report) return ''
    const net = report.cutting.reduce((sum, g) => sum + g.netAreaMm2, 0)
    const buy = report.cutting.reduce((sum, g) => sum + g.buyAreaMm2, 0)
    const pieces = `${report.pieceCount} piece${report.pieceCount === 1 ? '' : 's'}`
    return `${pieces} · ${formatAreaLarge(net, unit)} net · ${formatAreaLarge(buy, unit)} to buy`
  })
</script>

<!--
  The bench outputs get real width (Cockpit v2). A cutting list is a wide table; squeezing it into a
  296px dock meant three visible columns and a lot of scrolling, so it now opens as a drawer under
  the stage where the columns fit.
-->
<section class="drawer" aria-label="Bench outputs">
  <div class="head">
    <div class="tabs" role="tablist" aria-label="Bench outputs">
      {#each TABS as t (t.id)}
        <button
          class="tab"
          class:active={t.id === tab}
          role="tab"
          aria-selected={t.id === tab}
          onclick={() => onTab(t.id)}
        >
          {t.label}
        </button>
      {/each}
    </div>
    <span class="spacer"></span>
    <span class="meta">{meta}</span>
    {#if onExportCsv && tab !== 'quote'}
      <button class="ghost" onclick={() => onExportCsv?.()}>Export CSV</button>
    {/if}
    <button class="close" aria-label="Close bench outputs" onclick={onClose}>
      <ChevronDown size={16} />
    </button>
  </div>

  <div class="body" class:pad={tab === 'bom'}>
    {#if tab === 'quote'}
      <QuoteTable
        report={quote}
        onHighlight={(pieceIds, segmentIds) => bom.highlight(pieceIds, segmentIds)}
        onClearHighlight={() => bom.clearHighlight()}
      />
    {:else if !report}
      <p class="empty">Draw a design and assign glass to build the bench outputs.</p>
    {:else if tab === 'cut'}
      <CutListTable
        {report}
        {unit}
        {sort}
        {notes}
        onHighlight={(pieceIds) => bom.highlight(pieceIds)}
        onClearHighlight={() => bom.clearHighlight()}
      />
    {:else}
      <BomPanel
        sections="materials"
        {report}
        {unit}
        {sort}
        {onSort}
        {factors}
        {onSetFactor}
        onHighlight={(pieceIds, segmentIds) => bom.highlight(pieceIds, segmentIds)}
        onClearHighlight={() => bom.clearHighlight()}
      />
    {/if}
  </div>
</section>

<style>
  .drawer {
    flex: none;
    height: 266px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--paper-0);
    border-top: 1px solid var(--border-strong);
    box-shadow: var(--shadow-pop);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tabs {
    display: inline-flex;
    gap: 4px;
  }

  .tab {
    padding: 5px 12px;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-600);
    font: 600 12px/1 var(--font-sans);
    cursor: pointer;
  }

  .tab:hover:not(.active) {
    background: var(--paper-100);
    color: var(--ink-900);
  }

  .tab.active {
    border-color: var(--ink-950);
    background: var(--ink-950);
    color: var(--paper-0);
  }

  .spacer {
    flex: 1;
  }

  .meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
  }

  .ghost {
    padding: 5px 11px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-800);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .ghost:hover {
    background: var(--paper-100);
  }

  .close {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--ink-600);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .close:hover {
    background: var(--paper-100);
    color: var(--ink-950);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  /* The materials view is a stack of prose-width blocks, so it needs the gutter the tables set. */
  .body.pad {
    padding: 0 14px 14px;
  }

  .empty {
    margin: 0;
    padding: 14px;
    font: var(--text-small);
    color: var(--text-muted);
  }
</style>
