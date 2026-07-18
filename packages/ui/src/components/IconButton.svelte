<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  export type IconButtonVariant = 'ghost' | 'outline' | 'dark'
  export type IconButtonSize = 'sm' | 'md' | 'lg'

  interface Props extends HTMLButtonAttributes {
    variant?: IconButtonVariant
    size?: IconButtonSize
    /** Accessible name — required, since the button is icon-only. */
    label: string
    children?: Snippet
  }

  let {
    variant = 'ghost',
    size = 'md',
    label,
    disabled = false,
    children,
    ...rest
  }: Props = $props()
</script>

<button
  class="icon-btn"
  data-variant={variant}
  data-size={size}
  aria-label={label}
  title={label}
  {disabled}
  {...rest}
>
  {@render children?.()}
</button>

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .icon-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .icon-btn[data-size='sm'] {
    width: 28px;
    height: 28px;
  }
  .icon-btn[data-size='md'] {
    width: 34px;
    height: 34px;
  }
  .icon-btn[data-size='lg'] {
    width: 42px;
    height: 42px;
  }

  .icon-btn[data-variant='ghost'] {
    background: transparent;
    color: var(--ink-600);
    border: 1px solid transparent;
  }
  .icon-btn[data-variant='ghost']:hover:not(:disabled) {
    background: var(--paper-100);
  }

  .icon-btn[data-variant='outline'] {
    background: var(--paper-0);
    color: var(--text-strong);
    border: 1px solid var(--border-strong);
  }
  .icon-btn[data-variant='outline']:hover:not(:disabled) {
    background: var(--paper-100);
  }

  /* Dark chrome variant — white-overlay fills, no token equivalent (not hex). */
  .icon-btn[data-variant='dark'] {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-inverse);
    border: 1px solid transparent;
  }
  .icon-btn[data-variant='dark']:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }
</style>
