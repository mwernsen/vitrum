<script lang="ts">
  import type { Command, Project } from '@vitrum/model'
  import ArrowLeft from 'lucide-svelte/icons/arrow-left'
  import Download from 'lucide-svelte/icons/download'
  import FileUp from 'lucide-svelte/icons/file-up'
  import Redo2 from 'lucide-svelte/icons/redo-2'
  import Undo2 from 'lucide-svelte/icons/undo-2'

  import IconButton from '../components/IconButton.svelte'
  import Tooltip from '../components/Tooltip.svelte'
  import Logo from '../design/assets/Logo.svelte'
  import type { DocumentController } from '../document/controller.svelte'

  import type { DockSection } from './dock'
  import ReadinessMeter from './ReadinessMeter.svelte'
  import TechniqueChip from './TechniqueChip.svelte'
  import { VIEW_MODES, type ViewMode } from './viewmode'

  interface Props {
    title: string
    /** When present, undo/redo become live and the chip reflects save state (F-002). */
    controller?: DocumentController
    /** The document, for the technique chip (F-021). */
    doc?: Project
    /** Command sink for technique edits. */
    execute?: (command: Command) => void
    /** The active view mode. */
    viewMode?: ViewMode
    /** Switch the view mode. */
    onViewMode?: (mode: ViewMode) => void
    /** Open the export dialog (F-043). Absent ⇒ the button stays a "coming soon" placeholder. */
    onExport?: () => void
    /** Whether there is anything to export (pieces + a host export port). */
    exportEnabled?: boolean
    /** Open the SVG import dialog (F-050). Absent ⇒ the import button is hidden. */
    onImport?: () => void
    /** Leave the editor for the panel library (F-058 FR-5). Absent ⇒ the back button stays inert. */
    onLibrary?: () => void
    /** Jump to a dock section from the readiness meter. */
    onGoTo?: (section: DockSection) => void
    // --- Readiness inputs (F-020/023/030/040), collapsed into the one meter -------------------
    pieceCount?: number
    unassignedCount?: number
    checksRun?: boolean
    errorCount?: number
    warningCount?: number
    infoCount?: number
    unnumberedCount?: number
  }

  let {
    title,
    controller,
    doc,
    execute,
    viewMode = 'design',
    onViewMode,
    onExport,
    exportEnabled = false,
    onImport,
    onLibrary,
    onGoTo,
    pieceCount = 0,
    unassignedCount = 0,
    checksRun = false,
    errorCount = 0,
    warningCount = 0,
    infoCount = 0,
    unnumberedCount = 0,
  }: Props = $props()

  const dirty = $derived(controller?.isDirty ?? false)
</script>

<header class="topbar">
  <!-- F-058: the design's chevron is real now — this leaves the editor for the panel library. -->
  <Tooltip label={onLibrary ? 'Panel library' : 'Panel library (coming soon)'} side="bottom">
    <IconButton
      label="Back to panel library"
      variant="ghost"
      size="sm"
      disabled={!onLibrary}
      onclick={() => onLibrary?.()}
    >
      <ArrowLeft size={17} />
    </IconButton>
  </Tooltip>
  <Logo height={20} />

  <span class="rule" aria-hidden="true"></span>

  <!-- The document chip: what is open, and whether it is saved. One reading, not a badge + title. -->
  <span class="doc" data-testid="document-chip">
    <span class="doc-name">{title}</span>
    {#if controller}
      <span
        class="dirty"
        class:saved={!dirty}
        title={dirty ? 'Unsaved changes' : 'Saved'}
        aria-label={dirty ? 'Unsaved changes' : 'Saved'}
        role="img"
      ></span>
    {/if}
  </span>

  <!-- Technique promoted out of the old Layers junk-drawer into a document-level chip (F-021). -->
  <TechniqueChip {doc} {execute} />

  <span class="spacer"></span>

  <div class="views" role="tablist" aria-label="View mode">
    {#each VIEW_MODES as mode (mode.id)}
      {@const Icon = mode.icon}
      <button
        class="view"
        class:active={mode.id === viewMode}
        role="tab"
        aria-selected={mode.id === viewMode}
        disabled={!mode.live}
        title={mode.live ? mode.label : `${mode.label} view — coming with ${mode.feature}`}
        onclick={() => mode.live && onViewMode?.(mode.id)}
      >
        <Icon size={13} />
        <span class="view-label">{mode.label}</span>
      </button>
    {/each}
  </div>

  <span class="spacer"></span>

  <!-- Panel readiness, collapsed from a 44px strip into one meter (Cockpit v2). -->
  <ReadinessMeter
    {pieceCount}
    {unassignedCount}
    {checksRun}
    {errorCount}
    {warningCount}
    {infoCount}
    {unnumberedCount}
    {onGoTo}
  />

  <Tooltip label="Undo" side="bottom">
    <IconButton
      label="Undo"
      size="sm"
      disabled={controller ? !controller.canUndo : false}
      onclick={() => controller?.undo()}
    >
      <Undo2 size={17} />
    </IconButton>
  </Tooltip>
  <Tooltip label="Redo" side="bottom">
    <IconButton
      label="Redo"
      size="sm"
      disabled={controller ? !controller.canRedo : false}
      onclick={() => controller?.redo()}
    >
      <Redo2 size={17} />
    </IconButton>
  </Tooltip>
  {#if onImport}
    <Tooltip label="Import SVG" side="bottom">
      <IconButton label="Import SVG" size="sm" onclick={onImport}><FileUp size={17} /></IconButton>
    </Tooltip>
  {/if}

  <Tooltip label={onExport ? 'Export (SVG, PDF, DXF)' : 'Export (coming soon)'} side="bottom">
    <button
      class="export"
      aria-label="Export"
      disabled={!onExport || !exportEnabled}
      onclick={() => onExport?.()}
    >
      <Download size={14} />
      Export
    </button>
  </Tooltip>

  <span class="avatar" aria-hidden="true">MK</span>
</header>

<style>
  .topbar {
    grid-area: menu;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 52px;
    flex: none;
    min-width: 0;
    padding: 0 12px;
    background: var(--paper-0);
    border-bottom: 1px solid var(--border-subtle);
    /* Above the stage so the readiness and technique popovers are not clipped. */
    position: relative;
    z-index: 40;
  }

  .rule {
    width: 1px;
    height: 20px;
    background: var(--border-subtle);
    margin: 0 2px;
  }

  /* The document identity never gets squeezed — it is how you know which panel you are editing.
     Long names truncate at a generous ceiling rather than compressing to nothing. */
  .doc {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: none;
    max-width: 260px;
    padding: 5px 4px 5px 2px;
  }

  .doc-name {
    font: 700 13.5px/1 var(--font-sans);
    letter-spacing: var(--tracking-tight);
    color: var(--ink-950);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: var(--radius-full);
    background: var(--amber-600);
  }

  .dirty.saved {
    background: var(--emerald-600);
  }

  .spacer {
    flex: 1;
  }

  .views {
    display: inline-flex;
    gap: 2px;
    flex: none;
    padding: 3px;
    background: var(--paper-100);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
  }

  .view {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-600);
    font: 600 12px/1 var(--font-sans);
    cursor: pointer;
  }

  .view:hover:not(:disabled):not(.active) {
    color: var(--ink-900);
  }

  .view.active {
    color: var(--ink-950);
    background: var(--paper-0);
    box-shadow: var(--shadow-xs);
  }

  .view:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Below the design's 1512px the bar cannot hold five labelled pills plus the readiness meter, so
     the views fall back to icons. The accessible name and tooltip keep carrying the label. */
  @media (max-width: 1400px) {
    .view {
      padding: 5px 9px;
    }

    .view-label {
      /* Visually hidden, still announced. */
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  .export {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 13px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--ink-950);
    color: var(--paper-0);
    font: 600 12.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .export:hover:not(:disabled) {
    background: var(--ink-700);
  }

  .export:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: var(--radius-full);
    background: var(--violet-600);
    color: var(--paper-0);
    font: 600 11.5px/1 var(--font-sans);
  }
</style>
