<script lang="ts">
  import type { QuoteReport } from '@vitrum/core'
  import {
    defaultCurrency,
    newConsumableId,
    newQuoteLineId,
    type LaborModel,
    type PriceBook,
    type QuoteClient,
    type QuoteLineItem,
    type QuoteSettings,
  } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'

  interface Props {
    /** The live quote (derived upstream via `computeQuote`, so it stays in sync — FR-2). Null until pieces exist. */
    report: QuoteReport | null
    /** Persisted quote intent (FR-2). */
    settings: QuoteSettings
    /** Patch the persisted quote settings (one undo entry per edit). */
    onPatch: (patch: Partial<QuoteSettings>) => void
    /** Sensitivity view: how many smallest pieces to sum/highlight. */
    smallestN: number
    onSmallestN: (n: number) => void
    /** Highlight contributing pieces (+ optional segments) on the canvas (traceability, FR-6). */
    onHighlight: (pieceIds: readonly string[], segmentIds?: readonly string[]) => void
    onClearHighlight: () => void
    /** Save the current price book as the workshop default / load the workshop default (FR-5). */
    onSaveWorkshopDefault?: () => void
    onLoadWorkshopDefault?: () => void
  }

  let {
    report,
    settings,
    onPatch,
    smallestN,
    onSmallestN,
    onHighlight,
    onClearHighlight,
    onSaveWorkshopDefault,
    onLoadWorkshopDefault,
  }: Props = $props()

  const CURRENCIES = [
    { value: 'EUR', label: 'Euro (€)' },
    { value: 'USD', label: 'US dollar ($)' },
    { value: 'GBP', label: 'Pound (£)' },
  ]
  const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' }

  let laborOpen = $state(false)
  let pricesOpen = $state(false)
  let clientOpen = $state(false)

  const sym = $derived(settings.currency.symbol)

  function money(n: number): string {
    const abs = Math.abs(n)
    const body = `${sym}${abs.toFixed(2)}`
    return n < 0 ? `-${body}` : body
  }

  function num(text: string, fallback: number): number {
    const value = Number(text)
    return Number.isFinite(value) ? value : fallback
  }

  function hours(n: number): string {
    return `${Math.round(n * 100) / 100} h`
  }

  // --- Sensitivity (FR-6) ----------------------------------------------------
  const smallest = $derived(report ? report.labor.perPiece.slice(0, Math.max(0, smallestN)) : [])
  const smallestCost = $derived(smallest.reduce((sum, p) => sum + p.cost, 0))
  const smallestIds = $derived(smallest.map((p) => p.pieceId))

  // --- Nested patch helpers (each edit is one undo entry) --------------------
  function patchLabor(patch: Partial<LaborModel>): void {
    onPatch({ labor: { ...settings.labor, ...patch } })
  }
  function patchPriceBook(patch: Partial<PriceBook>): void {
    onPatch({ priceBook: { ...settings.priceBook, ...patch } })
  }
  function patchClient(patch: Partial<QuoteClient>): void {
    onPatch({ client: { ...settings.client, ...patch } })
  }
  function setCurrency(code: string): void {
    onPatch({ currency: { code, symbol: SYMBOLS[code] ?? defaultCurrency().symbol } })
  }

  // --- Consumables -----------------------------------------------------------
  function addConsumable(): void {
    patchPriceBook({
      consumables: [
        ...settings.priceBook.consumables,
        { id: newConsumableId(), name: 'Consumable', cost: 0 },
      ],
    })
  }
  function updateConsumable(id: string, patch: { name?: string; cost?: number }): void {
    patchPriceBook({
      consumables: settings.priceBook.consumables.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    })
  }
  function removeConsumable(id: string): void {
    patchPriceBook({ consumables: settings.priceBook.consumables.filter((c) => c.id !== id) })
  }

  // --- Manual line items -----------------------------------------------------
  function addManualLine(): void {
    onPatch({
      manualLines: [
        ...settings.manualLines,
        { id: newQuoteLineId(), description: 'Line item', amount: 0 },
      ],
    })
  }
  function updateManualLine(id: string, patch: Partial<QuoteLineItem>): void {
    onPatch({
      manualLines: settings.manualLines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })
  }
  function removeManualLine(id: string): void {
    onPatch({ manualLines: settings.manualLines.filter((l) => l.id !== id) })
  }
</script>

<div class="quote">
  {#if !report}
    <p class="note">Draw a design and assign glass to build a cost estimate.</p>
  {:else}
    <!-- Totals summary -->
    <section class="totals">
      <div class="row">
        <span>Materials</span><span class="v">{money(report.materials.subtotal)}</span>
      </div>
      <div class="row">
        <span>Labor <em>{hours(report.labor.hours)}</em></span><span class="v"
          >{money(report.labor.cost)}</span
        >
      </div>
      {#if report.manualSubtotal !== 0}
        <div class="row">
          <span>Line items</span><span class="v">{money(report.manualSubtotal)}</span>
        </div>
      {/if}
      <div class="row sub">
        <span>Subtotal</span><span class="v">{money(report.subtotal)}</span>
      </div>
      <div class="row muted">
        <span>Overhead ({Math.round(report.overheadPct * 100)}%)</span><span class="v"
          >{money(report.overhead)}</span
        >
      </div>
      <div class="row muted">
        <span>Margin ({Math.round(report.marginPct * 100)}%)</span><span class="v"
          >{money(report.margin)}</span
        >
      </div>
      <div class="row total">
        <span>Total</span><span class="v">{money(report.total)}</span>
      </div>
      {#if report.hasUnpricedGlass}
        <p class="warn">A glass in use has no price — the total understates material cost.</p>
      {/if}
    </section>

    <!-- Sensitivity (FR-6) -->
    <section
      class="sensitivity"
      role="group"
      onmouseenter={() => onHighlight(smallestIds)}
      onmouseleave={onClearHighlight}
    >
      <span class="eyebrow">Sensitivity</span>
      <p class="sens-line">
        The <input
          class="n"
          type="number"
          min="1"
          value={smallestN}
          aria-label="Number of smallest pieces"
          oninput={(e) =>
            onSmallestN(Math.max(1, Math.round(num(e.currentTarget.value, smallestN))))}
        />
        smallest pieces contribute
        <strong class="mono">{money(smallestCost)}</strong> of labor.
      </p>
      <p class="hint">Hover to highlight them on the canvas.</p>
    </section>

    <!-- Overhead & margin -->
    <section>
      <span class="eyebrow">Overhead & margin</span>
      <div class="grid2">
        <Input
          size="sm"
          label="Overhead (%)"
          value={(Math.round(settings.overheadPct * 1000) / 10).toString()}
          onchange={(v) => onPatch({ overheadPct: num(v, settings.overheadPct * 100) / 100 })}
        />
        <Input
          size="sm"
          label="Margin — markup (%)"
          value={(Math.round(settings.marginPct * 1000) / 10).toString()}
          onchange={(v) => onPatch({ marginPct: num(v, settings.marginPct * 100) / 100 })}
        />
      </div>
    </section>
  {/if}

  <!-- Labor model (transparent, FR-4) -->
  <section>
    <button class="disclosure" onclick={() => (laborOpen = !laborOpen)} aria-expanded={laborOpen}>
      <span class="eyebrow">Labor model</span>
      <span class="chevron">{laborOpen ? '−' : '+'}</span>
    </button>
    {#if laborOpen}
      <p class="model-note">
        Uncalibrated placeholder defaults. Hours = setup + per-piece (base + complexity{report &&
        report.labor.pieceFactor !== 1
          ? `, ×${report.labor.pieceFactor} for foil`
          : ''}) + per metre of seam.
      </p>
      {#if report}
        <dl class="breakdown">
          <div>
            <dt>Setup</dt>
            <dd>{hours(report.labor.setupHours)} · {money(report.labor.setupCost)}</dd>
          </div>
          <div>
            <dt>Cutting & fitting</dt>
            <dd>{hours(report.labor.pieceHours)} · {money(report.labor.pieceCost)}</dd>
          </div>
          <div>
            <dt>Leading / foiling</dt>
            <dd>{hours(report.labor.seamHours)} · {money(report.labor.seamCost)}</dd>
          </div>
        </dl>
      {/if}
      <div class="settings">
        <Input
          size="sm"
          label="Hourly rate ({sym}/h)"
          value={settings.labor.hourlyRate.toString()}
          onchange={(v) => patchLabor({ hourlyRate: num(v, settings.labor.hourlyRate) })}
        />
        <Input
          size="sm"
          label="Setup (hours)"
          value={settings.labor.setupHours.toString()}
          onchange={(v) => patchLabor({ setupHours: num(v, settings.labor.setupHours) })}
        />
        <Input
          size="sm"
          label="Minutes per piece"
          value={settings.labor.minutesPerPiece.toString()}
          onchange={(v) => patchLabor({ minutesPerPiece: num(v, settings.labor.minutesPerPiece) })}
        />
        <Input
          size="sm"
          label="Minutes per metre of seam"
          value={settings.labor.minutesPerSeamMetre.toString()}
          onchange={(v) =>
            patchLabor({ minutesPerSeamMetre: num(v, settings.labor.minutesPerSeamMetre) })}
        />
        <Input
          size="sm"
          label="Minutes per complexity"
          value={settings.labor.minutesPerComplexity.toString()}
          onchange={(v) =>
            patchLabor({ minutesPerComplexity: num(v, settings.labor.minutesPerComplexity) })}
        />
        <Input
          size="sm"
          label="Foil per-piece factor"
          value={settings.labor.foilPieceFactor.toString()}
          onchange={(v) => patchLabor({ foilPieceFactor: num(v, settings.labor.foilPieceFactor) })}
        />
      </div>
    {/if}
  </section>

  <!-- Price book (FR-5) -->
  <section>
    <button
      class="disclosure"
      onclick={() => (pricesOpen = !pricesOpen)}
      aria-expanded={pricesOpen}
    >
      <span class="eyebrow">Price book</span>
      <span class="chevron">{pricesOpen ? '−' : '+'}</span>
    </button>
    {#if pricesOpen}
      <div class="settings">
        <Select
          size="sm"
          label="Currency"
          options={CURRENCIES}
          value={settings.currency.code}
          onchange={setCurrency}
        />
        <Input
          size="sm"
          label="Lead came ({sym}/m)"
          value={settings.priceBook.leadPerMetre.toString()}
          onchange={(v) =>
            patchPriceBook({ leadPerMetre: num(v, settings.priceBook.leadPerMetre) })}
        />
        <Input
          size="sm"
          label="Copper foil ({sym}/m)"
          value={settings.priceBook.foilPerMetre.toString()}
          onchange={(v) =>
            patchPriceBook({ foilPerMetre: num(v, settings.priceBook.foilPerMetre) })}
        />
        <Input
          size="sm"
          label="Solder ({sym}/kg)"
          value={settings.priceBook.solderPerKg.toString()}
          onchange={(v) => patchPriceBook({ solderPerKg: num(v, settings.priceBook.solderPerKg) })}
        />
        <Input
          size="sm"
          label="Reinforcement ({sym}/m)"
          value={settings.priceBook.reinforcementPerMetre.toString()}
          onchange={(v) =>
            patchPriceBook({
              reinforcementPerMetre: num(v, settings.priceBook.reinforcementPerMetre),
            })}
        />
      </div>

      <div class="list">
        <span class="sub">Consumables</span>
        {#each settings.priceBook.consumables as c (c.id)}
          <div class="list-row">
            <Input size="sm" value={c.name} onchange={(v) => updateConsumable(c.id, { name: v })} />
            <input
              class="amount"
              type="number"
              aria-label="Consumable cost"
              value={c.cost}
              oninput={(e) => updateConsumable(c.id, { cost: num(e.currentTarget.value, c.cost) })}
            />
            <button
              class="remove"
              aria-label="Remove consumable"
              onclick={() => removeConsumable(c.id)}>×</button
            >
          </div>
        {/each}
        <Button variant="secondary" size="sm" onclick={addConsumable}>Add consumable</Button>
      </div>

      {#if onSaveWorkshopDefault || onLoadWorkshopDefault}
        <div class="workshop">
          {#if onLoadWorkshopDefault}
            <Button variant="secondary" size="sm" onclick={onLoadWorkshopDefault}>
              Load workshop default
            </Button>
          {/if}
          {#if onSaveWorkshopDefault}
            <Button variant="secondary" size="sm" onclick={onSaveWorkshopDefault}>
              Save as workshop default
            </Button>
          {/if}
        </div>
      {/if}
    {/if}
  </section>

  <!-- Manual line items -->
  <section>
    <span class="eyebrow">Line items</span>
    <div class="list">
      {#each settings.manualLines as line (line.id)}
        <div class="list-row">
          <Input
            size="sm"
            value={line.description}
            onchange={(v) => updateManualLine(line.id, { description: v })}
          />
          <input
            class="amount"
            type="number"
            aria-label="Line item amount"
            value={line.amount}
            oninput={(e) =>
              updateManualLine(line.id, { amount: num(e.currentTarget.value, line.amount) })}
          />
          <button
            class="remove"
            aria-label="Remove line item"
            onclick={() => removeManualLine(line.id)}>×</button
          >
        </div>
      {/each}
      <Button variant="secondary" size="sm" onclick={addManualLine}>Add line item</Button>
    </div>
  </section>

  <!-- Client & quote -->
  <section>
    <button
      class="disclosure"
      onclick={() => (clientOpen = !clientOpen)}
      aria-expanded={clientOpen}
    >
      <span class="eyebrow">Client & quote</span>
      <span class="chevron">{clientOpen ? '−' : '+'}</span>
    </button>
    {#if clientOpen}
      <div class="settings">
        <Input
          size="sm"
          label="Project title"
          value={settings.client.projectTitle}
          onchange={(v) => patchClient({ projectTitle: v })}
        />
        <Input
          size="sm"
          label="Client name"
          value={settings.client.clientName}
          onchange={(v) => patchClient({ clientName: v })}
        />
        <Input
          size="sm"
          label="Quote number"
          value={settings.client.quoteNumber}
          onchange={(v) => patchClient({ quoteNumber: v })}
        />
        <Input
          size="sm"
          label="Notes"
          value={settings.client.notes}
          onchange={(v) => patchClient({ notes: v })}
        />
      </div>
    {/if}
  </section>
</div>

<style>
  .quote {
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

  section:first-child {
    padding-top: 0;
    border-top: none;
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  /* Totals summary */
  .totals {
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font: var(--text-small);
    color: var(--ink-800);
  }

  .row em {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
    margin-left: var(--space-1);
  }

  .row .v {
    font-family: var(--font-mono);
    color: var(--ink-900);
  }

  .row.muted,
  .row.muted .v {
    color: var(--ink-500);
  }

  .row.sub {
    margin-top: 2px;
    padding-top: 4px;
    border-top: 1px solid var(--paper-100);
    font-weight: 600;
  }

  .row.total {
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--border-strong);
    font: 700 15px/1.2 var(--font-sans);
    color: var(--ink-950);
  }

  .row.total .v {
    font-size: 15px;
    font-weight: 700;
    color: var(--cobalt-700);
  }

  .warn {
    margin: var(--space-1) 0 0;
    font: var(--text-caption);
    color: var(--warning-600);
  }

  /* Sensitivity */
  .sensitivity:hover {
    background: var(--paper-50);
  }

  .sens-line {
    margin: 0;
    font: var(--text-small);
    color: var(--ink-800);
  }

  .sens-line .mono {
    font-family: var(--font-mono);
    color: var(--cobalt-700);
  }

  .n {
    width: 44px;
    padding: 1px 4px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: right;
  }

  .hint {
    margin: 0;
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .model-note {
    margin: 0 0 var(--space-2);
    font: var(--text-caption);
    color: var(--text-muted);
  }

  .breakdown {
    margin: 0 0 var(--space-2);
    display: grid;
    gap: 1px;
  }

  .breakdown div {
    display: flex;
    justify-content: space-between;
    font: var(--text-caption);
  }

  .breakdown dt {
    color: var(--text-muted);
  }

  .breakdown dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--ink-700);
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    /* Bottom-align, so the inputs line up even when one label wraps to two lines at this
       dock width ("Margin — markup (%)" does). */
    align-items: end;
  }

  .settings {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }

  .sub {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--ink-500);
  }

  .list-row {
    display: grid;
    grid-template-columns: 1fr 70px auto;
    align-items: center;
    gap: var(--space-2);
  }

  .amount {
    width: 100%;
    padding: 4px 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: right;
  }

  .remove {
    border: none;
    background: none;
    color: var(--ink-500);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 4px;
  }

  .remove:hover {
    color: var(--ruby-600);
  }

  .workshop {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-top: var(--space-2);
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
</style>
