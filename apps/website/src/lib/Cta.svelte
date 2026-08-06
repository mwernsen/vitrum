<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAnchorAttributes } from 'svelte/elements'

  // Anchor twin of the core Button primitive: landing-page CTAs are links, and
  // the ported Button renders a <button>. Styles mirror Button's canonical
  // variants exactly. Net-new for the design project (back-port candidate).
  export type CtaVariant = 'primary' | 'accent' | 'secondary' | 'inverse' | 'inverse-outline'
  export type CtaSize = 'sm' | 'md' | 'lg'

  interface Props extends HTMLAnchorAttributes {
    variant?: CtaVariant
    size?: CtaSize
    children?: Snippet
  }

  let { variant = 'primary', size = 'md', children, ...rest }: Props = $props()
</script>

<a class="cta" data-variant={variant} data-size={size} {...rest}>
  {@render children?.()}
</a>

<style>
  .cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    border-radius: var(--radius-full);
    letter-spacing: var(--tracking-tight);
    text-decoration: none;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  .cta:active {
    transform: scale(0.98);
  }

  /* Sizes — control-internal padding/type sizes are intentionally off the 4px
     scale, matching the canonical Button. */
  .cta[data-size='sm'] {
    padding: 6px 14px;
    font: 600 13px/1.2 var(--font-sans);
  }
  .cta[data-size='md'] {
    padding: 9px 20px;
    font: 600 14px/1.2 var(--font-sans);
  }
  .cta[data-size='lg'] {
    padding: 13px 26px;
    font: 600 16px/1.2 var(--font-sans);
  }

  .cta[data-variant='primary'] {
    background: var(--action-primary);
    color: var(--text-inverse);
    border: 1px solid transparent;
  }
  .cta[data-variant='primary']:hover {
    background: var(--action-primary-hover);
    color: var(--text-inverse);
  }

  .cta[data-variant='accent'] {
    background: var(--action-accent);
    color: var(--paper-0);
    border: 1px solid transparent;
  }
  .cta[data-variant='accent']:hover {
    background: var(--action-accent-hover);
    color: var(--paper-0);
  }

  .cta[data-variant='secondary'] {
    background: var(--paper-0);
    color: var(--text-strong);
    border: 1px solid var(--border-strong);
  }
  .cta[data-variant='secondary']:hover {
    background: var(--paper-100);
    color: var(--text-strong);
  }

  .cta[data-variant='inverse'] {
    background: var(--paper-0);
    color: var(--ink-950);
    border: 1px solid transparent;
  }
  .cta[data-variant='inverse']:hover {
    background: var(--paper-200);
    color: var(--ink-950);
  }

  .cta[data-variant='inverse-outline'] {
    background: transparent;
    color: var(--text-inverse);
    border: 1px solid var(--border-dark);
  }
  /* No token for this white-overlay hover; matches the canonical Button. */
  .cta[data-variant='inverse-outline']:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-inverse);
  }
</style>
