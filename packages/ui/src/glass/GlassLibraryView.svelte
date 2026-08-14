<script lang="ts">
  import { filterGlasses, type Glass, type HueBucket, type TextureTag } from '@vitrum/model'
  import type { TransparencyClass } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Select from '../components/Select.svelte'
  import Tag from '../components/Tag.svelte'

  import { HUE_OPTIONS, TEXTURE_OPTIONS, TRANSPARENCY_OPTIONS, toGlassFilter } from './facets'
  import GlassEditorDialog from './GlassEditorDialog.svelte'
  import type { GlassLibraryController } from './library.svelte'

  /**
   * The full-page glass library home (F-063): the global catalog (F-022), browsable and editable from
   * the launch screen without opening a panel. It is the F-022 palette's Library tab at page scale —
   * richer cards (the commercial metadata visible), the same search + facet semantics (`filterGlasses`
   * reused, not reimplemented), and the same {@link GlassLibraryController} so the editor palette and
   * this screen can never disagree (FR-4). Glass swatches are the canonical home of the vitrail
   * palette and exempt from the token rule; the surrounding chrome is not.
   *
   * The free-text query is owned by the launch screen's header (FR-6) and passed in, so the header's
   * "Search glass" field drives this grid; the facets are local.
   */
  interface Props {
    controller: GlassLibraryController
    /** The header search field's query for this view (FR-6). */
    query: string
    onImport?: () => void
    onExport?: () => void
  }

  let { controller, query, onImport, onExport }: Props = $props()

  let hue = $state<HueBucket | ''>('')
  let transparency = $state<TransparencyClass | ''>('')
  let texture = $state<TextureTag | ''>('')

  const filter = $derived(toGlassFilter({ query, hue, transparency, texture }))
  const shown = $derived(filterGlasses(controller.glasses, filter))

  // Editor + delete-confirmation state.
  let editorOpen = $state(false)
  let editing = $state<Glass | null>(null)
  let confirmDelete = $state<Glass | null>(null)

  function openNew(): void {
    editing = null
    editorOpen = true
  }

  function openEdit(glass: Glass): void {
    editing = glass
    editorOpen = true
  }

  function onSave(glass: Glass): void {
    void controller.upsert(glass)
    editorOpen = false
  }

  function onDuplicate(id: string): void {
    void controller.duplicate(id)
    editorOpen = false
  }

  /** Delete always confirms (resolved Open question 3), through one shared Dialog. */
  function requestDelete(id: string): void {
    editorOpen = false
    confirmDelete = controller.glasses.find((g) => g.id === id) ?? null
  }

  function doDelete(): void {
    if (confirmDelete) void controller.remove(confirmDelete.id)
    confirmDelete = null
  }

  function swatchStyle(glass: Glass): string {
    if (glass.swatch) return `background-image: url(${glass.swatch}); background-size: cover;`
    return `background-color: ${glass.color};`
  }

  function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  /** The commercial subtitle: "manufacturer · SKU" where present, the management surface's point. */
  function commercialLine(glass: Glass): string | null {
    const parts = [glass.manufacturer, glass.sku].filter((s): s is string => !!s)
    return parts.length > 0 ? parts.join(' · ') : null
  }
</script>

<section class="glass-home" aria-label="Glass library">
  <div class="head">
    <h2>Glass library</h2>
    <div class="head-actions">
      {#if onImport}
        <Button size="sm" variant="secondary" onclick={onImport}>Import…</Button>
      {/if}
      {#if onExport}
        <Button size="sm" variant="secondary" onclick={onExport}>Export…</Button>
      {/if}
      <Button size="sm" variant="primary" onclick={openNew}>New glass</Button>
    </div>
  </div>

  <div class="facets" aria-label="Filter glass">
    <Select
      size="sm"
      label="Hue"
      options={HUE_OPTIONS}
      value={hue}
      onchange={(v) => (hue = v as HueBucket | '')}
    />
    <Select
      size="sm"
      label="Transparency"
      options={TRANSPARENCY_OPTIONS}
      value={transparency}
      onchange={(v) => (transparency = v as TransparencyClass | '')}
    />
    <Select
      size="sm"
      label="Texture"
      options={TEXTURE_OPTIONS}
      value={texture}
      onchange={(v) => (texture = v as TextureTag | '')}
    />
    <span class="count" data-testid="glass-home-count"
      >{shown.length} of {controller.glasses.length}</span
    >
  </div>

  {#if shown.length === 0}
    {#if controller.glasses.length === 0}
      <p class="note" data-testid="glass-home-empty">Your glass library is empty.</p>
    {:else}
      <p class="note" data-testid="glass-home-no-matches">No glass matches these filters.</p>
    {/if}
  {:else}
    <ul class="grid">
      {#each shown as glass (glass.id)}
        {@const commercial = commercialLine(glass)}
        <li>
          <!-- The card is the management surface: rich metadata visible (Open question 1). Clicking
               it opens the editor. Swatch is glass data, exempt from the token rule. -->
          <button
            class="card"
            type="button"
            aria-label={glass.name}
            onclick={() => openEdit(glass)}
          >
            <span class="swatch" style={swatchStyle(glass)} aria-hidden="true"></span>
            <span class="body">
              <span class="name">{glass.name}</span>
              {#if commercial}<span class="commercial">{commercial}</span>{/if}
              <span class="tags">
                <Tag>{cap(glass.transparency)}</Tag>
                <Tag>{cap(glass.texture)}</Tag>
                <Tag>{glass.thicknessMm} mm</Tag>
              </span>
              {#if glass.pricePerM2 !== undefined}
                <span class="price">{glass.pricePerM2.toFixed(2)} / m²</span>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<GlassEditorDialog
  open={editorOpen}
  glass={editing}
  newId={() => controller.newId()}
  scopeLabel="Library glass"
  {onSave}
  onDelete={editing ? requestDelete : undefined}
  onDuplicate={editing ? onDuplicate : undefined}
  onClose={() => (editorOpen = false)}
/>

<!-- Always-confirm delete (Open question 3). FR-7: consume-by-value means panels are unharmed. -->
<Dialog
  open={confirmDelete !== null}
  title="Delete glass"
  width={420}
  onClose={() => (confirmDelete = null)}
>
  {#if confirmDelete}
    <p class="confirm">
      Delete <strong>{confirmDelete.name}</strong> from your library? Panels that already use it keep
      their glass — they copy it by value — so nothing you have designed changes.
    </p>
  {/if}
  {#snippet footer()}
    <Button size="sm" variant="secondary" onclick={() => (confirmDelete = null)}>Cancel</Button>
    <Button size="sm" variant="accent" onclick={doDelete}>Delete</Button>
  {/snippet}
</Dialog>

<style>
  .glass-home {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .head h2 {
    flex: 1;
    margin: 0;
    font: var(--text-h2);
    letter-spacing: var(--tracking-tight);
    color: var(--text-strong);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .facets {
    display: flex;
    align-items: end;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .count {
    margin-bottom: 6px;
    font: 500 11px/1 var(--font-mono);
    color: var(--text-muted);
  }

  .note {
    margin: 0;
    color: var(--ink-500);
    font: var(--text-body);
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px;
  }

  .card {
    display: flex;
    gap: 14px;
    width: 100%;
    padding: 14px;
    text-align: left;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--paper-0);
    box-shadow: var(--shadow-card);
    cursor: pointer;
  }

  .card:hover {
    border-color: var(--border-strong);
  }

  .swatch {
    width: 56px;
    height: 56px;
    flex: none;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .name {
    font: var(--text-h4);
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commercial {
    font: var(--text-caption);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }

  .price {
    font: 500 11px/1 var(--font-mono);
    color: var(--text-muted);
  }

  .confirm {
    margin: 0;
    font: var(--text-body);
    color: var(--text-body);
  }
</style>
