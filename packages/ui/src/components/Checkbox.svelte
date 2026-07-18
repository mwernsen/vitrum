<script lang="ts">
  interface Props {
    label?: string
    /** Two-way bindable checked state. */
    checked?: boolean
    disabled?: boolean
    /** Called with the new checked state on toggle. */
    onchange?: (checked: boolean) => void
  }

  let { label, checked = $bindable(false), disabled = false, onchange }: Props = $props()

  function handle(event: Event & { currentTarget: HTMLInputElement }) {
    checked = event.currentTarget.checked
    onchange?.(checked)
  }
</script>

<label class="checkbox" data-disabled={disabled}>
  <span class="box">
    <input type="checkbox" {checked} {disabled} onchange={handle} />
    <span class="visual" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--paper-0)"
        stroke-width="3.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M20 6 9 17l-5-5"></path>
      </svg>
    </span>
  </span>
  {#if label}<span class="text">{label}</span>{/if}
</label>

<style>
  .checkbox {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font: var(--text-body);
    color: var(--text-body);
    cursor: pointer;
  }

  .checkbox[data-disabled='true'] {
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
    border-radius: var(--radius-xs);
    background: var(--paper-0);
    border: 1px solid var(--border-strong);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .visual svg {
    width: 11px;
    height: 11px;
    opacity: 0;
  }

  input:checked ~ .visual {
    background: var(--ink-950);
    border-color: var(--ink-950);
  }

  input:checked ~ .visual svg {
    opacity: 1;
  }

  input:focus-visible ~ .visual {
    box-shadow: var(--focus-ring);
  }
</style>
