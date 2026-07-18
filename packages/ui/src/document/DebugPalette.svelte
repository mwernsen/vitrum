<script lang="ts">
  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'

  import type { DocumentController } from './controller.svelte'

  interface Props {
    controller: DocumentController
  }

  let { controller }: Props = $props()
</script>

<!--
  Debug command palette (F-002 acceptance criteria). A developer surface for driving the
  document model before the real drawing tools (F-011) exist: add segments, then exercise
  undo/redo/save. Built from design-system primitives (Dialog, Button); not production chrome.
-->
<Dialog
  bind:open={controller.paletteOpen}
  title="Debug commands"
  onClose={() => (controller.paletteOpen = false)}
>
  <div class="palette">
    <p class="count" data-testid="segment-count">
      Segments: <span class="mono">{controller.segmentCount}</span>
    </p>
    <div class="actions">
      <Button variant="primary" size="sm" onclick={controller.addDebugSegment}>Add segment</Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!controller.canUndo}
        onclick={controller.undo}
      >
        Undo
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!controller.canRedo}
        onclick={controller.redo}
      >
        Redo
      </Button>
    </div>
  </div>
</Dialog>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 260px;
  }

  .count {
    margin: 0;
    font: var(--text-body);
    color: var(--text-body);
  }

  .mono {
    font-family: var(--font-mono);
    color: var(--text-strong);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
