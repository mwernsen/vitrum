<script lang="ts">
  import type { QuoteLine, QuoteReport } from '@vitrum/core'

  interface Props {
    /** The live quote (derived upstream via `computeQuote`). Null until pieces exist. */
    report: QuoteReport | null
    /** Highlight a line's contributing pieces/segments on the canvas (traceability, FR-6). */
    onHighlight?: (pieceIds: readonly string[], segmentIds?: readonly string[]) => void
    onClearHighlight?: () => void
  }

  let { report, onHighlight, onClearHighlight }: Props = $props()

  interface Row {
    key: string
    group: string
    label: string
    detail: string
    amount: number
    unpriced: boolean
    pieceIds: readonly string[]
    segmentIds: readonly string[]
  }

  function toRows(group: string, lines: readonly QuoteLine[]): Row[] {
    return lines.map((line) => ({
      key: `${group}:${line.key}`,
      group,
      label: line.label,
      detail: line.detail,
      amount: line.amount,
      unpriced: line.unpriced === true,
      pieceIds: line.pieceIds ?? [],
      segmentIds: line.segmentIds ?? [],
    }))
  }

  // Every cost line the quote is built from, in the order the total adds them up, so the drawer
  // answers "where does €486.20 come from?" without the reader doing arithmetic.
  const rows = $derived.by<Row[]>(() => {
    if (!report) return []
    const m = report.materials
    return [
      ...toRows('Glass', m.glass),
      ...toRows(report.technique === 'lead' ? 'Lead came' : 'Copper foil', [...m.lead, ...m.foil]),
      ...toRows('Reinforcement', m.reinforcement),
      ...toRows('Consumables', m.consumables),
      ...toRows('Manual', report.manualLines),
    ]
  })

  const sym = $derived(report?.currency.symbol ?? '')

  function money(n: number): string {
    const body = `${sym}${Math.abs(n).toFixed(2)}`
    return n < 0 ? `-${body}` : body
  }

  const summary = $derived.by(() => {
    if (!report) return []
    return [
      { label: 'Materials', value: money(report.materials.subtotal), strong: false },
      {
        label: `Labour · ${Math.round(report.labor.hours * 100) / 100} h`,
        value: money(report.labor.cost),
        strong: false,
      },
      { label: 'Subtotal', value: money(report.subtotal), strong: true },
      { label: `Overhead ${report.overheadPct}%`, value: money(report.overhead), strong: false },
      { label: `Margin ${report.marginPct}%`, value: money(report.margin), strong: false },
      { label: 'Total', value: money(report.total), strong: true },
    ]
  })
</script>

{#if !report}
  <p class="empty">Draw a design and assign glass to build the quote.</p>
{:else}
  <div class="split">
    <div class="table" role="table" aria-label="Quote line items">
      <div class="head" role="row">
        <span role="columnheader">Group</span>
        <span role="columnheader">Line</span>
        <span role="columnheader">Detail</span>
        <span role="columnheader">Amount</span>
      </div>
      {#if rows.length === 0}
        <p class="empty">No priced lines yet.</p>
      {:else}
        {#each rows as row (row.key)}
          <!-- Focusable so the canvas highlight is reachable by keyboard, not hover only. -->
          <div
            class="row"
            role="row"
            tabindex="0"
            onmouseenter={() => onHighlight?.(row.pieceIds, row.segmentIds)}
            onmouseleave={() => onClearHighlight?.()}
            onfocus={() => onHighlight?.(row.pieceIds, row.segmentIds)}
            onblur={() => onClearHighlight?.()}
          >
            <span class="group" role="cell">{row.group}</span>
            <span role="cell">{row.label}</span>
            <span class="detail" role="cell">{row.detail}</span>
            <span class="amount" class:unpriced={row.unpriced} role="cell">
              {row.unpriced ? 'not priced' : money(row.amount)}
            </span>
          </div>
        {/each}
      {/if}
    </div>

    <div class="summary">
      {#each summary as line (line.label)}
        <div class="sum-row" class:strong={line.strong}>
          <span>{line.label}</span>
          <span class="sum-value">{line.value}</span>
        </div>
      {/each}
      {#if report.hasUnpricedGlass}
        <p class="warn">
          A glass in use has no price, so the total understates the real material cost.
        </p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .empty {
    margin: 0;
    padding: 14px;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 268px;
    align-items: start;
    min-height: 100%;
  }

  .table {
    display: flex;
    flex-direction: column;
  }

  .head,
  .row {
    display: grid;
    grid-template-columns: 130px minmax(140px, 1fr) minmax(140px, 1fr) 120px;
    align-items: center;
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

  .group {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .detail {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--ink-500);
  }

  .amount {
    font-family: var(--font-mono);
    font-size: 12.5px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .amount.unpriced {
    color: var(--amber-600);
  }

  .summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
    border-left: 1px solid var(--border-subtle);
  }

  .sum-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--paper-100);
    font: 500 12.5px/1.3 var(--font-sans);
    color: var(--ink-800);
  }

  .sum-row.strong {
    font-weight: 700;
    color: var(--ink-950);
  }

  .sum-value {
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  .warn {
    margin: 0;
    font: var(--text-caption);
    color: var(--amber-600);
  }
</style>
