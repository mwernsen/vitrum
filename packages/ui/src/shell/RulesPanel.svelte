<script lang="ts">
  import { RULES, type Severity, type Violation } from '@vitrum/drc'
  import type { Project } from '@vitrum/model'
  import Check from 'lucide-svelte/icons/check'
  import Settings2 from 'lucide-svelte/icons/settings-2'

  import Checkbox from '../components/Checkbox.svelte'
  import Select from '../components/Select.svelte'
  import type { DrcController } from '../drc/controller.svelte'

  interface Props {
    /** The DRC controller (F-030). */
    drc: DrcController
    /** The document, for per-rule override state (FR-4). */
    doc?: Project
    /** Run a full check now. Wired by the shell, which owns the input. */
    onRun?: () => void
  }

  let { drc, doc, onRun }: Props = $props()

  let settingsOpen = $state(false)
  // The note being typed for the selected violation's waiver.
  let waiveNote = $state('')
  // Which severities the queue is showing. Cockpit v2: a maker fixing errors does not want the
  // advisory notes in the way, so the filter is a first-class control rather than a rule override.
  let shown = $state<Record<Severity, boolean>>({ error: true, warning: true, info: true })

  const result = $derived(drc.result)
  const counts = $derived(result.counts)
  const excludedCount = $derived(result.excluded.length)

  const visible = $derived(result.violations.filter((v) => shown[v.severity]))
  // The one thing to fix next: the most severe visible violation. The engine already orders
  // violations by severity, so the head of the filtered list is it.
  const top = $derived<Violation | null>(visible[0] ?? null)

  const SEVERITY_OPTIONS = [
    { label: 'Error', value: 'error' },
    { label: 'Warning', value: 'warning' },
    { label: 'Info', value: 'info' },
  ]

  const filters = $derived<{ id: Severity; label: string }[]>([
    { id: 'error', label: `${counts.error} ${counts.error === 1 ? 'error' : 'errors'}` },
    { id: 'warning', label: `${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}` },
    { id: 'info', label: `${counts.info} ${counts.info === 1 ? 'note' : 'notes'}` },
  ])

  function severityVar(severity: Severity): string {
    return severity === 'error'
      ? 'var(--ruby-600)'
      : severity === 'warning'
        ? 'var(--amber-600)'
        : 'var(--cobalt-600)'
  }

  function selectRow(v: Violation): void {
    if (drc.selectedKey === v.key) {
      drc.select(null)
    } else {
      drc.select(v)
      waiveNote = ''
    }
  }

  function overrideFor(ruleId: string) {
    return doc?.drc.rules[ruleId]
  }

  // Per-rule tunable thresholds (F-031). The placeholder shows the technique-dependent default; a
  // typed value pins an override that persists across technique switches.
  const techniqueKind = $derived(doc?.technique.kind ?? 'lead')

  function thresholdOverride(ruleId: string, key: string): number | undefined {
    return doc?.drc.rules[ruleId]?.thresholds?.[key]
  }

  /** Set (empty clears) one threshold override, preserving the rule's other override fields. */
  function setThreshold(ruleId: string, key: string, raw: string): void {
    const ov = overrideFor(ruleId)
    const thresholds: Record<string, number> = { ...(ov?.thresholds ?? {}) }
    const value = Number.parseFloat(raw)
    if (raw.trim() === '' || Number.isNaN(value)) delete thresholds[key]
    else thresholds[key] = value
    const next = { ...(ov ?? {}) }
    if (Object.keys(thresholds).length > 0) next.thresholds = thresholds
    else delete next.thresholds
    drc.setRuleOverride(ruleId, Object.keys(next).length > 0 ? next : null)
  }
</script>

<div class="rules">
  <!-- ── Fix next: one violation, explained, with its fix on the same card ── -->
  {#if drc.hasRun && top && !settingsOpen && !drc.showExcluded}
    <div class="fix-next" data-testid="fix-next" style={`--sev:${severityVar(top.severity)}`}>
      <span class="eyebrow sev">Fix next</span>
      <span class="fx-title">{top.title}</span>
      <span class="fx-explain">{top.explain}</span>
      <div class="fx-actions">
        {#if top.quickFix}
          <button class="primary" onclick={() => drc.applyQuickFix(top)}
            >{top.quickFix.label}</button
          >
        {/if}
        <button class="secondary" onclick={() => drc.select(top)}>Show me</button>
        <button class="tertiary" onclick={() => drc.waive(top, '')}>Waive</button>
      </div>
    </div>
  {/if}

  <!-- ── Severity filters + run + rule settings ── -->
  <div class="controls">
    <div class="chips">
      {#if drc.hasRun && !settingsOpen}
        {#each filters as f (f.id)}
          <button
            class="chip"
            class:off={!shown[f.id]}
            aria-pressed={shown[f.id]}
            onclick={() => (shown = { ...shown, [f.id]: !shown[f.id] })}
          >
            <span class="dot" style={`background:${severityVar(f.id)}`}></span>{f.label}
          </button>
        {/each}
      {:else}
        <button class="run" onclick={() => onRun?.()} disabled={drc.running}>
          {drc.running ? 'Checking…' : 'Run checks'}
        </button>
      {/if}
    </div>
    <button
      class="settings"
      class:on={settingsOpen}
      aria-pressed={settingsOpen}
      aria-label="Rule settings"
      title="Rule settings"
      onclick={() => (settingsOpen = !settingsOpen)}
    >
      <Settings2 size={14} strokeWidth={1.7} />
    </button>
  </div>

  {#if settingsOpen}
    <div class="settings-list">
      {#each RULES as rule (rule.id)}
        {@const ov = overrideFor(rule.id)}
        <div class="setting">
          <div class="setting-head">
            <Checkbox
              label={rule.title}
              checked={ov?.enabled !== false}
              onchange={(enabled) =>
                drc.setRuleOverride(
                  rule.id,
                  enabled &&
                    (ov?.severity ?? undefined) === undefined &&
                    ov?.thresholds === undefined
                    ? null
                    : { ...(ov ?? {}), enabled },
                )}
            />
            <Select
              size="sm"
              options={SEVERITY_OPTIONS}
              value={ov?.severity ?? rule.defaultSeverity}
              onchange={(severity) =>
                drc.setRuleOverride(rule.id, {
                  ...(ov ?? {}),
                  severity: severity as Severity,
                })}
            />
          </div>
          {#if rule.thresholds && rule.thresholds.length > 0}
            <div class="thresholds">
              {#each rule.thresholds as spec (spec.key)}
                <label class="threshold" title={spec.rationale}>
                  <span class="threshold-label">{spec.label}</span>
                  <span class="threshold-input">
                    <input
                      type="number"
                      inputmode="decimal"
                      step="0.5"
                      min="0"
                      placeholder={String(spec.defaultFor(techniqueKind))}
                      value={thresholdOverride(rule.id, spec.key) ?? ''}
                      oninput={(e) => setThreshold(rule.id, spec.key, e.currentTarget.value)}
                    />
                    <span class="threshold-unit">{spec.unit}</span>
                  </span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if !drc.hasRun}
    <div class="empty">
      <p>Checks have not run yet.</p>
      <p class="muted">Run checks to flag near-miss joints, dangling lines and unassigned glass.</p>
    </div>
  {:else if drc.showExcluded}
    <div class="list" aria-label="Excluded violations">
      {#if result.excluded.length === 0}
        <div class="empty"><p class="muted">Nothing is waived.</p></div>
      {:else}
        {#each result.excluded as v (v.key)}
          <div class="row excluded">
            <span class="dot" style={`background:${severityVar(v.severity)}`}></span>
            <div class="body">
              <span class="title">{v.title}</span>
              {#if v.note}<span class="note">“{v.note}”</span>{/if}
            </div>
            <button class="link" onclick={() => drc.unwaive(v.key)}>Restore</button>
          </div>
        {/each}
      {/if}
    </div>
  {:else if result.violations.length === 0}
    <div class="empty clear">
      <span class="ok"><Check size={16} strokeWidth={2.4} /></span>
      <p>No issues found.</p>
    </div>
  {:else if visible.length === 0}
    <div class="empty"><p class="muted">Every issue is filtered out.</p></div>
  {:else}
    <div class="list" aria-label="Violations">
      {#each visible as v (v.key)}
        {@const selected = drc.selectedKey === v.key}
        <div class="row" class:selected>
          <button class="head" onclick={() => selectRow(v)}>
            <span class="dot" style={`background:${severityVar(v.severity)}`}></span>
            <span class="body">
              <span class="title">{v.title}</span>
              <span class="msg">{v.message}</span>
            </span>
            <span class="where">{v.pieceIds.length > 0 ? v.pieceIds.length : '—'}</span>
          </button>
          {#if selected}
            <div class="detail">
              <p class="explain">{v.explain}</p>
              <div class="fixes">
                {#if v.quickFix}
                  <button class="fix" onclick={() => drc.applyQuickFix(v)}
                    >{v.quickFix.label}</button
                  >
                {/if}
                <input
                  class="note-input"
                  type="text"
                  placeholder="Why waive? (optional)"
                  bind:value={waiveNote}
                />
                <button class="waive" onclick={() => drc.waive(v, waiveNote)}>Waive</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if drc.hasRun && !settingsOpen}
    <div class="footer">
      <span class="waived">{excludedCount} waived</span>
      <button class="link" onclick={() => (drc.showExcluded = !drc.showExcluded)}>
        {drc.showExcluded ? 'Back to issues' : 'View excluded'}
      </button>
      <span class="spacer"></span>
      <!-- Checks run live; this forces a full pass when you want to be sure. -->
      <button class="link" onclick={() => onRun?.()} disabled={drc.running}>
        {drc.running ? 'Checking…' : 'Re-run'}
      </button>
    </div>
  {/if}
</div>

<style>
  .rules {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  /* Fix next: the panel opens with one thing to do, not a wall of rows. */
  .fix-next {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 14px 14px 0;
    padding: 13px;
    border: 1px solid color-mix(in srgb, var(--sev) 26%, transparent);
    background: color-mix(in srgb, var(--sev) 5%, var(--paper-0));
    border-radius: var(--radius-md);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .eyebrow.sev {
    color: var(--sev);
  }

  .fx-title {
    font: 600 13.5px/1.35 var(--font-sans);
    color: var(--ink-950);
  }

  .fx-explain {
    font: var(--text-small);
    color: var(--ink-600);
  }

  .fx-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .primary {
    padding: 6px 12px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--ink-950);
    color: var(--paper-0);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .secondary {
    padding: 6px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-800);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .tertiary {
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-500);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .tertiary:hover {
    color: var(--ink-800);
  }

  /* The filters wrap inside their own box, so the settings gear keeps its place on the first line. */
  .controls {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    padding: 12px 14px 10px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    padding: 4px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-900);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .chip.off {
    border-color: var(--border-subtle);
    background: var(--paper-50);
    color: var(--paper-400);
  }

  .spacer {
    flex: 1;
  }

  .run {
    background: var(--ink-950);
    color: var(--paper-0);
    border: none;
    border-radius: var(--radius-full);
    padding: 6px 11px;
    white-space: nowrap;
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .run:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .settings {
    width: 26px;
    height: 26px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    color: var(--ink-600);
    cursor: pointer;
  }

  .settings.on {
    background: var(--ink-950);
    color: var(--paper-0);
    border-color: var(--ink-950);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex: none;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border-top: 1px solid var(--border-subtle);
  }

  .row {
    border-bottom: 1px solid var(--paper-100);
  }

  .row.selected {
    background: var(--cobalt-50);
    border-left: 2px solid var(--cobalt-600);
  }

  .head {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    width: 100%;
    text-align: left;
    padding: 10px 14px;
    background: none;
    border: none;
    cursor: pointer;
  }

  .head:hover {
    background: var(--paper-50);
  }

  .head .dot {
    margin-top: 5px;
  }

  .head .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .where {
    flex: none;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-500);
  }

  .title {
    font: 600 12.5px/1.3 var(--font-sans);
    color: var(--ink-900);
  }

  .msg {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .detail {
    padding: 0 14px 12px 25px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .explain {
    margin: 0;
    font: var(--text-caption);
    color: var(--ink-600);
  }

  .fixes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .fix {
    background: var(--ink-950);
    color: var(--paper-0);
    border: none;
    border-radius: var(--radius-full);
    padding: 5px 12px;
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .waive {
    background: var(--paper-0);
    color: var(--ink-700);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    padding: 5px 12px;
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .note-input {
    flex: 1;
    min-width: 90px;
    padding: 5px 9px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    color: var(--ink-800);
    font: 400 11.5px/1.2 var(--font-sans);
  }

  .row.excluded {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 10px 14px;
  }

  .row.excluded .dot {
    margin-top: 5px;
  }

  .row.excluded .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .note {
    font: var(--text-caption);
    color: var(--ink-500);
    font-style: italic;
  }

  .settings-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
  }

  .setting {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--paper-100);
  }

  .setting-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .thresholds {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-left: 24px;
  }

  .threshold {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .threshold-label {
    font: var(--text-caption);
    color: var(--ink-600);
  }

  .threshold-input {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .threshold-input input {
    width: 56px;
    padding: 4px 7px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    color: var(--ink-800);
    font: 500 11.5px/1 var(--font-mono);
    text-align: right;
  }

  .threshold-unit {
    font: var(--text-caption);
    color: var(--ink-500);
    min-width: 12px;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: var(--space-2);
    padding: 14px;
    border-top: 1px solid var(--border-subtle);
  }

  .empty p {
    margin: 0;
    font: var(--text-small);
    color: var(--ink-700);
  }

  .empty .muted {
    color: var(--text-muted);
  }

  .empty.clear {
    align-items: center;
    text-align: center;
    color: var(--ink-700);
  }

  .ok {
    display: inline-flex;
    color: var(--emerald-600);
  }

  .footer {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 10px 14px;
    border-top: 1px solid var(--border-subtle);
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--link);
    font: var(--text-caption);
    white-space: nowrap;
    cursor: pointer;
  }

  .link:disabled {
    color: var(--ink-500);
    cursor: default;
  }
</style>
