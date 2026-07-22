<script lang="ts">
  import type { Command, Project } from '@vitrum/model'
  import type { Snippet } from 'svelte'

  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { ReferenceController } from '../reference/controller.svelte'
  import type { SymmetryController } from '../tools/symmetry.svelte'

  import { DOCK_SECTIONS, type DockSection } from './dock'
  import LayersPanel from './LayersPanel.svelte'

  interface Props {
    /** The open section, chosen from the activity rail (the sole switcher — no tabs here). */
    section: DockSection
    /** Viewport, for the Layers panel's overlay toggles. */
    viewport: ViewportController
    /** Document, for the Layers panel's global technique control (F-021). */
    doc?: Project
    /** Command sink for technique edits. */
    execute?: (command: Command) => void
    /** Live glass content (F-022/F-023), rendered when the glass section is open. */
    glass?: Snippet
    /** Live rules content (F-030), rendered when the rules section is open. */
    rules?: Snippet
    /** Live manufacturing content (F-040 numbering), rendered when the make section is open. */
    make?: Snippet
    /** Live cost / quote content (F-056), rendered when the cost section is open. */
    cost?: Snippet
    /** The reference-image underlay controller (F-051), for the Layers panel. */
    reference?: ReferenceController
    /** Trigger the host's image picker to add a reference layer (F-051). */
    onAddReference?: () => void
    /** The live-symmetry controller (F-052), for the Layers panel. */
    symmetry?: SymmetryController
    /** Whether the realistic render view (F-053) is active — reveals the backlight controls. */
    renderActive?: boolean
  }

  let {
    section,
    viewport,
    doc,
    execute,
    glass,
    rules,
    make,
    cost,
    reference,
    onAddReference,
    symmetry,
    renderActive = false,
  }: Props = $props()

  const current = $derived(DOCK_SECTIONS.find((s) => s.id === section) ?? DOCK_SECTIONS[0]!)

  // Placeholder section scaffolds — the as-designed structure of an unbuilt panel (turn 3
  // 3d/3e), shown disabled so the shell reads complete without faking data.
  const scaffolds: Record<string, { note: string; sections?: string[]; actions?: string[] }> = {
    versions: {
      note: 'Named snapshots and auto-saves you can restore or open as a copy.',
      actions: ['Save version…'],
    },
  }
  const scaffold = $derived(scaffolds[section])
</script>

<aside class="dock" aria-label="Panel dock">
  <div class="header">
    <span class="title">{current.label}</span>
  </div>

  <div class="body" class:flush={section === 'rules'}>
    {#if section === 'layers'}
      <LayersPanel
        {viewport}
        {doc}
        {execute}
        {reference}
        {onAddReference}
        {symmetry}
        {renderActive}
      />
    {:else if section === 'glass'}
      {@render glass?.()}
    {:else if section === 'rules'}
      {@render rules?.()}
    {:else if section === 'make'}
      {@render make?.()}
    {:else if section === 'cost'}
      {@render cost?.()}
    {:else if scaffold}
      <div class="placeholder">
        {#if scaffold.actions}
          <div class="actions">
            {#each scaffold.actions as action (action)}
              <button class="ghost" disabled>{action}</button>
            {/each}
          </div>
        {/if}
        {#if scaffold.sections}
          <div class="scaffold-sections">
            {#each scaffold.sections as label (label)}
              <div class="scaffold-row">
                <span class="eyebrow">{label}</span>
                <span class="dash">—</span>
              </div>
            {/each}
          </div>
        {/if}
        <p class="ph-note">{scaffold.note}</p>
        {#if current.feature}
          <span class="ph-feature">Coming with {current.feature}</span>
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style>
  .dock {
    grid-area: dock;
    width: 270px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--paper-0);
    border-right: 1px solid var(--border-subtle);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 13px 14px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .title {
    font: var(--text-h4);
    color: var(--text-strong);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
  }

  /* The rules panel manages its own full-bleed rows and sticky footer. */
  .body.flush {
    padding: 0;
    overflow-y: hidden;
    display: flex;
    flex-direction: column;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .ghost {
    padding: 6px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-700);
    font: 600 12px/1 var(--font-sans);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .scaffold-sections {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .scaffold-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--paper-100);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .dash {
    font-family: var(--font-mono);
    color: var(--paper-400);
  }

  .ph-note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .ph-feature {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--ink-500);
    padding: 4px 9px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
  }
</style>
