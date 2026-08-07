<script lang="ts">
  import { SNAP_KINDS, formatLength, type SnapKind } from '@vitrum/core'
  import type { SymmetryMode } from '@vitrum/model'
  import ChevronDown from 'lucide-svelte/icons/chevron-down'
  import ChevronUp from 'lucide-svelte/icons/chevron-up'
  import Eye from 'lucide-svelte/icons/eye'
  import EyeOff from 'lucide-svelte/icons/eye-off'
  import ImagePlus from 'lucide-svelte/icons/image-plus'
  import Lock from 'lucide-svelte/icons/lock'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import Unlock from 'lucide-svelte/icons/unlock'

  import type { ViewportController } from '../canvas/viewport.svelte'
  import Switch from '../components/Switch.svelte'
  import type { ReferenceController } from '../reference/controller.svelte'
  import type { ToolController } from '../tools/controller.svelte'
  import type { PaintController } from '../tools/paint.svelte'
  import type { ReinforcementController } from '../tools/reinforcement.svelte'
  import type { SnapController } from '../tools/snap.svelte'
  import type { SymmetryController } from '../tools/symmetry.svelte'

  import { TOOL_ITEMS, activeTool, type ToolItem } from './tools'

  interface Props {
    viewport: ViewportController
    /** The drawing-tool controller (F-011). Absent ⇒ the grid renders inert. */
    tools?: ToolController
    /** The paint / piece-select controller (F-023). */
    paint?: PaintController
    /** The reinforcement-bar controller (F-032). */
    reinforce?: ReinforcementController
    /** The snapping controller (F-012). Absent ⇒ the snapping section is hidden. */
    snap?: SnapController
    /** Reversible "clear all guides" command (F-012). */
    onClearGuides?: () => void
    /** The live-symmetry controller (F-052). Absent ⇒ the section stays a placeholder. */
    symmetry?: SymmetryController
    /** The reference-image underlay controller (F-051). Absent ⇒ the section stays a placeholder. */
    reference?: ReferenceController
    /** Trigger the host's image picker to add a reference layer (F-051). */
    onAddReference?: () => void
    /**
     * False in the read-only views (cartoon, light, nest). Drawing aids are hidden rather than
     * offered-but-inert, so nobody picks a tool and wonders why the stage will not take a click.
     */
    editable?: boolean
    /** Return to the design view, offered when the active view is read-only. */
    onEnterDesign?: () => void
  }

  let {
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
  }: Props = $props()

  // --- Tools (F-011/013/023/032) ---------------------------------------------
  const active = $derived(
    activeTool({ toolId: tools?.activeId, paintMode: paint?.mode, barMode: reinforce?.mode }),
  )

  // Paint/bar entries only appear when their controller is wired (isolation renders drop them).
  const visibleTools = $derived(
    TOOL_ITEMS.filter(
      (t) =>
        t.kind === 'draw' ||
        ((t.kind === 'paint' || t.kind === 'pieces') && !!paint) ||
        (t.kind === 'bar' && !!reinforce),
    ),
  )

  function pick(tool: ToolItem): void {
    if (tool.kind === 'draw') {
      paint?.setMode('off')
      reinforce?.setMode('off')
      if (tool.id === 'select') tools?.deactivate()
      else tools?.activate(tool.id)
      return
    }
    if (tool.kind === 'bar') {
      tools?.deactivate()
      paint?.setMode('off')
      reinforce?.setMode(reinforce.mode === 'draw' ? 'off' : 'draw')
      return
    }
    const mode = tool.kind === 'paint' ? 'paint' : 'select'
    tools?.deactivate()
    reinforce?.setMode('off')
    paint?.setMode(paint.mode === mode ? 'off' : mode)
  }

  // --- Snapping (F-012) ------------------------------------------------------
  const KIND_LABELS: Record<SnapKind, string> = {
    endpoint: 'Endpoint',
    intersection: 'Intersection',
    midpoint: 'Midpoint',
    'on-curve': 'On curve',
    grid: 'Grid',
    angle: 'Angle',
  }

  // The spacing the canvas grid is drawing at right now. It is derived from zoom, so this is a
  // readout rather than a setting — but it is the question the "Grid" chip above raises, so it
  // belongs here rather than nowhere.
  const gridSpacing = $derived(formatLength(viewport.grid.minor, viewport.unit))

  // --- Symmetry (F-052) ------------------------------------------------------
  const SYMMETRY_MODES: { mode: SymmetryMode; glyph: string; title: string }[] = [
    { mode: 'none', glyph: '—', title: 'None' },
    { mode: 'mirror', glyph: '◧', title: 'Mirror (1 axis)' },
    { mode: 'double-mirror', glyph: '⊞', title: 'Double mirror (2 axes)' },
    { mode: 'radial', glyph: '✳', title: 'Radial (N-fold)' },
  ]

  const symMeta = $derived.by(() => {
    if (!symmetry?.active) return 'off'
    if (symmetry.setup.mode === 'radial') return `${symmetry.count}-fold`
    return symmetry.setup.mode === 'double-mirror' ? '2 axes' : '1 axis'
  })

  // --- Tracing (F-051) ------------------------------------------------------
  // Top of the stack first (later layers draw on top).
  const referenceLayers = $derived(reference ? [...reference.layers].reverse() : [])
  // The opacity slider acts on the selected layer, falling back to the topmost one so there is
  // always something to drag once an image exists.
  const opacityTarget = $derived(reference?.selected ?? reference?.layers.at(-1) ?? null)
</script>

<div class="draw">
  {#if !editable}
    <section class="block">
      <span class="eyebrow">Tools</span>
      <span class="hint">
        This view is a read-only reading of the panel. Drawing happens in the design view.
      </span>
      {#if onEnterDesign}
        <button class="ghost" onclick={onEnterDesign}>Back to the design view</button>
      {/if}
    </section>
  {:else}
    <!-- ── Tools ── -->
    <section class="block">
      <span class="eyebrow">Tools</span>
      <div class="tool-grid" role="toolbar" aria-label="Tools">
        {#each visibleTools as tool (tool.kind + tool.label)}
          {@const Icon = tool.icon}
          {@const isActive = active === tool}
          {@const name = tool.key ? `${tool.label} (${tool.key})` : tool.label}
          <button
            class="tool"
            class:active={isActive}
            aria-pressed={isActive}
            aria-label={name}
            title={name}
            onclick={() => pick(tool)}
          >
            <Icon size={17} strokeWidth={1.7} />
            {#if tool.key}<span class="key" aria-hidden="true">{tool.key}</span>{/if}
          </button>
        {/each}
      </div>
      <span class="hint" data-testid="tool-hint">{active.hint}</span>
    </section>

    <!-- ── Snapping ── -->
    {#if snap}
      <section class="block ruled">
        <div class="block-head">
          <span class="eyebrow">Snapping</span>
          <Switch label="Snapping" checked={snap.master} onchange={() => snap.toggleMaster()} />
        </div>
        <div class="chips">
          {#each SNAP_KINDS as kind (kind)}
            <button
              class="chip"
              class:on={snap.master && snap.toggles[kind]}
              disabled={!snap.master}
              aria-pressed={snap.toggles[kind]}
              onclick={() => snap.toggle(kind)}
            >
              {KIND_LABELS[kind]}
            </button>
          {/each}
        </div>
        <div class="readout">
          <span class="row-label">Grid spacing</span>
          <span class="value" data-testid="grid-spacing">{gridSpacing}</span>
        </div>
        <div class="block-head">
          <Switch
            label="Show guides"
            checked={viewport.guidesVisible}
            onchange={() => viewport.toggleGuides()}
          />
          {#if onClearGuides}
            <button class="link" onclick={() => onClearGuides?.()}>Clear all guides</button>
          {/if}
        </div>
      </section>
    {/if}

    <!-- ── Symmetry ── -->
    <section class="block ruled">
      <div class="block-head">
        <span class="eyebrow">Symmetry</span>
        <span class="meta">{symMeta}</span>
      </div>
      {#if symmetry}
        <div class="mode-grid" role="group" aria-label="Symmetry mode">
          {#each SYMMETRY_MODES as m (m.mode)}
            <button
              class="mode"
              class:active={symmetry.setup.mode === m.mode}
              aria-pressed={symmetry.setup.mode === m.mode}
              aria-label={m.title}
              title={m.title}
              onclick={() => symmetry.setMode(m.mode)}
            >
              <span aria-hidden="true">{m.glyph}</span>
            </button>
          {/each}
        </div>

        {#if symmetry.active}
          <div class="sunken">
            <label class="readout">
              <span class="row-label">Axis angle</span>
              <span class="field">
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
            {#if symmetry.setup.mode === 'radial'}
              <label class="readout">
                <span class="row-label">Fold count</span>
                <span class="field">
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
            <button class="ghost" onclick={() => symmetry.bake()}>Bake symmetry</button>
          </div>
        {/if}
        <span class="hint">Draw one sector and mirror it live across the panel.</span>
      {:else}
        <span class="hint">Coming with F-052</span>
      {/if}
    </section>

    <!-- ── Tracing ── -->
    <section class="block ruled">
      <div class="block-head">
        <span class="eyebrow">Tracing</span>
        {#if reference && onAddReference}
          <button class="add" onclick={onAddReference} disabled={reference.busy}>
            <ImagePlus size={13} strokeWidth={1.7} />
            <span>Add image</span>
          </button>
        {/if}
      </div>

      {#if !reference}
        <span class="hint">Reference underlay · F-051</span>
      {:else}
        {#if reference.error}
          <span class="error" role="alert">{reference.error}</span>
        {/if}
        {#if referenceLayers.length === 0}
          <span class="hint">No reference images. Add a photo or scan to trace over.</span>
        {:else}
          <div class="ref-rows">
            {#each referenceLayers as layer (layer.id)}
              <div class="ref-row" class:selected={reference.selectedId === layer.id}>
                <button
                  class="ref-name"
                  onclick={() => reference.select(layer.id)}
                  title={layer.name}
                >
                  <span class="thumb" aria-hidden="true"></span>
                  <span class="ref-text">
                    <span class="name">{layer.name}</span>
                    <span class="meta">
                      {Math.round(layer.opacity * 100)}%{layer.rectified
                        ? ' · rectified'
                        : ''}{layer.calibrated ? ' · calibrated' : ''}
                    </span>
                  </span>
                </button>
                <button
                  class="icon-btn"
                  aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                  aria-pressed={layer.visible}
                  onclick={() => reference.toggleVisible(layer.id)}
                >
                  {#if layer.visible}<Eye size={14} strokeWidth={1.7} />{:else}<EyeOff
                      size={14}
                      strokeWidth={1.7}
                    />{/if}
                </button>
                <button
                  class="icon-btn"
                  aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
                  aria-pressed={layer.locked}
                  onclick={() => reference.toggleLock(layer.id)}
                >
                  {#if layer.locked}<Lock size={14} strokeWidth={1.7} />{:else}<Unlock
                      size={14}
                      strokeWidth={1.7}
                    />{/if}
                </button>
                <button
                  class="icon-btn"
                  aria-label="Move layer up"
                  onclick={() => reference.reorder(layer.id, 'up')}
                >
                  <ChevronUp size={14} strokeWidth={1.7} />
                </button>
                <button
                  class="icon-btn"
                  aria-label="Move layer down"
                  onclick={() => reference.reorder(layer.id, 'down')}
                >
                  <ChevronDown size={14} strokeWidth={1.7} />
                </button>
                <button
                  class="icon-btn danger"
                  aria-label="Remove layer"
                  onclick={() => reference.remove(layer.id)}
                >
                  <Trash2 size={14} strokeWidth={1.7} />
                </button>
              </div>
            {/each}
          </div>

          {#if opacityTarget}
            {@const target = opacityTarget}
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(target.opacity * 100)}
              aria-label="Reference opacity"
              oninput={(e) => reference.setOpacity(target.id, e.currentTarget.valueAsNumber / 100)}
            />
          {/if}
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .draw {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 14px;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .block.ruled {
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
  }

  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
  }

  .hint {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .error {
    font: var(--text-caption);
    color: var(--ruby-600);
  }

  /* One 4-column grid reads as a single palette, and fits the whole tool set without scrolling. */
  .tool-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }

  .tool {
    position: relative;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--paper-50);
    color: var(--ink-700);
    cursor: pointer;
  }

  .tool:hover:not(.active) {
    background: var(--paper-100);
    color: var(--ink-900);
  }

  .tool.active {
    border-color: var(--ink-950);
    background: var(--ink-950);
    color: var(--paper-0);
  }

  .key {
    position: absolute;
    right: 3px;
    bottom: 2px;
    font: 600 8.5px/1 var(--font-mono);
    opacity: 0.55;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .chip {
    padding: 4px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-700);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .chip.on {
    border-color: var(--ink-950);
    background: var(--ink-950);
    color: var(--paper-0);
  }

  .chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .readout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .row-label {
    font: 500 12.5px/1 var(--font-sans);
    color: var(--ink-800);
  }

  .value {
    padding: 5px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--paper-50);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-strong);
  }

  .field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .field input {
    width: 68px;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    color: var(--ink-900);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: right;
  }

  .field .unit {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .mode-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }

  .mode {
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    color: var(--ink-700);
    font-size: 15px;
    cursor: pointer;
  }

  .mode:hover:not(.active) {
    background: var(--paper-50);
  }

  .mode.active {
    border-color: var(--ink-950);
    background: var(--ink-950);
    color: var(--paper-0);
  }

  .sunken {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: var(--paper-50);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .ghost {
    align-self: flex-start;
    padding: 5px 11px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-800);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .ghost:hover {
    background: var(--paper-100);
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--link);
    font: var(--text-caption);
    cursor: pointer;
    white-space: nowrap;
  }

  .link:hover {
    color: var(--link-hover);
    text-decoration: underline;
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

  .ref-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ref-row {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 5px 6px;
    border: 1px solid var(--cobalt-100);
    background: var(--cobalt-50);
    border-radius: var(--radius-sm);
  }

  .ref-row.selected {
    border-color: var(--cobalt-500);
  }

  .ref-name {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .thumb {
    width: 26px;
    height: 26px;
    flex: none;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    background: repeating-linear-gradient(45deg, var(--paper-200) 0 6px, var(--paper-100) 6px 12px);
  }

  .ref-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .ref-text .name {
    font: 600 12.5px/1.2 var(--font-sans);
    color: var(--ink-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex: none;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-600);
    border-radius: var(--radius-xs);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--paper-0);
    color: var(--ink-900);
  }

  .icon-btn.danger:hover {
    color: var(--ruby-600);
  }

  input[type='range'] {
    width: 100%;
    accent-color: var(--cobalt-500);
  }
</style>
