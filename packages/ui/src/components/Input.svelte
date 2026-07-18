<script module lang="ts">
  let uid = 0
</script>

<script lang="ts">
  export type InputSize = 'sm' | 'md'

  interface Props {
    label?: string
    hint?: string
    error?: string
    size?: InputSize
    placeholder?: string
    type?: string
    /** Two-way bindable text value. */
    value?: string
    /** Called with the new value on every input. */
    onchange?: (value: string) => void
  }

  let {
    label,
    hint,
    error,
    size = 'md',
    placeholder,
    type = 'text',
    value = $bindable(''),
    onchange,
  }: Props = $props()

  uid += 1
  const id = `input-${uid}`

  function handle(event: Event & { currentTarget: HTMLInputElement }) {
    value = event.currentTarget.value
    onchange?.(value)
  }
</script>

<div class="field" data-size={size} data-invalid={error ? 'true' : undefined}>
  {#if label}<label class="label" for={id}>{label}</label>{/if}
  <input
    {id}
    {type}
    {placeholder}
    {value}
    oninput={handle}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error || hint ? `${id}-msg` : undefined}
  />
  {#if error}
    <span id="{id}-msg" class="message error">{error}</span>
  {:else if hint}
    <span id="{id}-msg" class="message hint">{hint}</span>
  {/if}
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

  input {
    width: 100%;
    box-sizing: border-box;
    color: var(--text-strong);
    background: var(--paper-0);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  input::placeholder {
    color: var(--text-muted);
  }

  input:hover {
    border-color: var(--paper-400);
  }

  input:focus-visible {
    outline: none;
    border-color: var(--action-accent);
    box-shadow: var(--focus-ring);
  }

  .field[data-invalid='true'] input {
    border-color: var(--danger-600);
  }

  .message {
    font: var(--text-small);
  }

  .hint {
    color: var(--text-muted);
  }

  .error {
    color: var(--danger-600);
  }

  /* Sizes — control-internal padding/type sizes are intentionally off the 4px
     scale, matching the canonical component. */
  .field[data-size='sm'] input {
    padding: 6px 10px;
    font: 400 13px/1.4 var(--font-sans);
  }
  .field[data-size='md'] input {
    padding: 9px 12px;
    font: 400 14px/1.4 var(--font-sans);
  }
</style>
