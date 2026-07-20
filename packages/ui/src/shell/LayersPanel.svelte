<script lang="ts">
  import type { Command, Project } from '@vitrum/model'
  import Eye from 'lucide-svelte/icons/eye'
  import EyeOff from 'lucide-svelte/icons/eye-off'

  import type { ViewportController } from '../canvas/viewport.svelte'

  import TechniquePanel from './TechniquePanel.svelte'

  interface Props {
    viewport: ViewportController
    /** Document, for the global technique control (F-021). */
    doc?: Project
    /** Command sink for technique edits. */
    execute?: (command: Command) => void
  }

  let { viewport, doc, execute }: Props = $props()

  // Overlay visibility — the toggles that used to be scattered across the status bar now live here
  // (Portal turn-3 IA: the Layers panel owns overlays). Each maps to a live viewport flag.
  const overlays = $derived([
    {
      label: 'Glass',
      hint: 'painted piece fills',
      on: viewport.glassVisible,
      toggle: () => viewport.toggleGlass(),
    },
    {
      label: 'Pieces',
      hint: 'detected-region overlay',
      on: viewport.piecesVisible,
      toggle: () => viewport.togglePieces(),
    },
    {
      label: 'Cut contours',
      hint: 'technique inset',
      on: viewport.cutsVisible,
      toggle: () => viewport.toggleCuts(),
    },
    {
      label: 'Numbers',
      hint: 'piece numbers overlay',
      on: viewport.numbersVisible,
      toggle: () => viewport.toggleNumbers(),
    },
    {
      label: 'Construction guides',
      hint: 'snapping guides',
      on: viewport.guidesVisible,
      toggle: () => viewport.toggleGuides(),
    },
  ])
</script>

<div class="layers">
  <div class="rows">
    {#each overlays as layer (layer.label)}
      <button
        class="row"
        class:off={!layer.on}
        onclick={layer.toggle}
        aria-pressed={layer.on}
        aria-label={`${layer.label} ${layer.on ? 'shown' : 'hidden'}. Click to toggle.`}
      >
        <span class="ic">
          {#if layer.on}<Eye size={16} strokeWidth={1.7} />{:else}<EyeOff
              size={16}
              strokeWidth={1.7}
            />{/if}
        </span>
        <span class="text">
          <span class="name">{layer.label}</span>
          <span class="hint">{layer.hint}</span>
        </span>
      </button>
    {/each}

    <!-- Reference photo — arrives with the underlay feature (F-051) -->
    <div class="row placeholder" aria-disabled="true">
      <span class="ic"><EyeOff size={16} strokeWidth={1.7} /></span>
      <span class="text">
        <span class="name">Reference photo</span>
        <span class="hint">underlay · F-051</span>
      </span>
    </div>
  </div>

  <!-- Symmetry — arrives with live symmetry (F-052) -->
  <div class="section">
    <span class="eyebrow">Symmetry</span>
    <div class="sym placeholder" aria-disabled="true">
      <span>Vertical axis mirror</span>
      <span class="track"><span class="knob"></span></span>
    </div>
    <span class="feature">Coming with F-052</span>
  </div>

  {#if doc && execute}
    <div class="section">
      <TechniquePanel technique={doc.technique} {execute} />
    </div>
  {/if}
</div>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .rows {
    display: flex;
    flex-direction: column;
    margin: calc(-1 * var(--space-4));
    margin-bottom: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 9px 14px;
    border: none;
    border-bottom: 1px solid var(--paper-100);
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: var(--ink-800);
  }

  .row:hover:not(.placeholder) {
    background: var(--paper-50);
  }

  .row.off .name,
  .row.placeholder .name {
    color: var(--ink-500);
  }

  .row.placeholder {
    cursor: default;
    opacity: 0.7;
  }

  .ic {
    display: inline-flex;
    color: var(--ink-800);
  }

  .row.off .ic,
  .row.placeholder .ic {
    color: var(--paper-400);
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font: 600 13px/1.2 var(--font-sans);
    color: var(--ink-900);
  }

  .hint {
    font: var(--text-caption);
    color: var(--ink-500);
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

  .sym {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font: 500 12.5px/1 var(--font-sans);
    color: var(--ink-800);
  }

  .track {
    width: 34px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--paper-300);
    position: relative;
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--paper-0);
    box-shadow: var(--shadow-xs);
  }

  .feature {
    font: var(--text-caption);
    color: var(--ink-500);
  }
</style>
