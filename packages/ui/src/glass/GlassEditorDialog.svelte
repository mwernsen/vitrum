<script lang="ts">
  import { TEXTURE_TAGS, TRANSPARENCY_CLASSES, type Glass } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'
  import IconButton from '../components/IconButton.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'

  import { downscaleImage } from './downscale'

  interface Props {
    open: boolean
    /** The glass being edited, or null when creating a new one. */
    glass: Glass | null
    /** A stable id for a newly-created glass. */
    newId: () => string
    onSave: (glass: Glass) => void
    onDelete?: (id: string) => void
    onDuplicate?: (id: string) => void
    onClose: () => void
    /** Label of the scope being edited, e.g. "library" or "project", for the heading. */
    scopeLabel?: string
  }

  let { open, glass, newId, onSave, onDelete, onDuplicate, onClose, scopeLabel }: Props = $props()

  const isNew = $derived(glass === null)

  // A local, editable draft. Re-seeded whenever the target glass (or open) changes.
  let draft = $state<Glass>(blankGlass())
  let swatchError = $state<string | null>(null)
  let lastSeed: Glass | null | undefined

  $effect(() => {
    // Re-seed when the dialog opens on a different glass.
    if (open && glass !== lastSeed) {
      draft = glass ? cloneDraft(glass) : blankGlass()
      swatchError = null
      lastSeed = glass
    }
    if (!open) lastSeed = undefined
  })

  function blankGlass(): Glass {
    return {
      id: newId(),
      name: '',
      color: '#3a7bd5',
      transparency: 'transparent',
      texture: 'smooth',
      thicknessMm: 3,
    }
  }

  function cloneDraft(g: Glass): Glass {
    return { ...g, sheetSizes: g.sheetSizes ? g.sheetSizes.map((s) => ({ ...s })) : undefined }
  }

  const transparencyOptions = TRANSPARENCY_CLASSES.map((t) => ({
    value: t,
    label: t.charAt(0).toUpperCase() + t.slice(1),
  }))
  const textureOptions = TEXTURE_TAGS.map((t) => ({
    value: t,
    label: t.charAt(0).toUpperCase() + t.slice(1),
  }))

  function num(text: string): number | null {
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }

  function setNumberField(field: 'thicknessMm' | 'pricePerM2', text: string, min = 0): void {
    const v = num(text)
    if (v === null || v < min) {
      if (field === 'pricePerM2' && text.trim() === '') draft = { ...draft, pricePerM2: undefined }
      return
    }
    draft = { ...draft, [field]: v }
  }

  function addSheet(): void {
    const sheets = [...(draft.sheetSizes ?? []), { widthMm: 300, heightMm: 300 }]
    draft = { ...draft, sheetSizes: sheets }
  }

  function updateSheet(index: number, axis: 'widthMm' | 'heightMm', text: string): void {
    const v = num(text)
    if (v === null || v <= 0 || !draft.sheetSizes) return
    const sheets = draft.sheetSizes.map((s, i) => (i === index ? { ...s, [axis]: v } : s))
    draft = { ...draft, sheetSizes: sheets }
  }

  function removeSheet(index: number): void {
    const sheets = (draft.sheetSizes ?? []).filter((_, i) => i !== index)
    draft = { ...draft, sheetSizes: sheets.length > 0 ? sheets : undefined }
  }

  let fileInput = $state<HTMLInputElement>()

  async function onSwatchFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // allow re-selecting the same file
    if (!file) return
    swatchError = null
    try {
      const dataUrl = await downscaleImage(file)
      draft = { ...draft, swatch: dataUrl }
    } catch {
      swatchError = 'Could not read that image.'
    }
  }

  function clearSwatch(): void {
    draft = { ...draft, swatch: undefined }
  }

  const canSave = $derived(draft.name.trim().length > 0)

  function save(): void {
    if (!canSave) return
    onSave({ ...draft, name: draft.name.trim() })
  }
</script>

<Dialog {open} title={isNew ? 'New glass' : 'Edit glass'} {onClose} width={480}>
  {#if scopeLabel}
    <p class="eyebrow">{scopeLabel}</p>
  {/if}

  <div class="grid">
    <Input label="Name" value={draft.name} onchange={(v) => (draft = { ...draft, name: v })} />

    <div class="row">
      <div class="color-field">
        <span class="label">Colour</span>
        <div class="color-row">
          <input
            class="color-input"
            type="color"
            aria-label="Base colour"
            value={draft.color}
            oninput={(e) => (draft = { ...draft, color: e.currentTarget.value })}
          />
          <Input value={draft.color} onchange={(v) => (draft = { ...draft, color: v })} />
        </div>
      </div>
      <Input
        label="Thickness (mm)"
        value={String(draft.thicknessMm)}
        onchange={(v) => setNumberField('thicknessMm', v, 0)}
      />
    </div>

    <div class="row">
      <Select
        label="Transparency"
        options={transparencyOptions}
        value={draft.transparency}
        onchange={(v) => (draft = { ...draft, transparency: v as Glass['transparency'] })}
      />
      <Select
        label="Texture"
        options={textureOptions}
        value={draft.texture}
        onchange={(v) => (draft = { ...draft, texture: v as Glass['texture'] })}
      />
    </div>

    <p class="section">Commercial</p>
    <div class="row">
      <Input
        label="Manufacturer"
        value={draft.manufacturer ?? ''}
        onchange={(v) => (draft = { ...draft, manufacturer: v.trim() || undefined })}
      />
      <Input
        label="SKU"
        value={draft.sku ?? ''}
        onchange={(v) => (draft = { ...draft, sku: v.trim() || undefined })}
      />
    </div>
    <Input
      label="Price per m²"
      value={draft.pricePerM2 === undefined ? '' : String(draft.pricePerM2)}
      onchange={(v) => setNumberField('pricePerM2', v, 0)}
    />

    <div class="sheets">
      <div class="sheets-head">
        <span class="label">Sheet sizes (mm)</span>
        <Button size="sm" variant="ghost" onclick={addSheet}>Add size</Button>
      </div>
      {#each draft.sheetSizes ?? [] as sheet, i (i)}
        <div class="sheet-row">
          <Input
            size="sm"
            value={String(sheet.widthMm)}
            onchange={(v) => updateSheet(i, 'widthMm', v)}
          />
          <span class="times">×</span>
          <Input
            size="sm"
            value={String(sheet.heightMm)}
            onchange={(v) => updateSheet(i, 'heightMm', v)}
          />
          <IconButton size="sm" variant="ghost" label="Remove size" onclick={() => removeSheet(i)}>
            ×
          </IconButton>
        </div>
      {/each}
    </div>

    <div class="swatch-field">
      <span class="label">Swatch image</span>
      {#if draft.swatch}
        <div class="swatch-preview">
          <img src={draft.swatch} alt="Glass swatch" />
          <Button size="sm" variant="ghost" onclick={clearSwatch}>Remove</Button>
        </div>
      {:else}
        <Button size="sm" variant="secondary" onclick={() => fileInput?.click()}>
          Upload image
        </Button>
        <p class="hint">Downscaled to 512 px on import.</p>
      {/if}
      {#if swatchError}<p class="error">{swatchError}</p>{/if}
      <input
        bind:this={fileInput}
        class="visually-hidden"
        type="file"
        accept="image/*"
        aria-label="Swatch image file"
        onchange={onSwatchFile}
      />
    </div>
  </div>

  {#snippet footer()}
    {#if !isNew && glass}
      <div class="footer-left">
        {#if onDuplicate}
          <Button size="sm" variant="ghost" onclick={() => onDuplicate(glass.id)}>Duplicate</Button>
        {/if}
        {#if onDelete}
          <Button size="sm" variant="ghost" onclick={() => onDelete(glass.id)}>Delete</Button>
        {/if}
      </div>
    {/if}
    <Button size="sm" variant="secondary" onclick={onClose}>Cancel</Button>
    <Button size="sm" variant="primary" disabled={!canSave} onclick={save}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: var(--space-3);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    align-items: end;
  }

  .label {
    display: block;
    margin-bottom: var(--space-1);
    font: var(--text-small);
    color: var(--text-muted);
  }

  .color-field {
    display: flex;
    flex-direction: column;
  }

  .color-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .color-input {
    width: 40px;
    height: 34px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    cursor: pointer;
    flex: none;
  }

  .section {
    margin: var(--space-2) 0 0;
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .eyebrow {
    margin: 0 0 var(--space-3);
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .sheets {
    display: grid;
    gap: var(--space-2);
  }

  .sheets-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sheet-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto;
    gap: var(--space-2);
    align-items: center;
  }

  .times {
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .swatch-field {
    display: grid;
    gap: var(--space-2);
  }

  .swatch-preview {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .swatch-preview img {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .hint {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .error {
    margin: 0;
    font: var(--text-small);
    color: var(--danger-600);
  }

  .footer-left {
    margin-right: auto;
    display: flex;
    gap: var(--space-2);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
