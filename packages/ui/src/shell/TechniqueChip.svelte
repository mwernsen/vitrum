<script lang="ts">
  import { formatFractionalInch } from '@vitrum/core'
  import type { Command, Project } from '@vitrum/model'
  import ChevronDown from 'lucide-svelte/icons/chevron-down'

  import TechniquePanel from './TechniquePanel.svelte'

  interface Props {
    /** The document, for the technique in force (F-021). Absent ⇒ the chip is inert. */
    doc?: Project
    /** Command sink for technique edits. Absent ⇒ the chip reads out but does not open. */
    execute?: (command: Command) => void
  }

  let { doc, execute }: Props = $props()

  let open = $state(false)

  const technique = $derived(doc?.technique)
  const lead = $derived(
    technique?.kind === 'lead'
      ? (technique.lead.profiles[technique.lead.defaultProfileId] ?? null)
      : null,
  )

  const label = $derived(technique?.kind === 'foil' ? 'Copper foil' : 'Lead came')
  // The one number a maker needs at a glance: the came flange the lines are drawn at, or the
  // foil width the seams are sized from.
  const detail = $derived.by(() => {
    if (!technique) return ''
    if (technique.kind === 'foil') return formatFractionalInch(technique.foil.foilWidthMm)
    return lead ? `${lead.kind} ${lead.flangeMm} mm` : '—'
  })

  const interactive = $derived(!!doc && !!execute)

  function onWindowKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) open = false
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="chip-wrap">
  <button
    type="button"
    class="chip"
    class:inert={!interactive}
    disabled={!interactive}
    aria-haspopup={interactive ? 'dialog' : undefined}
    aria-expanded={interactive ? open : undefined}
    aria-label={`Technique: ${label} ${detail}. Click to change.`}
    onclick={() => (open = !open)}
  >
    <!-- The came cross-section, drawn from the technique, not decoration: an H profile reads as two
         flanges either side of a heart; foil reads as a single solder line. -->
    {#if technique?.kind === 'foil'}
      <span class="swatch foil" aria-hidden="true"></span>
    {:else}
      <span class="swatch lead" aria-hidden="true"></span>
    {/if}
    <span class="name">{label}</span>
    <span class="detail">{detail}</span>
    {#if interactive}<ChevronDown size={12} />{/if}
  </button>

  {#if open && doc && execute}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (open = false)}></div>
    <div class="popover" role="dialog" aria-label="Technique">
      <TechniquePanel technique={doc.technique} {execute} />
    </div>
  {/if}
</div>

<style>
  .chip-wrap {
    position: relative;
    display: inline-flex;
    flex: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-500);
    cursor: pointer;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  .chip.inert {
    cursor: default;
  }

  .swatch {
    width: 14px;
    height: 8px;
    flex: none;
    border-radius: 2px;
  }

  .swatch.lead {
    background: linear-gradient(
      180deg,
      var(--paper-400) 0 34%,
      var(--ink-600) 34% 66%,
      var(--paper-400) 66%
    );
  }

  .swatch.foil {
    background: var(--ink-600);
    height: 3px;
    border-radius: var(--radius-full);
  }

  .name {
    font: 600 12px/1 var(--font-sans);
    color: var(--ink-800);
    white-space: nowrap;
  }

  .detail {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
    white-space: nowrap;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .popover {
    position: absolute;
    left: 0;
    top: calc(100% + var(--space-2));
    z-index: 50;
    width: 288px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 0 var(--space-4) var(--space-4);
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
  }
</style>
