<script module lang="ts">
  let uid = 0
</script>

<script lang="ts">
  export type SelectSize = 'sm' | 'md'

  /** An option is a bare string, or a `{ label, value }` pair. */
  export type Option = string | { label: string; value: string }

  interface Props {
    label?: string
    options?: Option[]
    size?: SelectSize
    /** Two-way bindable selected value. */
    value?: string
    /** Called with the selected value on change. */
    onchange?: (value: string) => void
  }

  let { label, options = [], size = 'md', value = $bindable(''), onchange }: Props = $props()

  const valueOf = (o: Option) => (typeof o === 'string' ? o : o.value)
  const labelOf = (o: Option) => (typeof o === 'string' ? o : o.label)

  uid += 1
  const id = `select-${uid}`

  function handle(event: Event & { currentTarget: HTMLSelectElement }) {
    value = event.currentTarget.value
    onchange?.(value)
  }
</script>

<div class="field" data-size={size}>
  {#if label}<label class="label" for={id}>{label}</label>{/if}
  <span class="control">
    <select {id} {value} onchange={handle}>
      {#each options as option (valueOf(option))}
        <option value={valueOf(option)}>{labelOf(option)}</option>
      {/each}
    </select>
    <svg
      class="chevron"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--ink-500)"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m6 9 6 6 6-6"></path>
    </svg>
  </span>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font: var(--text-body);
    color: var(--text-body);
  }

  .label {
    font: var(--text-small);
    font-weight: 600;
    color: var(--text-strong);
  }

  .control {
    position: relative;
    display: block;
  }

  select {
    appearance: none;
    width: 100%;
    box-sizing: border-box;
    color: var(--text-body);
    background: var(--paper-0);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  select:focus-visible {
    outline: none;
    border-color: var(--cobalt-500);
    box-shadow: var(--focus-ring);
  }

  .chevron {
    position: absolute;
    top: 50%;
    right: 10px;
    width: 14px;
    height: 14px;
    transform: translateY(-50%);
    pointer-events: none;
  }

  /* Sizes — control-internal padding/type sizes are intentionally off the 4px
     scale, matching the canonical component. Right padding leaves room for the
     chevron. */
  .field[data-size='sm'] select {
    padding: 6px 28px 6px 10px;
    font: 400 13px/1.5 var(--font-sans);
  }
  .field[data-size='md'] select {
    padding: 9px 32px 9px 12px;
    font: 400 15px/1.55 var(--font-sans);
  }
</style>
