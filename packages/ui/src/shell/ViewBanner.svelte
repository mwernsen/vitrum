<script lang="ts">
  interface Props {
    /** What this reading of the panel is, e.g. "Cartoon — full-size line drawing". */
    title: string
    /** The one number or state that qualifies it, e.g. "read-only" or "3 sheets · 68%". */
    meta?: string
  }

  let { title, meta = '' }: Props = $props()
</script>

<!--
  A banner over the derived views (Cockpit v2). The design view is the only editable one; without a
  marker it is too easy to click at a cartoon and wonder why nothing moves.
-->
<div class="banner" role="status">
  <span class="dot" aria-hidden="true"></span>
  <span class="title">{title}</span>
  {#if meta}<span class="meta">{meta}</span>{/if}
</div>

<style>
  .banner {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: 14px;
    z-index: 8;
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 6px 13px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--ink-950) 86%, transparent);
    color: var(--paper-0);
    box-shadow: var(--shadow-pop);
    pointer-events: none;
    white-space: nowrap;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--amber-600);
  }

  .title {
    font: 600 12px/1 var(--font-sans);
  }

  .meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: color-mix(in srgb, var(--paper-0) 60%, transparent);
  }
</style>
