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

<label class="switch" data-disabled={disabled}>
  <span class="track">
    <input type="checkbox" role="switch" {checked} {disabled} onchange={handle} />
    <span class="knob" aria-hidden="true"></span>
  </span>
  {#if label}<span class="text">{label}</span>{/if}
</label>

<style>
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font: var(--text-body);
    color: var(--text-body);
    cursor: pointer;
  }

  .switch[data-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .track {
    position: relative;
    width: 36px;
    height: 20px;
    flex: none;
    border-radius: var(--radius-full);
    background: var(--paper-300);
    transition: background var(--dur-fast) var(--ease-out);
  }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    margin: 0;
    cursor: inherit;
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--paper-0);
    box-shadow: var(--shadow-xs);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .track:has(input:checked) {
    background: var(--ink-950);
  }

  input:checked ~ .knob {
    transform: translateX(16px);
  }

  .track:has(input:focus-visible) {
    box-shadow: var(--focus-ring);
  }
</style>
