<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'dark'

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    tone?: BadgeTone
    children?: Snippet
  }

  let { tone = 'neutral', children, ...rest }: Props = $props()
</script>

<span class="badge" data-tone={tone} {...rest}>{@render children?.()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: var(--text-caption);
    font-weight: 600;
    padding: 3px 9px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  .badge[data-tone='neutral'] {
    background: var(--paper-100);
    color: var(--ink-600);
  }
  .badge[data-tone='info'] {
    background: var(--cobalt-100);
    color: var(--cobalt-700);
  }
  .badge[data-tone='success'] {
    background: var(--emerald-100);
    color: var(--emerald-600);
  }
  .badge[data-tone='warning'] {
    background: var(--amber-100);
    color: var(--amber-600);
  }
  .badge[data-tone='danger'] {
    background: var(--ruby-100);
    color: var(--ruby-600);
  }
  .badge[data-tone='dark'] {
    background: var(--ink-950);
    color: var(--paper-50);
  }
</style>
