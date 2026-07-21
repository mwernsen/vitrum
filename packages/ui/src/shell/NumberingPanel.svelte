<script lang="ts">
  import type { NumberingScheme } from '@vitrum/core'

  import Button from '../components/Button.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'

  /** One legend row: a glass code, the glass it maps to, and how many pieces use it (FR-4). */
  export interface LegendEntry {
    glassId: string
    code: string
    name: string
    manufacturer?: string
    count: number
  }

  interface Props {
    /** Active numbering scheme (F-040). */
    scheme: NumberingScheme
    /** Change the scheme (does not renumber — the user renumbers explicitly). */
    onScheme: (scheme: NumberingScheme) => void
    /** Renumber every piece under the current scheme, keeping manual overrides (FR-1). */
    onRenumber: () => void
    /** Edit a glass's code (A, B, C…). */
    onSetCode: (glassId: string, code: string) => void
    /** Total detected pieces (F-020). */
    pieceCount: number
    /** Pieces with no number yet (FR-3). */
    unnumbered: number
    /** Legend rows for glasses in use (FR-4). */
    legend: readonly LegendEntry[]
    /** Open the 1:1 print dialog (F-041). Absent ⇒ the print action stays a placeholder. */
    onPrint?: () => void
    /** Whether there is something to print (a host export port + non-empty panel). */
    printAvailable?: boolean
  }

  let {
    scheme,
    onScheme,
    onRenumber,
    onSetCode,
    pieceCount,
    unnumbered,
    legend,
    onPrint,
    printAvailable = false,
  }: Props = $props()

  const SCHEME_OPTIONS = [
    { value: 'grouped', label: 'Grouped by glass (A1, A2…)' },
    { value: 'sequential', label: 'Sequential (1, 2…)' },
    { value: 'manual', label: 'Manual only' },
  ]

  const numbered = $derived(Math.max(0, pieceCount - unnumbered))
</script>

<div class="numbering">
  <div class="fields">
    <Select
      size="sm"
      label="Numbering scheme"
      options={SCHEME_OPTIONS}
      value={scheme}
      onchange={(v) => onScheme(v as NumberingScheme)}
    />
  </div>

  <div class="actions">
    <Button size="sm" variant="primary" onclick={onRenumber} disabled={pieceCount === 0}>
      Renumber
    </Button>
  </div>

  <dl class="props">
    <div>
      <dt>Numbered</dt>
      <dd>{numbered} / {pieceCount}</dd>
    </div>
    {#if unnumbered > 0}
      <div>
        <dt>Unnumbered</dt>
        <dd class="warn">{unnumbered}</dd>
      </div>
    {/if}
  </dl>

  <div class="section">
    <span class="eyebrow">Glass legend</span>
    {#if legend.length === 0}
      <p class="note">Assign glass to pieces, then renumber to build the legend.</p>
    {:else}
      <div class="legend">
        {#each legend as entry (entry.glassId)}
          <div class="legend-row">
            <Input
              size="sm"
              placeholder="code"
              value={entry.code}
              onchange={(v) => onSetCode(entry.glassId, v.trim())}
            />
            <span class="legend-name">
              <span class="name">{entry.name}</span>
              {#if entry.manufacturer}<span class="maker">{entry.manufacturer}</span>{/if}
            </span>
            <span class="count">{entry.count}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Outputs: 1:1 print is live (F-041); the rest arrive with their own features. -->
  <div class="section">
    <span class="eyebrow">Outputs</span>
    {#if onPrint}
      <Button
        size="sm"
        variant="secondary"
        onclick={onPrint}
        disabled={!printAvailable || pieceCount === 0}
      >
        Print cartoon 1:1…
      </Button>
    {:else}
      <div class="scaffold-row">
        <span class="ph-label">Print cartoon 1:1</span><span class="feature">F-041</span>
      </div>
    {/if}
    <div class="scaffold-row">
      <span class="ph-label">Export (SVG, DXF, machines)</span><span class="feature">F-043</span>
    </div>
  </div>
</div>

<style>
  .numbering {
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
    gap: var(--space-2);
  }

  .props {
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }

  .props div {
    display: flex;
    justify-content: space-between;
    font: var(--text-small);
  }

  .props dt {
    color: var(--text-muted);
  }

  .props dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--text-body);
  }

  .props dd.warn {
    color: var(--warning-600);
  }

  .section {
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

  .note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .legend {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .legend-row {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    align-items: center;
    gap: var(--space-2);
  }

  .legend-name {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .legend-name .name {
    font: 600 12.5px/1.2 var(--font-sans);
    color: var(--ink-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .maker {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .count {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-500);
  }

  .scaffold-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--paper-100);
  }

  .ph-label {
    font: var(--text-small);
    color: var(--text-muted);
  }

  .feature {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--ink-500);
    padding: 2px 7px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
  }
</style>
