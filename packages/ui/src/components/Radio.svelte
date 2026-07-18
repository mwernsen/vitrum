<script lang="ts">
  interface Props {
    label?: string
    /** Two-way bindable checked state. */
    checked?: boolean
    /** Radio group name. */
    name?: string
    value?: string
    disabled?: boolean
    onchange?: (checked: boolean) => void
  }

  let {
    label,
    checked = $bindable(false),
    name,
    value,
    disabled = false,
    onchange,
  }: Props = $props()

  function handle(event: Event & { currentTarget: HTMLInputElement }) {
    checked = event.currentTarget.checked
    onchange?.(checked)
  }
</script>

<label class="radio" data-disabled={disabled}>
  <span class="box">
    <input type="radio" {name} {value} {checked} {disabled} onchange={handle} />
    <span class="visual" aria-hidden="true"><span class="dot"></span></span>
  </span>
  {#if label}<span class="text">{label}</span>{/if}
</label>

<style>
  .radio {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font: var(--text-body);
    color: var(--text-body);
    cursor: pointer;
  }

  .radio[data-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .box {
    position: relative;
    width: 18px;
    height: 18px;
    flex: none;
  }

  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: inherit;
  }

  .visual {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--paper-0);
    border: 1px solid var(--border-strong);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ink-950);
    opacity: 0;
  }

  input:checked ~ .visual {
    border-color: var(--ink-950);
  }
  input:checked ~ .visual .dot {
    opacity: 1;
  }

  input:focus-visible ~ .visual {
    box-shadow: var(--focus-ring);
  }
</style>
