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
    /** Run a full check now ("Run checks"). Wired by the shell, which owns the input. */
    onRun?: () => void
  }

  let { drc, doc, onRun }: Props = $props()

  let settingsOpen = $state(false)
  // The note being typed for the selected violation's waiver.
  let waiveNote = $state('')

  const result = $derived(drc.result)
  const counts = $derived(result.counts)
  const total = $derived(counts.error + counts.warning + counts.info)
  const excludedCount = $derived(result.excluded.length)

  const SEVERITY_OPTIONS = [
    { label: 'Error', value: 'error' },
    { label: 'Warning', value: 'warning' },
    { label: 'Info', value: 'info' },
  ]

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
</script>

<div class="rules">
  <div class="actions">
    <button class="run" onclick={() => onRun?.()} disabled={drc.running}>
      {drc.running ? 'Checking…' : 'Run checks'}
    </button>
    <button
      class="settings"
      class:on={settingsOpen}
      aria-pressed={settingsOpen}
      aria-label="Rule settings"
      title="Rule settings"
      onclick={() => (settingsOpen = !settingsOpen)}
    >
      <Settings2 size={16} strokeWidth={1.7} />
    </button>
  </div>

  {#if drc.hasRun}
    <div class="summary" aria-label="Violation counts">
      <span class="count" style="color:var(--ruby-600)">
        <span class="dot" style="background:var(--ruby-600)"></span>{counts.error}
      </span>
      <span class="count" style="color:var(--amber-600)">
        <span class="dot" style="background:var(--amber-600)"></span>{counts.warning}
      </span>
      <span class="count" style="color:var(--cobalt-600)">
        <span class="dot" style="background:var(--cobalt-600)"></span>{counts.info}
      </span>
      <span class="total">{total} total</span>
    </div>
  {/if}

  {#if settingsOpen}
    <div class="settings-list">
      {#each RULES as rule (rule.id)}
        {@const ov = overrideFor(rule.id)}
        <div class="setting">
          <Checkbox
            label={rule.title}
            checked={ov?.enabled !== false}
            onchange={(enabled) =>
              drc.setRuleOverride(
                rule.id,
                enabled && (ov?.severity ?? undefined) === undefined
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
            <span class="dot" style="background:{severityVar(v.severity)}"></span>
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
  {:else}
    <div class="list" aria-label="Violations">
      {#each result.violations as v (v.key)}
        {@const selected = drc.selectedKey === v.key}
        <div class="row" class:selected>
          <button class="head" onclick={() => selectRow(v)}>
            <span class="dot" style="background:{severityVar(v.severity)}"></span>
            <span class="body">
              <span class="title">{v.title}</span>
              <span class="msg">{v.message}</span>
            </span>
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

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 12px 14px 10px;
  }

  .run {
    background: var(--ink-950);
    color: var(--paper-0);
    border: none;
    border-radius: var(--radius-full);
    padding: 6px 11px;
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .run:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .settings {
    margin-left: auto;
    width: 28px;
    height: 28px;
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

  .summary {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 14px 10px;
    font: 500 11.5px/1 var(--font-mono);
  }

  .count {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .total {
    margin-left: auto;
    color: var(--ink-500);
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

  .head .dot {
    margin-top: 5px;
  }

  .head .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 9px 14px;
    border-bottom: 1px solid var(--paper-100);
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
    justify-content: space-between;
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
    cursor: pointer;
  }
</style>
