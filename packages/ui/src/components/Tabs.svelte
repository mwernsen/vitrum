<script lang="ts" module>
  export type TabItem = string | { label: string; value: string }
  export type TabsSize = 'sm' | 'md'
</script>

<script lang="ts">
  interface Props {
    /** Tab list; each item is a string or `{ label, value }`. */
    items?: TabItem[]
    /** Selected tab value (two-way bindable). */
    value: string
    onchange?: (value: string) => void
    size?: TabsSize
  }

  let { items = [], value = $bindable(), onchange, size = 'md' }: Props = $props()

  const idOf = (it: TabItem) => (typeof it === 'string' ? it : it.value)
  const labelOf = (it: TabItem) => (typeof it === 'string' ? it : it.label)

  function select(id: string) {
    if (id === value) return
    value = id
    onchange?.(id)
  }
</script>

<div class="tabs" role="tablist" data-size={size}>
  {#each items as it (idOf(it))}
    {@const id = idOf(it)}
    <button
      class="tab"
      role="tab"
      type="button"
      aria-selected={id === value}
      data-active={id === value}
      onclick={() => select(id)}
    >
      {labelOf(it)}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    color: var(--text-muted);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .tabs[data-size='sm'] .tab {
    padding: 6px 10px;
    font: 600 13px/1.2 var(--font-sans);
  }
  .tabs[data-size='md'] .tab {
    padding: 10px 14px;
    font: 600 14px/1.2 var(--font-sans);
  }

  .tab[data-active='true'] {
    border-bottom-color: var(--ink-950);
    color: var(--text-strong);
  }

  .tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-xs);
  }
</style>
