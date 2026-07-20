<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left'
  import Download from 'lucide-svelte/icons/download'
  import Redo2 from 'lucide-svelte/icons/redo-2'
  import Undo2 from 'lucide-svelte/icons/undo-2'
  import ZoomIn from 'lucide-svelte/icons/zoom-in'

  import Badge from '../components/Badge.svelte'
  import IconButton from '../components/IconButton.svelte'
  import Tooltip from '../components/Tooltip.svelte'
  import Logo from '../design/assets/Logo.svelte'
  import type { DocumentController } from '../document/controller.svelte'

  import { VIEW_MODES, type ViewMode } from './viewmode'

  interface Props {
    title: string
    /** When present, undo/redo become live and the badge reflects save state (F-002). */
    controller?: DocumentController
    /** Zoom the canvas to fit the document (F-003). */
    onZoomFit?: () => void
    /** The active view mode (F-023 design view is the only live one today). */
    viewMode?: ViewMode
    /** Switch the view mode. */
    onViewMode?: (mode: ViewMode) => void
  }

  let { title, controller, onZoomFit, viewMode = 'design', onViewMode }: Props = $props()
</script>

<header class="topbar">
  <Tooltip label="Panel library (coming soon)" side="bottom">
    <IconButton label="Back to panel library" variant="ghost" disabled>
      <ArrowLeft size={18} />
    </IconButton>
  </Tooltip>

  <span class="brand">
    <Logo height={22} />
    <span class="wordmark">Vitrum</span>
  </span>
  <span class="doc-title">{title}</span>
  {#if controller}
    <Badge tone={controller.isDirty ? 'warning' : 'neutral'}>
      {controller.isDirty ? 'Unsaved' : 'Saved'}
    </Badge>
  {:else}
    <Badge tone="neutral">Draft</Badge>
  {/if}

  <div class="spacer"></div>

  <div class="views" role="tablist" aria-label="View mode">
    {#each VIEW_MODES as mode (mode.id)}
      <button
        class="view"
        class:active={mode.id === viewMode}
        role="tab"
        aria-selected={mode.id === viewMode}
        disabled={!mode.live}
        title={mode.live ? mode.label : `${mode.label} view — coming with ${mode.feature}`}
        onclick={() => mode.live && onViewMode?.(mode.id)}
      >
        {mode.label}
      </button>
    {/each}
  </div>

  <div class="spacer"></div>

  <Tooltip label="Undo" side="bottom">
    <IconButton
      label="Undo"
      disabled={controller ? !controller.canUndo : false}
      onclick={() => controller?.undo()}
    >
      <Undo2 size={18} />
    </IconButton>
  </Tooltip>
  <Tooltip label="Redo" side="bottom">
    <IconButton
      label="Redo"
      disabled={controller ? !controller.canRedo : false}
      onclick={() => controller?.redo()}
    >
      <Redo2 size={18} />
    </IconButton>
  </Tooltip>
  <Tooltip label="Zoom to fit" side="bottom">
    <IconButton label="Zoom to fit" onclick={() => onZoomFit?.()}><ZoomIn size={18} /></IconButton>
  </Tooltip>
  <Tooltip label="Export (coming soon)" side="bottom">
    <IconButton label="Export" variant="outline" disabled><Download size={18} /></IconButton>
  </Tooltip>

  <span class="avatar" aria-hidden="true">MK</span>
</header>

<style>
  .topbar {
    grid-area: menu;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 56px;
    padding: 0 14px;
    background: var(--paper-0);
    border-bottom: 1px solid var(--border-subtle);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .wordmark {
    font: 800 16px/1 var(--font-sans);
    letter-spacing: var(--tracking-tight);
    color: var(--ink-950);
  }

  .doc-title {
    font: var(--text-small);
    font-weight: 600;
    color: var(--ink-800);
  }

  .spacer {
    flex: 1;
  }

  .views {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: var(--paper-100);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
  }

  .view {
    padding: 5px 13px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-600);
    font: 600 12.5px/1 var(--font-sans);
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

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-full);
    background: var(--violet-600);
    color: var(--paper-0);
    font: 600 12px/1 var(--font-sans);
  }
</style>
