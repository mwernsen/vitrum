<script lang="ts">
  import type { Snippet } from 'svelte'

  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { ReferenceController } from '../reference/controller.svelte'
  import type { ToolController } from '../tools/controller.svelte'
  import type { PaintController } from '../tools/paint.svelte'
  import type { ReinforcementController } from '../tools/reinforcement.svelte'
  import type { SnapController } from '../tools/snap.svelte'
  import type { SymmetryController } from '../tools/symmetry.svelte'

  import { DOCK_SECTIONS, type DockSection } from './dock'
  import DrawPanel from './DrawPanel.svelte'

  interface Props {
    /** The open section, chosen from the activity rail (the sole switcher — no tabs here). */
    section: DockSection
    /** A mono one-liner for the section header: the count that section is about. */
    meta?: string
    viewport: ViewportController
    /** Drawing tools (F-011), for the Draw section's palette. */
    tools?: ToolController
    /** Paint / piece-select (F-023). */
    paint?: PaintController
    /** Reinforcement bars (F-032). */
    reinforce?: ReinforcementController
    /** Snapping (F-012). */
    snap?: SnapController
    /** Reversible "clear all guides" command (F-012). */
    onClearGuides?: () => void
    /** Live symmetry (F-052). */
    symmetry?: SymmetryController
    /** The reference-image underlay (F-051). */
    reference?: ReferenceController
    /** Trigger the host's image picker to add a reference layer (F-051). */
    onAddReference?: () => void
    /** False in the read-only views — the Draw section hides its editing aids. */
    editable?: boolean
    /** Return to the design view from a read-only one. */
    onEnterDesign?: () => void
    /** Live glass content (F-022/F-023). */
    glass?: Snippet
    /** Live design-rule content (F-030/F-031). */
    check?: Snippet
    /** Live manufacturing content (F-040 numbering + bench-output links). */
    make?: Snippet
    /** Live cost / quote content (F-056). */
    cost?: Snippet
    /** Live version-history content (F-055). */
    history?: Snippet
  }

  let {
    section,
    meta = '',
    viewport,
    tools,
    paint,
    reinforce,
    snap,
    onClearGuides,
    symmetry,
    reference,
    onAddReference,
    editable = true,
    onEnterDesign,
    glass,
    check,
    make,
    cost,
    history,
  }: Props = $props()

  const current = $derived(DOCK_SECTIONS.find((s) => s.id === section) ?? DOCK_SECTIONS[0]!)

  // Draw sets its own 14px gutters and Check owns a sticky footer plus an inner scroller, so the
  // dock hands both of them the bare box. Everything else gets the standard dock padding.
  const bleed = $derived(section === 'draw' || section === 'check')
</script>

<aside class="dock" aria-label="Panel dock">
  <div class="header">
    <span class="title">{current.label}</span>
    <span class="spacer"></span>
    {#if meta}<span class="meta">{meta}</span>{/if}
  </div>

  <div
    class="body"
    class:bleed
    class:own-scroll={section === 'check'}
    class:fill={section === 'glass'}
  >
    {#if section === 'draw'}
      <DrawPanel
        {viewport}
        {tools}
        {paint}
        {reinforce}
        {snap}
        {onClearGuides}
        {symmetry}
        {reference}
        {onAddReference}
        {editable}
        {onEnterDesign}
      />
    {:else if section === 'glass'}
      {@render glass?.()}
    {:else if section === 'check'}
      {@render check?.()}
    {:else if section === 'make'}
      {@render make?.()}
    {:else if section === 'cost'}
      {@render cost?.()}
    {:else if section === 'history'}
      {@render history?.()}
    {/if}
  </div>
</aside>

<style>
  .dock {
    grid-area: dock;
    width: 296px;
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
    gap: var(--space-2);
    flex: none;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .title {
    font: var(--text-h4);
    color: var(--text-strong);
  }

  .spacer {
    flex: 1;
  }

  /* The count this section is about, right-aligned so the eye finds it in the same place. */
  .meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
  }

  .body.bleed {
    padding: 0;
  }

  /* Check owns an inner scroller and a pinned footer, so the dock must not scroll around it. */
  .body.own-scroll {
    overflow-y: hidden;
    display: flex;
    flex-direction: column;
  }

  /* Glass fills the panel: its list is the scroller, so it reaches the bottom edge instead of
     stopping at a fixed height. The body keeps `overflow-y: auto` from `.body`, so a window too
     short even for the list's minimum scrolls here rather than clipping. */
  .body.fill {
    display: flex;
    flex-direction: column;
  }
</style>
