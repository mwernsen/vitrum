<script lang="ts">
  import {
    formatArea,
    formatAreaLarge,
    formatLength,
    type BomReport,
    type LengthUnit,
  } from '@vitrum/core'

  import type { CutSort } from '../bom/controller.svelte'

  /** A per-piece note surfaced beside its row — today, the DRC issue that blocks cutting it. */
  export interface PieceNote {
    text: string
    /** True for an error-severity note, which reads in ruby rather than muted ink. */
    blocking: boolean
  }

  interface Props {
    /** The live cutting list / BOM (derived upstream via `computeBom`, so it stays in sync). */
    report: BomReport
    unit: LengthUnit
    sort: CutSort
    /** Per-piece notes, keyed by piece display id. */
    notes?: Readonly<Record<string, PieceNote>>
    /** Highlight a row's piece on the canvas (traceability). */
    onHighlight?: (pieceIds: readonly string[]) => void
    onClearHighlight?: () => void
  }

  let { report, unit, sort, notes = {}, onHighlight, onClearHighlight }: Props = $props()

  /**
   * One flat table rather than a section per glass: at drawer width the glass column carries the
   * grouping, and a cutter working down a bench list wants one continuous sequence.
   */
  const rows = $derived.by(() => {
    const flat = report.cutting.flatMap((group) =>
      group.rows.map((row) => ({
        key: row.contentId,
        pieceId: row.pieceId,
        label: row.label || '—',
        code: group.code,
        color: group.color,
        material: group.manufacturer ? `${group.name} · ${group.manufacturer}` : group.name,
        widthMm: row.widthMm,
        heightMm: row.heightMm,
        areaMm2: row.areaMm2,
        degenerate: row.degenerate,
      })),
    )
    if (sort === 'size') return flat.slice().sort((a, b) => b.areaMm2 - a.areaMm2)
    return flat
  })

  const totalNet = $derived(report.cutting.reduce((sum, g) => sum + g.netAreaMm2, 0))
  const totalBuy = $derived(report.cutting.reduce((sum, g) => sum + g.buyAreaMm2, 0))
  const cameLength = $derived(report.came.reduce((sum, c) => sum + c.netLengthMm, 0))
  const seamLength = $derived(report.foil?.netSeamLengthMm ?? 0)

  const wastePct = $derived(Math.round(report.factors.glassWaste * 100))

  function weight(grams: number): string {
    return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`
  }

  const totals = $derived([
    { label: 'Net glass', value: formatAreaLarge(totalNet, unit) },
    { label: `Buy (+${wastePct}%)`, value: formatAreaLarge(totalBuy, unit) },
    report.technique === 'lead'
      ? { label: 'Lead came', value: formatLength(cameLength, unit) }
      : { label: 'Foil seam', value: formatLength(seamLength, unit) },
    { label: 'Weight', value: weight(report.weight.grams) },
  ])
</script>

{#if rows.length === 0}
  <p class="empty">Draw a design and assign glass to build the cutting list.</p>
{:else}
  <div class="table" role="table" aria-label="Cutting list">
    <div class="head" role="row">
      <span role="columnheader">No.</span>
      <span role="columnheader">Glass</span>
      <span role="columnheader">Material</span>
      <span role="columnheader">W × H</span>
      <span role="columnheader">Area</span>
      <span role="columnheader">Notes</span>
    </div>
    {#each rows as row (row.key)}
      {@const note = notes[row.pieceId]}
      <!-- Focusable so the canvas highlight is reachable by keyboard, not hover only. -->
      <div
        class="row"
        role="row"
        tabindex="0"
        onmouseenter={() => onHighlight?.([row.pieceId])}
        onmouseleave={() => onClearHighlight?.()}
        onfocus={() => onHighlight?.([row.pieceId])}
        onblur={() => onClearHighlight?.()}
      >
        <span class="no" role="cell">{row.label}</span>
        <span class="glass" role="cell">
          <span class="swatch" style={`background:${row.color ?? 'var(--paper-200)'}`}></span>
          <span class="code">{row.code}</span>
        </span>
        <span role="cell">{row.material}</span>
        <span class="num" role="cell">
          {formatLength(row.widthMm, unit)} × {formatLength(row.heightMm, unit)}
        </span>
        <span class="num" role="cell">{formatArea(row.areaMm2, unit)}</span>
        <span class="note" class:blocking={note?.blocking} role="cell">
          {#if note}{note.text}{:else if row.degenerate}Too small to inset — check the shape{/if}
        </span>
      </div>
    {/each}
  </div>

  <div class="totals">
    {#each totals as total (total.label)}
      <span class="total">
        <span class="eyebrow">{total.label}</span>
        <span class="total-value">{total.value}</span>
      </span>
    {/each}
  </div>
{/if}

<style>
  .empty {
    margin: 0;
    padding: 14px;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .table {
    display: flex;
    flex-direction: column;
  }

  .head,
  .row {
    display: grid;
    grid-template-columns: 76px 74px minmax(160px, 1fr) 150px 110px minmax(140px, 1fr);
    align-items: center;
    gap: 0;
  }

  .head {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 8px 14px;
    background: var(--paper-50);
    border-bottom: 1px solid var(--border-subtle);
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .row {
    padding: 9px 14px;
    border-bottom: 1px solid var(--paper-100);
    font: var(--text-small);
    color: var(--ink-800);
  }

  .row:hover {
    background: var(--paper-50);
  }

  .no {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--ink-950);
  }

  .glass {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    width: 15px;
    height: 15px;
    flex: none;
    border-radius: 3px;
    border: 1px solid var(--border-subtle);
  }

  .code,
  .num {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .note {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .note.blocking {
    color: var(--ruby-600);
  }

  .totals {
    display: flex;
    gap: 26px;
    padding: 11px 14px;
    background: var(--paper-50);
    border-top: 1px solid var(--border-subtle);
  }

  .total {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .total-value {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink-950);
  }
</style>
