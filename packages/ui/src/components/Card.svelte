<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    /** Raises a hairline border on hover and a card shadow; use for clickable tiles. */
    interactive?: boolean
    /** Dark marketing-band styling. */
    dark?: boolean
    /** Inner padding; any spacing token, defaults to --space-6. */
    padding?: string
    children?: Snippet
  }

  let {
    interactive = false,
    dark = false,
    padding = 'var(--space-6)',
    children,
    ...rest
  }: Props = $props()
</script>

<div class="card" data-interactive={interactive} data-dark={dark} style:padding {...rest}>
  {@render children?.()}
</div>

<style>
  .card {
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    color: var(--text-body);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .card[data-interactive='true'] {
    box-shadow: var(--shadow-card);
    cursor: pointer;
  }
  .card[data-interactive='true']:hover {
    border-color: var(--border-strong);
  }

  .card[data-dark='true'] {
    background: var(--surface-dark-raised);
    border-color: var(--border-dark);
    color: var(--text-inverse);
  }
</style>
