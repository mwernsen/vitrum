<script lang="ts">
  import ChevronRight from 'lucide-svelte/icons/chevron-right'
  import Printer from 'lucide-svelte/icons/printer'
  import Table from 'lucide-svelte/icons/table'

  interface Props {
    /** What the cutting list currently amounts to, e.g. "4 pieces · 0.14 m² glass". */
    cutSummary: string
    /** Open the cutting list / BOM in the bottom drawer, where the table has width. */
    onOpenCutList: () => void
    /** Open the export hub on the 1:1 tiled template (F-041). Absent ⇒ the row hides. */
    onPrintTemplate?: () => void
    /** What the template amounts to, e.g. "4 tiles · A4 portrait". */
    templateSummary?: string
  }

  let { cutSummary, onOpenCutList, onPrintTemplate, templateSummary = '' }: Props = $props()
</script>

<!--
  The two things a maker takes to the bench (Cockpit v2). Both are wide documents, so the dock links
  to them rather than trying to hold them: the cutting list opens in the drawer under the stage, the
  template goes through the export hub.
-->
<div class="outputs">
  <span class="eyebrow">Bench outputs</span>

  <button class="row" onclick={onOpenCutList}>
    <Table size={16} strokeWidth={1.7} />
    <span class="text">
      <span class="title">Cutting list &amp; BOM</span>
      <span class="meta">{cutSummary}</span>
    </span>
    <ChevronRight size={15} />
  </button>

  {#if onPrintTemplate}
    <button class="row" onclick={onPrintTemplate}>
      <Printer size={16} strokeWidth={1.7} />
      <span class="text">
        <span class="title">1:1 template</span>
        <span class="meta">{templateSummary}</span>
      </span>
      <ChevronRight size={15} />
    </button>
  {/if}
</div>

<style>
  .outputs {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 11px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    color: var(--ink-700);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    border-color: var(--border-strong);
  }

  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .title {
    font: 600 12.5px/1.2 var(--font-sans);
    color: var(--ink-900);
  }

  .meta {
    font: var(--text-caption);
    color: var(--ink-500);
  }
</style>
