<script lang="ts">
  import type { LengthUnit } from '@vitrum/core'
  import type { Glass, GlassId, NestRotationPolicy } from '@vitrum/model'
  import type { NestSheetSize } from '@vitrum/nest'

  import Button from '../components/Button.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import type { NestController } from '../nest/controller.svelte'

  interface Props {
    /** The sheet-nesting controller (F-057). */
    nest: NestController
    /** Project glasses, for display names. */
    glasses: Readonly<Record<GlassId, Glass>>
    /** Active length unit (for the cut-allowance label). */
    unit: LengthUnit
  }

  let { nest, glasses, unit }: Props = $props()

  const ROTATION_OPTIONS: { value: NestRotationPolicy; label: string }[] = [
    { value: 'quadrant', label: 'Any 90°' },
    { value: 'free', label: 'Any angle' },
    { value: 'flip', label: 'Grain 0/180°' },
    { value: 'fixed', label: 'Upright 0°' },
  ]

  const sheetKey = (s: NestSheetSize): string => `${s.widthMm}×${s.heightMm}`
  const sheetLabel = (s: NestSheetSize): string =>
    s.label ? `${s.label} (${sheetKey(s)})` : sheetKey(s)

  const glassName = (id: GlassId): string => glasses[id]?.name ?? 'Unassigned'

  // Reactive view of the glasses we can nest and their resolved config.
  const rows = $derived(
    nest.glassesInUse.map((id) => ({
      id,
      name: glassName(id),
      config: nest.configFor(id),
      options: nest.sheetOptions(id),
      sheets: nest.result?.glasses.find((g) => g.glassId === id),
    })),
  )

  function onSpacing(value: string): void {
    const mm = Number.parseFloat(value)
    if (Number.isFinite(mm)) nest.setSpacing(mm)
  }

  function onSheet(id: GlassId, key: string, options: NestSheetSize[]): void {
    const sheet = options.find((s) => sheetKey(s) === key)
    if (sheet) nest.setGlassSheet(id, sheet)
  }

  const pct = (u: number): string => `${Math.round(u * 100)}%`
</script>

<!--
  Floating nesting-controls card (F-057). Mirrors the F-054 light card: shown only in the nest view,
  so the controls and the on-screen sheet layout always agree. Holds the tunable intent (cut
  allowance, per-glass sheet + rotation policy) and the run/cancel/reshuffle actions; the nested
  sheets themselves render behind it in NestView. `.stage` is the positioned ancestor.
-->
<aside class="nest-card" aria-label="Nesting controls">
  <header class="head">
    <span class="title">Nesting</span>
    {#if nest.result}
      <span class="total"
        >{nest.result.totalSheets} sheet{nest.result.totalSheets === 1 ? '' : 's'}</span
      >
    {/if}
  </header>

  <div class="scroll">
    <div class="fields">
      <Input
        size="sm"
        type="number"
        label={`Cut allowance (${unit})`}
        value={String(nest.settings.spacingMm)}
        onchange={onSpacing}
      />
    </div>

    <div class="actions">
      {#if nest.running}
        <Button size="sm" variant="secondary" onclick={() => nest.cancel()}>Cancel</Button>
        <span class="progress" aria-live="polite">
          {Math.round((nest.progress?.fraction ?? 0) * 100)}%
        </span>
      {:else}
        <Button size="sm" variant="primary" onclick={() => nest.run()} disabled={!nest.canNest}>
          {nest.hasRun ? 'Re-nest' : 'Nest'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onclick={() => nest.reshuffle()}
          disabled={!nest.canNest}
        >
          Reshuffle
        </Button>
      {/if}
    </div>

    {#if nest.error}
      <p class="error" role="alert">{nest.error}</p>
    {/if}

    {#if rows.length === 0}
      <p class="note">Assign glass to pieces, then nest to lay them onto sheets.</p>
    {:else}
      <div class="glasses">
        {#each rows as row (row.id)}
          <div class="glass-row">
            <div class="glass-head">
              <span class="glass-name">{row.name}</span>
              {#if row.sheets}
                <span class="glass-stat">
                  {row.sheets.sheetCount}&nbsp;·&nbsp;{pct(row.sheets.utilization)}
                </span>
              {/if}
            </div>
            <Select
              size="sm"
              label="Sheet"
              options={row.options.map((s) => ({ value: sheetKey(s), label: sheetLabel(s) }))}
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
            {#if row.sheets && row.sheets.unplaced.length > 0}
              <p class="warn">
                {row.sheets.unplaced.length} piece{row.sheets.unplaced.length === 1 ? '' : 's'} too large
                for this sheet
              </p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</aside>

<style>
  .nest-card {
    position: absolute;
    top: 34px;
    right: 34px;
    z-index: 6;
    width: 280px;
    max-height: calc(100% - 68px);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .title {
    font: var(--text-h4);
    color: var(--text-strong);
  }

  .total {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .fields {
    display: grid;
    gap: var(--space-3);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .progress {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .error {
    margin: 0;
    font: var(--text-small);
    color: var(--danger-600);
  }

  .note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .glasses {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .glass-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .glass-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .glass-name {
    font: 600 12.5px/1.2 var(--font-sans);
    color: var(--ink-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .glass-stat {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-500);
    white-space: nowrap;
  }

  .warn {
    margin: 0;
    font: var(--text-caption);
    color: var(--warning-600);
  }
</style>
