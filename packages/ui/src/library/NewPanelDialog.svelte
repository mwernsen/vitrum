<script lang="ts">
  import { validateNewPanel, type LengthUnit } from '@vitrum/core'
  import type { NewPanelSpec, TechniqueKind } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Input from '../components/Input.svelte'
  import Radio from '../components/Radio.svelte'
  import Select from '../components/Select.svelte'

  interface Props {
    open?: boolean
    /** Create the panel. The spec's dimensions are already validated and in millimetres. */
    onCreate: (spec: NewPanelSpec) => void
    onClose: () => void
  }

  let { open = $bindable(false), onCreate, onClose }: Props = $props()

  // The dimensions are held as typed text so a half-entered value is not an error yet; the pure
  // `validateNewPanel` (F-058 FR-3) owns parsing, unit conversion and the per-field messages.
  let name = $state('')
  let width = $state('300')
  let height = $state('400')
  let units = $state<LengthUnit>('mm')
  let technique = $state<TechniqueKind>('lead')
  // Errors stay hidden until the first submit, so the dialog does not scold a user mid-keystroke.
  let submitted = $state(false)

  const result = $derived(validateNewPanel({ name, width, height, units }))
  const shown = $derived(submitted ? result.errors : {})

  /** Reset to the defaults whenever the dialog is opened, so a cancelled attempt does not linger. */
  $effect(() => {
    if (open) {
      name = ''
      width = '300'
      height = '400'
      units = 'mm'
      technique = 'lead'
      submitted = false
    }
  })

  function submit(event?: Event): void {
    event?.preventDefault()
    submitted = true
    if (!result.ok) return
    onCreate({
      name: result.name,
      units,
      widthMm: result.widthMm,
      heightMm: result.heightMm,
      technique,
    })
  }
</script>

<Dialog {open} title="New panel" {onClose} width={480}>
  <form class="form" onsubmit={submit}>
    <Input label="Name" bind:value={name} placeholder="Untitled panel" />

    <fieldset class="size">
      <legend>Panel size</legend>
      <div class="size-row">
        <Input label="Width" bind:value={width} error={shown.width} />
        <span class="times" aria-hidden="true">×</span>
        <Input label="Height" bind:value={height} error={shown.height} />
        <Select
          label="Units"
          value={units}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'in', label: 'in' },
          ]}
          onchange={(value) => (units = value as LengthUnit)}
        />
      </div>
    </fieldset>

    <fieldset class="technique">
      <legend>Technique</legend>
      <div class="choices">
        <Radio
          label="Lead came"
          name="new-panel-technique"
          checked={technique === 'lead'}
          onchange={(checked) => {
            if (checked) technique = 'lead'
          }}
        />
        <Radio
          label="Copper foil"
          name="new-panel-technique"
          checked={technique === 'foil'}
          onchange={(checked) => {
            if (checked) technique = 'foil'
          }}
        />
      </div>
      <p class="note">You can change this later from the top bar.</p>
    </fieldset>

    <!-- Room for the pattern-templates gallery (backlog F-059); a blank cartoon is the only start today. -->
    <p class="templates">Starting from a blank cartoon. Pattern templates arrive later.</p>

    <!-- A submit button inside the form so Enter creates the panel; the footer holds the visible one. -->
    <button class="submit-shim" type="submit" tabindex="-1" aria-hidden="true"></button>
  </form>

  {#snippet footer()}
    <Button variant="ghost" onclick={onClose}>Cancel</Button>
    <Button onclick={() => submit()}>Create panel</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  fieldset {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  legend {
    padding: 0;
    font: var(--text-caption);
    font-weight: 600;
    color: var(--ink-600);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
  }

  .size-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr 5.5rem;
    align-items: end;
    gap: var(--space-3);
  }

  /* Sits on the input baseline, between width and height. */
  .times {
    padding-bottom: 10px;
    color: var(--ink-500);
    font: var(--text-body);
  }

  /* Dimensions are numbers, so they read in mono (design-system voice rule). The `Input` primitive
     exposes no class hook, so this reaches its field through the scoped wrapper. */
  .size-row :global(input) {
    font-family: var(--font-mono);
  }

  .choices {
    display: flex;
    gap: var(--space-5);
  }

  .note,
  .templates {
    margin: 0;
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .templates {
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-subtle);
  }

  /* Visually hidden rather than `display: none`, so it stays the form's default submit button and
     Enter in any field creates the panel. */
  .submit-shim {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    border: none;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
