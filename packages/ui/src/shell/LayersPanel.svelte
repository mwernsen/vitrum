<script lang="ts">
  import type { Command, Project, SymmetryMode } from '@vitrum/model'
  import ChevronDown from 'lucide-svelte/icons/chevron-down'
  import ChevronUp from 'lucide-svelte/icons/chevron-up'
  import Eye from 'lucide-svelte/icons/eye'
  import EyeOff from 'lucide-svelte/icons/eye-off'
  import ImagePlus from 'lucide-svelte/icons/image-plus'
  import Lock from 'lucide-svelte/icons/lock'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import Unlock from 'lucide-svelte/icons/unlock'

  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { ReferenceController } from '../reference/controller.svelte'
  import type { SymmetryController } from '../tools/symmetry.svelte'

  import Button from '../components/Button.svelte'
  import Select from '../components/Select.svelte'
  import Switch from '../components/Switch.svelte'

  import TechniquePanel from './TechniquePanel.svelte'

  interface Props {
    viewport: ViewportController
    /** Document, for the global technique control (F-021). */
    doc?: Project
    /** Command sink for technique edits. */
    execute?: (command: Command) => void
    /** The reference-image underlay controller (F-051). Absent ⇒ the section stays a placeholder. */
    reference?: ReferenceController
    /** Trigger the host's image picker to add a reference layer (F-051). Absent ⇒ no add button. */
    onAddReference?: () => void
    /** The live-symmetry controller (F-052). Absent ⇒ the symmetry section stays a placeholder. */
    symmetry?: SymmetryController
  }

  let { viewport, doc, execute, reference, onAddReference, symmetry }: Props = $props()

  const SYMMETRY_MODES: { label: string; value: SymmetryMode }[] = [
    { label: 'None', value: 'none' },
    { label: 'Mirror (1 axis)', value: 'mirror' },
    { label: 'Double mirror (2 axes)', value: 'double-mirror' },
    { label: 'Radial (N-fold)', value: 'radial' },
  ]

  // Top of the stack first (later layers draw on top).
  const referenceLayers = $derived(reference ? [...reference.layers].reverse() : [])

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

    {#if !reference}
      <!-- Reference photo — arrives with the underlay feature (F-051) -->
      <div class="row placeholder" aria-disabled="true">
        <span class="ic"><EyeOff size={16} strokeWidth={1.7} /></span>
        <span class="text">
          <span class="name">Reference photo</span>
          <span class="hint">underlay · F-051</span>
        </span>
      </div>
    {/if}
  </div>

  {#if reference}
    <div class="section">
      <div class="section-head">
        <span class="eyebrow">Reference images</span>
        {#if onAddReference}
          <button class="add" onclick={onAddReference} disabled={reference.busy}>
            <ImagePlus size={14} strokeWidth={1.7} />
            <span>Add image</span>
          </button>
        {/if}
      </div>

      {#if referenceLayers.length === 0}
        <span class="feature">No reference images. Add a photo or scan to trace over.</span>
      {/if}
      {#if reference.error}
        <span class="error" role="alert">{reference.error}</span>
      {/if}

      <div class="ref-rows">
        {#each referenceLayers as layer (layer.id)}
          <div class="ref-row" class:selected={reference.selectedId === layer.id}>
            <button
              class="icon-btn"
              aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
              aria-pressed={layer.visible}
              onclick={() => reference.toggleVisible(layer.id)}
            >
              {#if layer.visible}<Eye size={15} strokeWidth={1.7} />{:else}<EyeOff
                  size={15}
                  strokeWidth={1.7}
                />{/if}
            </button>
            <button class="ref-name" onclick={() => reference.select(layer.id)} title={layer.name}>
              <span class="name">{layer.name}</span>
              <span class="hint"
                >{Math.round(layer.opacity * 100)}%{layer.rectified ? ' · rectified' : ''}</span
              >
            </button>
            <div class="ref-actions">
              <button
                class="icon-btn"
                aria-label="Move layer up"
                onclick={() => reference.reorder(layer.id, 'up')}
              >
                <ChevronUp size={15} strokeWidth={1.7} />
              </button>
              <button
                class="icon-btn"
                aria-label="Move layer down"
                onclick={() => reference.reorder(layer.id, 'down')}
              >
                <ChevronDown size={15} strokeWidth={1.7} />
              </button>
              <button
                class="icon-btn"
                aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
                aria-pressed={layer.locked}
                onclick={() => reference.toggleLock(layer.id)}
              >
                {#if layer.locked}<Lock size={15} strokeWidth={1.7} />{:else}<Unlock
                    size={15}
                    strokeWidth={1.7}
                  />{/if}
              </button>
              <button
                class="icon-btn danger"
                aria-label="Remove layer"
                onclick={() => reference.remove(layer.id)}
              >
                <Trash2 size={15} strokeWidth={1.7} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Symmetry (F-052): live mirror / double-mirror / radial replication. -->
  <div class="section">
    <span class="eyebrow">Symmetry</span>
    {#if symmetry}
      <Select
        label="Mode"
        size="sm"
        options={SYMMETRY_MODES}
        value={symmetry.setup.mode}
        onchange={(v) => symmetry.setMode(v as SymmetryMode)}
      />

      {#if symmetry.active}
        <label class="num">
          <span class="num-label">Axis angle</span>
          <span class="num-field">
            <input
              type="number"
              step="1"
              value={Math.round(symmetry.angleDeg)}
              oninput={(e) => symmetry.setAngleDeg(Number(e.currentTarget.value))}
              aria-label="Symmetry axis angle in degrees"
            />
            <span class="unit">deg</span>
          </span>
        </label>
      {/if}

      {#if symmetry.setup.mode === 'radial'}
        <label class="num">
          <span class="num-label">Fold count</span>
          <span class="num-field">
            <input
              type="number"
              min="2"
              step="1"
              value={symmetry.count}
              oninput={(e) => symmetry.setCount(Number(e.currentTarget.value))}
              aria-label="Radial fold count"
            />
          </span>
        </label>
        <Switch
          label="Add mirror"
          checked={symmetry.setup.mirror}
          onchange={(on) => symmetry.setMirror(on)}
        />
      {/if}

      {#if symmetry.active}
        <div class="bake">
          <Button variant="secondary" size="sm" onclick={() => symmetry.bake()}>
            Bake symmetry
          </Button>
          <span class="feature">Materialises replicas as editable segments.</span>
        </div>
      {:else}
        <span class="feature">Draw one sector and mirror it live across the panel.</span>
      {/if}
    {:else}
      <div class="sym placeholder" aria-disabled="true">
        <span>Vertical axis mirror</span>
        <span class="track"><span class="knob"></span></span>
      </div>
      <span class="feature">Coming with F-052</span>
    {/if}
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

  .num {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .num-label {
    font: 500 12.5px/1 var(--font-sans);
    color: var(--ink-800);
  }

  .num-field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .num-field input {
    width: 68px;
    padding: 5px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    background: var(--paper-0);
    color: var(--ink-900);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: right;
  }

  .num-field .unit {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .bake {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .add {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    background: var(--paper-0);
    color: var(--ink-800);
    font: 500 12px/1 var(--font-sans);
    cursor: pointer;
  }
  .add:hover:not(:disabled) {
    background: var(--paper-50);
  }
  .add:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .error {
    font: var(--text-caption);
    color: var(--vitrail-ruby-600, var(--ink-700));
  }

  .ref-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ref-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-radius: var(--radius-xs);
  }
  .ref-row.selected {
    background: var(--cobalt-50, var(--paper-50));
    box-shadow: inset 0 0 0 1px var(--cobalt-300, var(--border-subtle));
  }

  .ref-name {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    padding: 0;
  }
  .ref-name .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 12.5px/1.2 var(--font-sans);
  }

  .ref-actions {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-700);
    border-radius: var(--radius-xs);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--paper-100);
    color: var(--ink-900);
  }
  .icon-btn.danger:hover {
    color: var(--vitrail-ruby-600, var(--ink-900));
  }
</style>
