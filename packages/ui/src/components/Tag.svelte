<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    /** Optional glass-color swatch (any CSS color — this is document data). */
    swatch?: string
    /** When provided, renders a remove (×) button. */
    onRemove?: () => void
    children?: Snippet
  }

  let { swatch, onRemove, children, ...rest }: Props = $props()
</script>

<span class="tag" {...rest}>
  {#if swatch}<span class="swatch" style:background-color={swatch}></span>{/if}
  {@render children?.()}
  {#if onRemove}
    <button class="remove" type="button" aria-label="Remove" onclick={onRemove}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      >
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    </button>
  {/if}
</span>

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: var(--paper-0);
    border: 1px solid var(--border-strong);
    color: var(--text-body);
    font: var(--text-small);
    font-weight: 500;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    border: 1px solid rgba(5, 5, 5, 0.15);
    flex: none;
  }

  .remove {
    display: flex;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--ink-500);
  }
</style>
