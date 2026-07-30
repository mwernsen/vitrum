<script lang="ts">
  import type { Snippet } from 'svelte'

  export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

  interface Props {
    label: string
    side?: TooltipSide
    children?: Snippet
  }

  let { label, side = 'top', children }: Props = $props()
</script>

<span class="tooltip" data-side={side}>
  {@render children?.()}
  <span class="tip" role="tooltip">{label}</span>
</span>

<style>
  .tooltip {
    position: relative;
    display: inline-flex;
  }

  .tip {
    position: absolute;
    background: var(--ink-950);
    color: var(--text-inverse);
    font: var(--text-caption);
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    z-index: 50;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* Keyboard focus reveals the tip, but a *click* must not pin it: `:focus-within` kept the tip up
     after clicking an activity-rail button, since the button stays focused. `:focus-visible` is set
     for keyboard focus only, so tabbing still shows the tip and clicking leaves it to `:hover`. */
  .tooltip:hover .tip,
  .tooltip:has(:focus-visible) .tip {
    opacity: 1;
    visibility: visible;
  }

  .tooltip[data-side='top'] .tip {
    bottom: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);
  }
  .tooltip[data-side='bottom'] .tip {
    top: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);
  }
  .tooltip[data-side='left'] .tip {
    right: calc(100% + 7px);
    top: 50%;
    transform: translateY(-50%);
  }
  .tooltip[data-side='right'] .tip {
    left: calc(100% + 7px);
    top: 50%;
    transform: translateY(-50%);
  }
</style>
