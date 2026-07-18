<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  export type ButtonVariant =
    'primary' | 'secondary' | 'accent' | 'ghost' | 'inverse' | 'inverse-outline'
  export type ButtonSize = 'sm' | 'md' | 'lg'

  interface Props extends HTMLButtonAttributes {
    variant?: ButtonVariant
    size?: ButtonSize
    /** Optional leading icon (16–20px). */
    iconLeft?: Snippet
    children?: Snippet
  }

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    iconLeft,
    children,
    ...rest
  }: Props = $props()
</script>

<button class="btn" data-variant={variant} data-size={size} {disabled} {...rest}>
  {#if iconLeft}<span class="icon">{@render iconLeft()}</span>{/if}
  {@render children?.()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    border-radius: var(--radius-full);
    letter-spacing: var(--tracking-tight);
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .icon {
    display: inline-flex;
  }

  /* Sizes — control-internal padding/type sizes are intentionally off the 4px
     scale, matching the canonical component. */
  .btn[data-size='sm'] {
    padding: 6px 14px;
    font: 600 13px/1.2 var(--font-sans);
  }
  .btn[data-size='md'] {
    padding: 9px 20px;
    font: 600 14px/1.2 var(--font-sans);
  }
  .btn[data-size='lg'] {
    padding: 13px 26px;
    font: 600 16px/1.2 var(--font-sans);
  }

  /* Variants */
  .btn[data-variant='primary'] {
    background: var(--action-primary);
    color: var(--text-inverse);
    border: 1px solid transparent;
  }
  .btn[data-variant='primary']:hover:not(:disabled) {
    background: var(--action-primary-hover);
  }

  .btn[data-variant='accent'] {
    background: var(--action-accent);
    color: var(--paper-0);
    border: 1px solid transparent;
  }
  .btn[data-variant='accent']:hover:not(:disabled) {
    background: var(--action-accent-hover);
  }

  .btn[data-variant='secondary'] {
    background: var(--paper-0);
    color: var(--text-strong);
    border: 1px solid var(--border-strong);
  }
  .btn[data-variant='secondary']:hover:not(:disabled) {
    background: var(--paper-100);
  }

  .btn[data-variant='ghost'] {
    background: transparent;
    color: var(--text-strong);
    border: 1px solid transparent;
  }
  .btn[data-variant='ghost']:hover:not(:disabled) {
    background: var(--paper-100);
  }

  .btn[data-variant='inverse'] {
    background: var(--paper-0);
    color: var(--ink-950);
    border: 1px solid transparent;
  }
  .btn[data-variant='inverse']:hover:not(:disabled) {
    background: var(--paper-200);
  }

  .btn[data-variant='inverse-outline'] {
    background: transparent;
    color: var(--text-inverse);
    border: 1px solid var(--border-dark);
  }
  /* No token for this white-overlay hover; kept as-is from source (not a hex). */
  .btn[data-variant='inverse-outline']:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }
</style>
