<script lang="ts">
  import { validateNewPanel, type LengthUnit } from '@vitrum/core'
  import type { NewPanelSpec, TechniqueKind } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Checkbox from '../components/Checkbox.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Input from '../components/Input.svelte'
  import Radio from '../components/Radio.svelte'
  import Select from '../components/Select.svelte'

  /** How the panel is being started (FR-12). Templates are deferred to F-060. */
  export interface NewPanelChoice {
    /** Run F-051's reference-image import straight after creating the panel — the tracing on-ramp. */
    readonly fromPhoto: boolean
  }

  interface Props {
    open?: boolean
    /** Create the panel. The spec's dimensions are already validated and in millimetres. */
    onCreate: (spec: NewPanelSpec, choice: NewPanelChoice) => void
    onClose: () => void
    /** Whether tracing a photo is available (needs the host's image import). Absent ⇒ hidden. */
    photoAvailable?: boolean
  }

  let { open = $bindable(false), onCreate, onClose, photoAvailable = false }: Props = $props()

  // The dimensions are held as typed text so a half-entered value is not an error yet; the pure
  // `validateNewPanel` (F-058 FR-3) owns parsing, unit conversion and the per-field messages.
  let name = $state('')
  let width = $state('300')
  let height = $state('400')
  let units = $state<LengthUnit>('mm')
  let technique = $state<TechniqueKind>('lead')
  let fromPhoto = $state(false)
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
      fromPhoto = false
      submitted = false
    }
  })

  function submit(event?: Event): void {
    event?.preventDefault()
    submitted = true
    if (!result.ok) return
    onCreate(
      {
        name: result.name,
        units,
        widthMm: result.widthMm,
        heightMm: result.heightMm,
        technique,
      },
      { fromPhoto: fromPhoto && photoAvailable },
    )
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
      <!-- F-033: the size is the finished panel, not the drawn centreline. Say so once, here, where
           the number is typed — the checks and the canvas frame both measure it that way. -->
      <p class="note">Outside dimensions of the finished panel, once it is leaded or foiled.</p>
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

    <!-- "Start from" — the design offers blank, template or photo; templates are deferred to F-060. -->
    <fieldset class="start">
      <legend>Start from</legend>
      {#if photoAvailable}
        <Checkbox
          label="A photo or scan to trace"
          checked={fromPhoto}
          onchange={(checked) => (fromPhoto = checked)}
        />
        <p class="note">
          Adds the image as a tracing underlay once the panel is created. Cancelling the file dialog
          leaves the blank panel.
        </p>
      {:else}
        <p class="note">A blank cartoon. Pattern templates arrive with F-060.</p>
      {/if}
    </fieldset>

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

  .note {
    margin: 0;
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .start {
    padding-top: var(--space-3);
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
