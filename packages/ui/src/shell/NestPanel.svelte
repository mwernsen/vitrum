<script lang="ts">
  import { formatLength, type LengthUnit } from '@vitrum/core'
  import type { Glass, GlassId, NestRotationPolicy, NestStrategy } from '@vitrum/model'
  import type { NestSheetSize } from '@vitrum/nest'

  import Button from '../components/Button.svelte'
  import Select from '../components/Select.svelte'
  import type { NestController } from '../nest/controller.svelte'

  interface Props {
    /** The sheet-nesting controller (F-057). */
    nest: NestController
    /** Project glasses, for display names, swatch colour and grain. */
    glasses: Readonly<Record<GlassId, Glass>>
    /** Active length unit for the cut-allowance and sheet captions. */
    unit: LengthUnit
  }

  let { nest, glasses, unit }: Props = $props()

  /** Which glass row is expanded. One at a time, so the stock choice stays a focused decision. */
  let open = $state<GlassId | null>(null)

  const STRATEGIES: { id: NestStrategy; label: string; hint: string }[] = [
    {
      id: 'tight',
      label: 'Tightest fit',
      hint: 'Packs by height — leftover strips stay usable, cut directions end up mixed.',
    },
    {
      id: 'fewest',
      label: 'Fewest sheets',
      hint: 'Biggest pieces first — the best sheet count on most panels, some awkward offcuts.',
    },
    {
      id: 'fast',
      label: 'Fastest cuts',
      hint: 'Aligns pieces in long rows — more scores run straight across.',
    },
  ]

  const ROTATION_OPTIONS: { value: NestRotationPolicy; label: string }[] = [
    { value: 'quadrant', label: 'Any 90°' },
    { value: 'free', label: 'Any angle' },
    { value: 'flip', label: 'Grain 0/180°' },
    { value: 'fixed', label: 'Upright 0°' },
  ]

  const sheetKey = (s: NestSheetSize): string => `${s.widthMm}×${s.heightMm}`
  const glassName = (id: GlassId): string => glasses[id]?.name ?? 'Unassigned'
  const glassColor = (id: GlassId): string => glasses[id]?.color ?? '#cccccc'
  /** Streaky glass has a direction to preserve — the reason its rotation is constrained. */
  const grainNote = (id: GlassId): string =>
    glasses[id]?.texture === 'streaky' ? 'streaky — keep grain' : 'no grain'

  const pct = (u: number): string => `${Math.round(u * 100)}%`
  const dims = (s: NestSheetSize): string =>
    `${formatLength(s.widthMm, unit)} × ${formatLength(s.heightMm, unit)}`

  const strategyHint = $derived(
    (STRATEGIES.find((s) => s.id === nest.settings.strategy) ?? STRATEGIES[1]!).hint,
  )

  const sheetsTotal = $derived(nest.result?.totalSheets ?? 0)
  const sheetsTotalLabel = $derived(
    nest.result ? `${sheetsTotal} sheet${sheetsTotal === 1 ? '' : 's'}` : 'not nested yet',
  )

  const rows = $derived(
    nest.glassesInUse.map((id) => ({
      id,
      name: glassName(id),
      color: glassColor(id),
      grain: grainNote(id),
      config: nest.configFor(id),
      options: nest.sheetOptions(id),
      nested: nest.result?.glasses.find((g) => g.glassId === id),
    })),
  )

  /** Every piece the current layout could not place, across all glasses — the blocking problem. */
  const unfit = $derived.by(() => {
    const out: { glass: GlassId; count: number }[] = []
    for (const g of nest.result?.glasses ?? []) {
      if (g.unplaced.length > 0) out.push({ glass: g.glassId, count: g.unplaced.length })
    }
    return out
  })

  /** The smallest offered sheet that would take every piece of a glass, if a bigger one exists. */
  function biggerSheet(id: GlassId): NestSheetSize | null {
    const current = nest.configFor(id).sheet
    const area = (s: NestSheetSize) => s.widthMm * s.heightMm
    const bigger = nest
      .sheetOptions(id)
      .filter((s) => area(s) > area(current))
      .sort((a, b) => area(a) - area(b))
    return bigger[0] ?? null
  }

  function onSheet(id: GlassId, key: string, options: NestSheetSize[]): void {
    const sheet = options.find((s) => sheetKey(s) === key)
    if (sheet) nest.setGlassSheet(id, sheet)
  }

  function stepAllowance(delta: number): void {
    nest.setSpacing(Math.min(10, Math.max(0, nest.settings.spacingMm + delta)))
  }
</script>

<!--
  The nesting panel (F-057), reworked to the "Nesting page redesign" design. Docked beside the sheet
  layout it drives rather than floating over it, and ordered as the decision actually runs: what
  went wrong → how to arrange → what stock to buy it on. Every number here is read from the live
  nest result; the panel holds no layout state of its own beyond which glass row is expanded.
-->
<section class="nest-panel" aria-label="Nesting">
  <header class="head">
    <h2>Nest</h2>
    <span class="total">{sheetsTotalLabel}</span>
  </header>

  {#if nest.error}
    <p class="error" role="alert">{nest.error}</p>
  {/if}

  {#each unfit as u (u.glass)}
    {@const bigger = biggerSheet(u.glass)}
    <div class="unfit">
      <div class="unfit-line">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="var(--amber-600)" stroke-width="1.8" />
          <path
            d="M12 8v5M12 16.5v.5"
            stroke="var(--amber-600)"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
        <p>
          {u.count} piece{u.count === 1 ? '' : 's'} of {glassName(u.glass)}
          {u.count === 1 ? 'is' : 'are'} larger than the
          {dims(nest.configFor(u.glass).sheet)} sheet, so {u.count === 1 ? 'it' : 'they'} can't be cut.
        </p>
      </div>
      {#if bigger}
        <button class="unfit-fix" type="button" onclick={() => nest.setGlassSheet(u.glass, bigger)}>
          Use {dims(bigger)} for {glassName(u.glass)}
        </button>
      {/if}
    </div>
  {/each}

  <div class="block">
    <div class="eyebrow">Arrangement</div>
    <div class="segmented" role="group" aria-label="Placement order">
      {#each STRATEGIES as s (s.id)}
        <button
          type="button"
          class="seg"
          class:active={nest.settings.strategy === s.id}
          title={s.hint}
          aria-pressed={nest.settings.strategy === s.id}
          onclick={() => nest.setStrategy(s.id)}
        >
          {s.label}
        </button>
      {/each}
    </div>
    <p class="hint">{strategyHint}</p>

    <div class="allowance">
      <label for="nest-allowance">Cut allowance</label>
      <div class="stepper">
        <button type="button" aria-label="Less cut allowance" onclick={() => stepAllowance(-1)}>
          −
        </button>
        <span id="nest-allowance">{formatLength(nest.settings.spacingMm, unit)}</span>
        <button type="button" aria-label="More cut allowance" onclick={() => stepAllowance(1)}>
          +
        </button>
      </div>
      <span class="aside">saw + grozing</span>
    </div>

    <div class="actions">
      {#if nest.running}
        <Button size="sm" variant="secondary" onclick={() => nest.cancel()}>Cancel</Button>
        <span class="progress" aria-live="polite">
          {Math.round((nest.progress?.fraction ?? 0) * 100)}%
        </span>
      {:else}
        <Button size="sm" variant="primary" onclick={() => nest.run()} disabled={!nest.canNest}>
          {nest.hasRun ? 'Re-nest all' : 'Nest'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onclick={() => nest.reshuffle()}
          disabled={!nest.canNest}
        >
          Try another layout
        </Button>
      {/if}
    </div>
  </div>

  <div class="block">
    <div class="block-head">
      <div class="eyebrow">Sheet stock per glass</div>
      <span class="aside">{rows.length} glass{rows.length === 1 ? '' : 'es'}</span>
    </div>

    {#if rows.length === 0}
      <p class="hint">Assign glass to pieces, then nest to lay them onto sheets.</p>
    {:else}
      <div class="glasses">
        {#each rows as row (row.id)}
          {@const expanded = open === row.id}
          <div class="glass" class:expanded>
            <button
              type="button"
              class="glass-head"
              aria-expanded={expanded}
              onclick={() => (open = expanded ? null : row.id)}
            >
              <span class="dot" style:background={row.color}></span>
              <span class="glass-name">
                <span class="name">{row.name}</span>
                <span class="stock">
                  {#if row.nested}
                    {row.nested.sheetCount} × {dims(row.config.sheet)}
                  {:else}
                    {dims(row.config.sheet)}
                  {/if}
                </span>
              </span>
              {#if row.nested}
                <span class="yield">
                  <span class="bar">
                    <span
                      class="fill"
                      class:low={row.nested.utilization < 0.25}
                      style:width={`${Math.max(2, Math.min(100, row.nested.utilization * 100))}%`}
                    ></span>
                  </span>
                  <span class="yield-pct">{pct(row.nested.utilization)}</span>
                </span>
              {/if}
              <svg
                class="chev"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m6 9 6 6 6-6"
                  stroke="var(--ink-500)"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>

            {#if expanded}
              <div class="glass-body">
                <Select
                  size="sm"
                  label="Stock size"
                  options={row.options.map((s) => ({
                    value: sheetKey(s),
                    label: s.label ? `${s.label} — ${dims(s)}` : dims(s),
                  }))}
                  value={sheetKey(row.config.sheet)}
                  onchange={(v) => onSheet(row.id, v, row.options)}
                />
                <Select
                  size="sm"
                  label="Rotation"
                  options={ROTATION_OPTIONS}
                  value={row.config.rotation}
                  onchange={(v) => nest.setGlassRotation(row.id, v as NestRotationPolicy)}
                />
                <p class="grain">{row.grain}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .nest-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 18px 20px 12px;
  }

  .head h2 {
    margin: 0;
    font: var(--text-h3);
    letter-spacing: var(--tracking-tight);
    color: var(--text-strong);
  }

  .total {
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .error {
    margin: 0 20px 16px;
    font: var(--text-small);
    color: var(--danger-600);
  }

  /* A piece that fits no sheet is the one thing that makes the layout unusable, so it leads. */
  .unfit {
    margin: 0 20px 16px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--amber-100);
    border: 1px solid var(--warning-600);
    border-radius: var(--radius-md);
  }

  .unfit-line {
    display: flex;
    align-items: flex-start;
    gap: 9px;
  }

  .unfit-line svg {
    flex: none;
    margin-top: 2px;
  }

  .unfit-line p {
    margin: 0;
    font: var(--text-small);
    color: var(--ink-800);
    text-wrap: pretty;
  }

  .unfit-fix {
    align-self: flex-start;
    padding: 5px 12px;
    background: var(--paper-0);
    border: 1px solid var(--warning-600);
    border-radius: var(--radius-full);
    font: var(--text-caption);
    font-weight: 600;
    color: var(--amber-600);
    cursor: pointer;
  }

  .unfit-fix:hover {
    background: var(--amber-100);
  }

  .block {
    padding: 8px 20px 20px;
  }

  .block-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: var(--space-2);
  }

  .block-head .eyebrow {
    margin-bottom: 0;
  }

  .aside {
    font: var(--text-caption);
    color: var(--text-muted);
  }

  .hint {
    margin: var(--space-2) 0 0;
    font: var(--text-small);
    color: var(--text-muted);
    text-wrap: pretty;
  }

  /* Placement order: three mutually exclusive orders, so a segmented control rather than a select. */
  .segmented {
    display: flex;
    gap: 3px;
    padding: 3px;
    background: var(--paper-100);
    border-radius: var(--radius-full);
  }

  .seg {
    flex: 1;
    padding: 7px 6px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    font: 600 13px/1.2 var(--font-sans);
    color: var(--ink-600);
    cursor: pointer;
  }

  .seg:hover:not(.active) {
    color: var(--text-strong);
  }

  .seg.active {
    background: var(--paper-0);
    box-shadow: var(--shadow-xs);
    color: var(--text-strong);
  }

  .allowance {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: 14px;
  }

  .allowance label {
    font: var(--text-small);
    font-weight: 600;
    color: var(--text-strong);
  }

  .stepper {
    display: flex;
    align-items: center;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .stepper button {
    width: 30px;
    height: 32px;
    border: none;
    background: var(--paper-0);
    color: var(--ink-600);
    font-size: 16px;
    cursor: pointer;
  }

  .stepper button:hover {
    background: var(--paper-100);
  }

  .stepper span {
    min-width: 56px;
    text-align: center;
    font: 600 14px/1 var(--font-mono);
    color: var(--text-strong);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: 16px;
  }

  .progress {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .glasses {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .glass {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--paper-0);
    overflow: hidden;
  }

  .glass-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .glass-head:hover {
    background: var(--paper-50);
  }

  .dot {
    width: 12px;
    height: 12px;
    flex: none;
    border-radius: 50%;
    border: 1px solid var(--border-subtle);
  }

  .glass-name {
    flex: 1;
    min-width: 0;
  }

  .glass-name .name {
    display: block;
    font: var(--text-small);
    font-weight: 600;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .glass-name .stock {
    display: block;
    margin-top: 2px;
    font: var(--text-eyebrow);
    color: var(--text-muted);
  }

  .yield {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .bar {
    width: 52px;
    height: 4px;
    border-radius: 2px;
    background: var(--paper-200);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--ink-800);
  }

  /* A barely-used sheet is usually the wrong stock size, so flag it rather than just reporting it. */
  .fill.low {
    background: var(--amber-600);
  }

  .yield-pct {
    min-width: 30px;
    text-align: right;
    font: var(--text-eyebrow);
    color: var(--text-muted);
  }

  .chev {
    flex: none;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .glass.expanded .chev {
    transform: rotate(180deg);
  }

  .glass-body {
    display: grid;
    gap: var(--space-3);
    padding: 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .grain {
    margin: 0;
    font: var(--text-caption);
    color: var(--text-muted);
  }
</style>
