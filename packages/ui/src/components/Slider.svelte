<script module lang="ts">
  let uid = 0
</script>

<script lang="ts">
  interface Props {
    label?: string
    /** Two-way bindable numeric value. */
    value?: number
    min?: number
    max?: number
    step?: number
    /** A formatted read-out shown beside the label (numbers in mono per the design system). */
    valueLabel?: string
    disabled?: boolean
    /** Called with the new value on every input. */
    onchange?: (value: number) => void
  }

  let {
    label,
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    valueLabel,
    disabled = false,
    onchange,
  }: Props = $props()

  uid += 1
  const id = `slider-${uid}`

  function handle(event: Event & { currentTarget: HTMLInputElement }) {
    value = Number(event.currentTarget.value)
    onchange?.(value)
  }
</script>

<div class="field">
  {#if label || valueLabel}
    <div class="head">
      {#if label}<label class="label" for={id}>{label}</label>{/if}
      {#if valueLabel}<span class="value">{valueLabel}</span>{/if}
    </div>
  {/if}
  <input
    {id}
    type="range"
    {min}
    {max}
    {step}
    {value}
    {disabled}
    oninput={handle}
    aria-label={label}
  />
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font: var(--text-body);
    color: var(--text-body);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .label {
    font: var(--text-small);
    font-weight: 600;
    color: var(--text-strong);
  }

  .value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  input[type='range'] {
    width: 100%;
    height: 18px;
    margin: 0;
    background: transparent;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
  }

  input[type='range']:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  input[type='range']::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--paper-300);
  }

  input[type='range']::-moz-range-track {
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--paper-300);
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    margin-top: -6px;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--action-accent);
    border: 2px solid var(--paper-0);
    box-shadow: var(--shadow-xs);
  }

  input[type='range']::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--action-accent);
    border: 2px solid var(--paper-0);
    box-shadow: var(--shadow-xs);
  }

  input[type='range']:focus-visible {
    outline: none;
  }

  input[type='range']:focus-visible::-webkit-slider-thumb {
    box-shadow: var(--focus-ring);
  }

  input[type='range']:focus-visible::-moz-range-thumb {
    box-shadow: var(--focus-ring);
  }
</style>
