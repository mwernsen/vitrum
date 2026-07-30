<script lang="ts">
  import ChevronDown from 'lucide-svelte/icons/chevron-down'

  import type { DockSection } from './dock'

  interface Props {
    /** Detected pieces (F-020). Geometry is "complete" once at least one piece closes. */
    pieceCount?: number
    /** Pieces with no glass assigned (F-023). */
    unassignedCount?: number
    /** Whether the DRC engine has run at least once (F-030). */
    checksRun?: boolean
    /** Active error-severity violations (F-030). */
    errorCount?: number
    /** Active warning-severity violations (F-030). */
    warningCount?: number
    /** Active info-severity violations (F-030). */
    infoCount?: number
    /** Pieces with no number yet (F-040). */
    unnumberedCount?: number
    /** Jump to the dock section that clears a step. Absent ⇒ rows are inert. */
    onGoTo?: (section: DockSection) => void
  }

  let {
    pieceCount = 0,
    unassignedCount = 0,
    checksRun = false,
    errorCount = 0,
    warningCount = 0,
    infoCount = 0,
    unnumberedCount = 0,
    onGoTo,
  }: Props = $props()

  let open = $state(false)

  const issueCount = $derived(errorCount + warningCount + infoCount)
  const painted = $derived(Math.max(0, pieceCount - unassignedCount))
  const numbered = $derived(Math.max(0, pieceCount - unnumberedCount))

  /**
   * The four things that have to be true before glass can be cut, in the order a maker meets them.
   * They are independent — the copy says so — so the meter counts them rather than sequencing them.
   */
  const rows = $derived([
    {
      title: 'Geometry closes',
      meta: pieceCount === 0 ? 'no closed pieces yet' : `${pieceCount} pieces detected`,
      done: pieceCount > 0,
      action: 'View',
      section: 'draw' as DockSection,
    },
    {
      title: 'Every piece has glass',
      meta: pieceCount === 0 ? '—' : `${painted} of ${pieceCount} painted`,
      done: pieceCount > 0 && unassignedCount === 0,
      action: unassignedCount > 0 ? 'Paint' : 'View',
      section: 'glass' as DockSection,
    },
    {
      title: 'Checks are clear',
      meta: !checksRun
        ? 'not run yet'
        : issueCount === 0
          ? 'clear'
          : `${errorCount} errors · ${warningCount} warnings`,
      done: checksRun && issueCount === 0,
      action: issueCount > 0 ? 'Fix' : 'View',
      section: 'check' as DockSection,
    },
    {
      title: 'Pieces are numbered',
      meta: pieceCount === 0 ? '—' : `${numbered} of ${pieceCount} numbered`,
      done: pieceCount > 0 && unnumberedCount === 0,
      action: unnumberedCount > 0 ? 'Number' : 'View',
      section: 'make' as DockSection,
    },
  ])

  const doneCount = $derived(rows.filter((r) => r.done).length)

  function pick(section: DockSection): void {
    open = false
    onGoTo?.(section)
  }

  function onWindowKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) open = false
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="meter">
  <button
    type="button"
    class="trigger"
    aria-haspopup="dialog"
    aria-expanded={open}
    data-testid="readiness-meter"
    onclick={() => (open = !open)}
  >
    <span class="segs" aria-hidden="true">
      {#each rows as row (row.title)}
        <span class="seg" class:done={row.done}></span>
      {/each}
    </span>
    <span class="label">Ready to cut</span>
    <span class="ratio">{doneCount} / {rows.length}</span>
    <ChevronDown size={13} />
  </button>

  {#if open}
    <!-- Click-away backdrop so the popover dismisses without trapping focus. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (open = false)}></div>
    <div class="popover" role="dialog" aria-label="Ready to cut">
      <div class="pop-head">
        <span class="eyebrow">Ready to cut</span>
        <span class="hint">tackle in any order</span>
      </div>
      {#each rows as row (row.title)}
        <button type="button" class="row" onclick={() => pick(row.section)}>
          <span class="dot" class:done={row.done}></span>
          <span class="text">
            <span class="title">{row.title}</span>
            <span class="meta">{row.meta}</span>
          </span>
          <span class="action">{row.action}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .meter {
    position: relative;
    display: inline-flex;
    flex: none;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    flex: none;
    white-space: nowrap;
    padding: 5px 9px 5px 11px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-500);
    cursor: pointer;
  }

  .trigger:hover {
    border-color: var(--border-strong);
  }

  .segs {
    display: inline-flex;
    gap: 2px;
  }

  .seg {
    width: 13px;
    height: 5px;
    border-radius: 2px;
    background: var(--paper-300);
  }

  .seg.done {
    background: var(--emerald-600);
  }

  .label {
    font: 600 12px/1 var(--font-sans);
    color: var(--ink-800);
    white-space: nowrap;
  }

  .ratio {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .popover {
    position: absolute;
    right: 0;
    top: calc(100% + var(--space-2));
    z-index: 50;
    width: 308px;
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }

  .pop-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 11px 14px 9px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .hint {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    border: none;
    border-bottom: 1px solid var(--paper-100);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .row:last-child {
    border-bottom: none;
  }

  .row:hover {
    background: var(--paper-50);
  }

  .dot {
    width: 9px;
    height: 9px;
    flex: none;
    border-radius: var(--radius-full);
    background: var(--amber-600);
  }

  .dot.done {
    background: var(--emerald-600);
  }

  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .title {
    font: 600 12.5px/1.3 var(--font-sans);
    color: var(--ink-900);
  }

  .meta {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .action {
    font: 600 11.5px/1 var(--font-sans);
    color: var(--link);
  }
</style>
