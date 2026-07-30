<script lang="ts">
  import {
    formatArea,
    formatAreaLarge,
    formatLength,
    type BomReport,
    type CutListGroup,
    type LengthUnit,
  } from '@vitrum/core'
  import type { BomSettings } from '@vitrum/model'

  import Input from '../components/Input.svelte'

  import type { CutSort } from '../bom/controller.svelte'

  interface Props {
    /** The live cutting list / BOM (derived upstream via `computeBom`, so it stays in sync — FR-2). */
    report: BomReport
    /** Display unit for lengths/areas. */
    unit: LengthUnit
    /** Cutting-list sort order. */
    sort: CutSort
    onSort: (sort: CutSort) => void
    /** Persisted estimation factors (FR-5). */
    factors: BomSettings
    /** Patch a factor (waste fractions, solder g/m, foil roll length mm). */
    onSetFactor: (patch: Partial<BomSettings>) => void
    /** Highlight the contributing pieces (+ optional segments) of a line item on the canvas. */
    onHighlight: (pieceIds: readonly string[], segmentIds?: readonly string[]) => void
    onClearHighlight: () => void
    /**
     * Which parts to render. Cockpit v2 gives the per-piece cutting list its own wide table in the
     * bottom drawer, so the drawer's materials tab asks for `'materials'` and drops the narrow
     * duplicate. `'all'` keeps the original full panel.
     */
    sections?: 'all' | 'cutting' | 'materials'
  }

  let {
    report,
    unit,
    sort,
    onSort,
    factors,
    onSetFactor,
    onHighlight,
    onClearHighlight,
    sections = 'all',
  }: Props = $props()

  let settingsOpen = $state(false)

  const showCutting = $derived(sections === 'all' || sections === 'cutting')
  const showMaterials = $derived(sections === 'all' || sections === 'materials')

  const hasPieces = $derived(report.pieceCount > 0)

  /** Rows re-sorted for display: by number (core default) or by area, largest first. */
  function sortedRows(group: CutListGroup) {
    if (sort === 'number') return group.rows
    return group.rows.slice().sort((a, b) => b.areaMm2 - a.areaMm2)
  }

  function pct(fraction: number): string {
    return (Math.round(fraction * 1000) / 10).toString()
  }

  function weight(grams: number): string {
    return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`
  }

  function money(n: number): string {
    return (Math.round(n * 100) / 100).toFixed(2)
  }

  function parseNumber(text: string, fallback: number): number {
    const value = Number(text)
    return Number.isFinite(value) ? value : fallback
  }
</script>

<div class="bom">
  <!-- Cutting list -->
  {#if showCutting}
    <section>
      <div class="section-head">
        <span class="eyebrow">Cutting list</span>
        {#if hasPieces}
          <div class="sort" role="group" aria-label="Sort cutting list">
            <button class:active={sort === 'number'} onclick={() => onSort('number')}>No.</button>
            <button class:active={sort === 'size'} onclick={() => onSort('size')}>Size</button>
          </div>
        {/if}
      </div>

      {#if !hasPieces}
        <p class="note">Draw a design and assign glass to build the cutting list.</p>
      {:else}
        {#each report.cutting as group (group.glassId ?? '?')}
          <div
            class="glass-group"
            role="group"
            onmouseenter={() => onHighlight(group.pieceIds)}
            onmouseleave={onClearHighlight}
          >
            <div class="glass-head">
              <span
                class="swatch"
                style:background={group.color ?? 'transparent'}
                class:empty={!group.color}
              ></span>
              <span class="code">{group.code}</span>
              <span class="gname" title={group.name}>{group.name}</span>
              <span class="gcount">{group.count}</span>
            </div>
            <div class="rows" role="table">
              <div class="row head" role="row">
                <span role="columnheader">No.</span>
                <span class="num" role="columnheader">W × H</span>
                <span class="num" role="columnheader">Area</span>
              </div>
              {#each sortedRows(group) as row (row.contentId)}
                <div
                  class="row"
                  role="row"
                  tabindex="0"
                  onmouseenter={() => onHighlight([row.pieceId])}
                  onfocus={() => onHighlight([row.pieceId])}
                >
                  <span class="label" role="cell">{row.label || '—'}</span>
                  <span class="num" role="cell">
                    {formatLength(row.widthMm, unit)} × {formatLength(row.heightMm, unit)}
                  </span>
                  <span class="num" role="cell" class:degenerate={row.degenerate}>
                    {formatArea(row.areaMm2, unit)}
                  </span>
                </div>
              {/each}
            </div>
            <dl class="subtotal">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatArea(group.netAreaMm2, unit)}</dd>
              </div>
              <div>
                <dt>Buy (+{pct(factors.glassWaste)}%)</dt>
                <dd>{formatAreaLarge(group.buyAreaMm2, unit)}</dd>
              </div>
            </dl>
          </div>
        {/each}
      {/if}
    </section>
  {/if}

  <!-- Bill of materials -->
  {#if showMaterials && hasPieces}
    <section>
      <span class="eyebrow">Bill of materials</span>

      <div class="bom-block">
        <span class="sub">Glass</span>
        {#each report.glass as item (item.glassId ?? '?')}
          <button
            class="line"
            onmouseenter={() => onHighlight(item.pieceIds)}
            onmouseleave={onClearHighlight}
          >
            <span class="lname"><span class="code">{item.code}</span> {item.name}</span>
            <span class="lvalue">
              {formatAreaLarge(item.buyAreaMm2, unit)}{#if item.sheet}
                · {item.sheet.sheetsNeeded} sheet{item.sheet.sheetsNeeded === 1
                  ? ''
                  : 's'}{/if}{#if item.cost !== undefined}
                · {money(item.cost)}{/if}
            </span>
          </button>
        {/each}
      </div>

      {#if report.technique === 'lead' && report.came.length > 0}
        <div class="bom-block">
          <span class="sub">Lead came</span>
          {#each report.came as came (came.profileId)}
            <button
              class="line"
              onmouseenter={() => onHighlight([], came.segmentIds)}
              onmouseleave={onClearHighlight}
            >
              <span class="lname">{came.name}</span>
              <span class="lvalue">
                {formatLength(came.buyLengthMm, unit)}
                <span class="net">net {formatLength(came.netLengthMm, unit)}</span>
              </span>
            </button>
          {/each}
        </div>
      {:else if report.technique === 'foil' && report.foil}
        <div class="bom-block">
          <span class="sub">Copper foil</span>
          <button
            class="line"
            onmouseenter={() => onHighlight([], report.foil?.segmentIds ?? [])}
            onmouseleave={onClearHighlight}
          >
            <span class="lname">Seam</span>
            <span class="lvalue">
              {formatLength(report.foil.buySeamLengthMm, unit)} · {report.foil.rollsNeeded} roll{report
                .foil.rollsNeeded === 1
                ? ''
                : 's'}
            </span>
          </button>
          <div class="line static">
            <span class="lname">Solder</span>
            <span class="lvalue"
              >{weight(report.foil.solderGrams)}
              <span class="net">{report.foil.solderGramsPerMetre} g/m</span></span
            >
          </div>
        </div>
      {/if}

      {#if report.reinforcement.length > 0}
        <div class="bom-block">
          <span class="sub">Reinforcement</span>
          {#each report.reinforcement as bar (bar.material)}
            <div class="line static">
              <span class="lname">{bar.material} ({bar.count})</span>
              <span class="lvalue">{formatLength(bar.totalLengthMm, unit)}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="bom-block">
        <span class="sub">Panel weight</span>
        <div class="line static">
          <span class="lname">Total (estimated)</span>
          <span class="lvalue">{weight(report.weight.grams)}</span>
        </div>
      </div>
    </section>
  {/if}

  <!-- Estimation settings (FR-5) -->
  <section>
    <button
      class="disclosure"
      onclick={() => (settingsOpen = !settingsOpen)}
      aria-expanded={settingsOpen}
    >
      <span class="eyebrow">Estimation settings</span>
      <span class="chevron">{settingsOpen ? '−' : '+'}</span>
    </button>
    {#if settingsOpen}
      <div class="settings">
        <Input
          size="sm"
          label="Glass waste (%)"
          value={pct(factors.glassWaste)}
          onchange={(v) =>
            onSetFactor({ glassWaste: parseNumber(v, factors.glassWaste * 100) / 100 })}
        />
        <Input
          size="sm"
          label="Came / foil waste (%)"
          value={pct(factors.leadWaste)}
          onchange={(v) =>
            onSetFactor({ leadWaste: parseNumber(v, factors.leadWaste * 100) / 100 })}
        />
        <Input
          size="sm"
          label="Solder (g per metre of seam)"
          value={factors.solderGramsPerMetre.toString()}
          onchange={(v) =>
            onSetFactor({ solderGramsPerMetre: parseNumber(v, factors.solderGramsPerMetre) })}
        />
        <Input
          size="sm"
          label="Foil roll length (m)"
          value={(factors.foilRollLengthMm / 1000).toString()}
          onchange={(v) =>
            onSetFactor({
              foilRollLengthMm: parseNumber(v, factors.foilRollLengthMm / 1000) * 1000,
            })}
        />
      </div>
    {/if}
  </section>
</div>

<style>
  .bom {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sort {
    display: inline-flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .sort button {
    padding: 2px 10px;
    border: none;
    background: var(--paper-0);
    color: var(--ink-600);
    font: 600 11px/1 var(--font-sans);
    cursor: pointer;
  }

  .sort button.active {
    background: var(--cobalt-500);
    color: var(--paper-0);
  }

  .note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .glass-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }

  .glass-group:hover {
    background: var(--paper-50);
  }

  .glass-head {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: center;
    gap: var(--space-2);
  }

  .swatch {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
  }

  .swatch.empty {
    background: repeating-linear-gradient(
      45deg,
      var(--paper-200),
      var(--paper-200) 3px,
      var(--paper-0) 3px,
      var(--paper-0) 6px
    );
  }

  .code {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--ink-900);
  }

  .gname {
    font: 600 12.5px/1.2 var(--font-sans);
    color: var(--ink-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gcount {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-500);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    align-items: center;
    gap: var(--space-2);
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    font: var(--text-caption);
  }

  .row:not(.head) {
    cursor: default;
  }

  .row:not(.head):hover,
  .row:not(.head):focus-visible {
    background: var(--cobalt-50);
    outline: none;
  }

  .row.head span {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .row .label {
    font-family: var(--font-mono);
    color: var(--ink-800);
  }

  .num {
    text-align: right;
    font-family: var(--font-mono);
    color: var(--ink-700);
  }

  .num.degenerate {
    color: var(--warning-600);
  }

  .subtotal {
    margin: 0;
    display: grid;
    gap: 1px;
  }

  .subtotal div {
    display: flex;
    justify-content: space-between;
    font: var(--text-small);
  }

  .subtotal dt {
    color: var(--text-muted);
  }

  .subtotal dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--ink-800);
    font-weight: 600;
  }

  .bom-block {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-top: var(--space-2);
  }

  .sub {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--ink-500);
    margin-bottom: 2px;
  }

  .line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 3px 4px;
    border: none;
    background: none;
    text-align: left;
    width: 100%;
    border-radius: var(--radius-sm);
    font: var(--text-small);
    color: var(--ink-800);
  }

  button.line {
    cursor: pointer;
  }

  button.line:hover {
    background: var(--cobalt-50);
  }

  .lname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lname .code {
    font-size: 12px;
  }

  .lvalue {
    font-family: var(--font-mono);
    color: var(--ink-900);
    text-align: right;
    white-space: nowrap;
  }

  .net {
    color: var(--ink-500);
    font-size: 11px;
    margin-left: var(--space-2);
  }

  .disclosure {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
  }

  .chevron {
    font-family: var(--font-mono);
    color: var(--ink-500);
  }

  .settings {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }
</style>
