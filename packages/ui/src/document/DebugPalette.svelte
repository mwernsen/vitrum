<script lang="ts">
  import { geometryEndpoints } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'

  import type { DocumentController } from './controller.svelte'

  interface Props {
    controller: DocumentController
  }

  let { controller }: Props = $props()

  // Piece detection (F-020) is computed only while the palette is open — it reads
  // `controller.doc` inside `detect()`, so it re-runs on edits but stays off the hot path
  // when the palette is closed (e.g. the debug stress scene).
  const detection = $derived(controller.paletteOpen ? controller.detect() : null)

  /** Above this many output segments the endpoint readout is useless noise (and slow). */
  const ENDS_CAP = 8

  // Endpoints of the full output network — source *plus* derived symmetry replicas (F-052), which is
  // what an E2E needs to see: with symmetry on, the line the user drew under their cursor is a
  // replica, and the stored source segment is its fold. Read only while the palette is open.
  const outputEnds = $derived.by(() => {
    if (!controller.paletteOpen) return '—'
    const net = controller.outputNetwork()
    if (net.length === 0 || net.length > ENDS_CAP) return '—'
    return net
      .map((segment) => {
        const [a, b] = geometryEndpoints(segment.geometry)
        return `${a.x.toFixed(2)},${a.y.toFixed(2)} → ${b.x.toFixed(2)},${b.y.toFixed(2)}`
      })
      .join(' | ')
  })
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
    <p class="count" data-testid="node-count">
      Distinct nodes: <span class="mono">{controller.distinctNodeCount}</span>
    </p>
    <p class="count" data-testid="piece-count">
      Pieces: <span class="mono">{detection?.pieces.length ?? 0}</span>
    </p>
    <p class="count" data-testid="diagnostic-count">
      Diagnostics: <span class="mono">{detection?.diagnostics.length ?? 0}</span>
    </p>
    <p class="count ends" data-testid="output-ends">
      Output ends: <span class="mono">{outputEnds}</span>
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
    <div class="actions">
      <Button variant="ghost" size="sm" onclick={() => controller.loadStressScene()}>
        Load stress scene
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

  /* Coordinates run long; wrap rather than stretch the dialog. */
  .ends {
    max-width: 360px;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
