<script lang="ts">
  import Download from 'lucide-svelte/icons/download'
  import Redo2 from 'lucide-svelte/icons/redo-2'
  import Undo2 from 'lucide-svelte/icons/undo-2'
  import ZoomIn from 'lucide-svelte/icons/zoom-in'

  import Badge from '../components/Badge.svelte'
  import IconButton from '../components/IconButton.svelte'
  import Tooltip from '../components/Tooltip.svelte'
  import logo from '../design/assets/logo.svg'
  import type { DocumentController } from '../document/controller.svelte'

  interface Props {
    title: string
    /** When present, undo/redo become live and the badge reflects save state (F-002). */
    controller?: DocumentController
  }

  let { title, controller }: Props = $props()
</script>

<header class="topbar">
  <span class="brand">
    <img class="logo" src={logo} alt="" />
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
  <Tooltip label="Zoom" side="bottom">
    <IconButton label="Zoom"><ZoomIn size={18} /></IconButton>
  </Tooltip>
  <Tooltip label="Export cut list" side="bottom">
    <IconButton label="Export" variant="outline"><Download size={18} /></IconButton>
  </Tooltip>

  <span class="avatar" aria-hidden="true">MK</span>
</header>

<style>
  .topbar {
    grid-area: menu;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 56px;
    padding: 0 16px;
    background: var(--paper-0);
    border-bottom: 1px solid var(--border-subtle);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .logo {
    height: 24px;
    width: auto;
  }

  .wordmark {
    font: 800 17px/1 var(--font-sans);
    letter-spacing: var(--tracking-tight);
    color: var(--ink-950);
  }

  .doc-title {
    font: var(--text-small);
    color: var(--text-muted);
  }

  .spacer {
    flex: 1;
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
