<script lang="ts">
  import {
    filterGlasses,
    type Glass,
    type HueBucket,
    type TextureTag,
    type TransparencyClass,
  } from '@vitrum/model'

  import Trash2 from 'lucide-svelte/icons/trash-2'

  import Button from '../components/Button.svelte'
  import Card from '../components/Card.svelte'
  import IconButton from '../components/IconButton.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import Tabs from '../components/Tabs.svelte'

  import { HUE_OPTIONS, TEXTURE_OPTIONS, TRANSPARENCY_OPTIONS, toGlassFilter } from './facets'
  import GlassEditorDialog from './GlassEditorDialog.svelte'
  import type { GlassScopeActions } from './types'

  interface Props {
    /** The global glass library (F-022). */
    library: Glass[]
    libraryActions: GlassScopeActions
    onImport?: () => void
    onExport?: () => void
    /** The current project's glass catalog. Absent ⇒ only the library scope is shown. */
    project?: Glass[]
    projectActions?: GlassScopeActions
    /**
     * Glass ids some live piece currently shows (F-023 effective colour). Project rows outside this
     * set get a remove button; absent ⇒ removal is not offered at all.
     */
    usedGlassIds?: ReadonlySet<string>
    /** Copy a library glass into the project by value (consume-by-value, FR-1). */
    onAddToProject?: (glass: Glass) => void
    /**
     * Select a glass to paint with (F-023). When provided, clicking a swatch selects it (rather than
     * opening the editor, which moves to a dedicated edit button); {@link selectedId} marks the choice.
     */
    onSelect?: (glass: Glass) => void
    selectedId?: string | null
  }

  let {
    library,
    libraryActions,
    onImport,
    onExport,
    project,
    projectActions,
    usedGlassIds,
    onAddToProject,
    onSelect,
    selectedId = null,
  }: Props = $props()

  const hasProject = $derived(project !== undefined && projectActions !== undefined)

  let scope = $state<'library' | 'project'>('library')

  let query = $state('')
  let hue = $state<HueBucket | ''>('')
  let transparency = $state<TransparencyClass | ''>('')
  let texture = $state<TextureTag | ''>('')

  const filter = $derived(toGlassFilter({ query, hue, transparency, texture }))

  const activeGlasses = $derived(scope === 'project' && project ? project : library)
  const activeActions = $derived(
    scope === 'project' && projectActions ? projectActions : libraryActions,
  )
  const shown = $derived(filterGlasses(activeGlasses, filter))

  /**
   * Whether this row offers "remove from project". Project scope only — the library is the user's
   * own collection and is not scoped to one design — and only when no live piece shows the glass.
   * Absent `usedGlassIds` means the caller cannot tell, so nothing is offered.
   */
  function removable(glass: Glass): boolean {
    return scope === 'project' && usedGlassIds !== undefined && !usedGlassIds.has(glass.id)
  }

  function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  // Editor state.
  let editorOpen = $state(false)
  let editing = $state<Glass | null>(null)

  function openNew(): void {
    editing = null
    editorOpen = true
  }

  function openEdit(glass: Glass): void {
    editing = glass
    editorOpen = true
  }

  function closeEditor(): void {
    editorOpen = false
  }

  function onSave(glass: Glass): void {
    activeActions.upsert(glass)
    editorOpen = false
  }

  function onDelete(id: string): void {
    activeActions.remove(id)
    editorOpen = false
  }

  function onDuplicate(id: string): void {
    activeActions.duplicate(id)
    editorOpen = false
  }

  function swatchStyle(glass: Glass): string {
    if (glass.swatch) return `background-image: url(${glass.swatch}); background-size: cover;`
    return `background-color: ${glass.color};`
  }
</script>

<section class="palette" aria-label="Glass palette">
  <!-- No visible heading: the enclosing DockPanel header already names the section, and repeating
       "Glass" ~100px below it read as a duplicated label. The region keeps its accessible name, and
       the scope tabs give the new-glass action a row to sit on. -->
  <div class="head">
    {#if hasProject}
      <Tabs
        size="sm"
        items={[
          { value: 'library', label: 'Library' },
          { value: 'project', label: 'Project' },
        ]}
        value={scope}
        onchange={(v) => (scope = v as 'library' | 'project')}
      />
    {/if}
    <Button size="sm" variant="secondary" onclick={openNew}>New glass</Button>
  </div>

  <Input size="sm" placeholder="Search glass…" value={query} onchange={(v) => (query = v)} />

  <div class="filters">
    <Select
      size="sm"
      options={HUE_OPTIONS}
      value={hue}
      onchange={(v) => (hue = v as HueBucket | '')}
    />
    <Select
      size="sm"
      options={TRANSPARENCY_OPTIONS}
      value={transparency}
      onchange={(v) => (transparency = v as TransparencyClass | '')}
    />
    <Select
      size="sm"
      options={TEXTURE_OPTIONS}
      value={texture}
      onchange={(v) => (texture = v as TextureTag | '')}
    />
  </div>

  <p class="count" data-testid="glass-count">{shown.length} of {activeGlasses.length}</p>

  {#if shown.length === 0}
    <p class="empty">No glass matches these filters.</p>
  {:else}
    <ul class="grid">
      {#each shown as glass (glass.id)}
        <li>
          <Card interactive padding="var(--space-2)">
            <button
              class="glass"
              class:selected={onSelect && glass.id === selectedId}
              type="button"
              aria-label={glass.name}
              aria-pressed={onSelect ? glass.id === selectedId : undefined}
              onclick={() => (onSelect ? onSelect(glass) : openEdit(glass))}
            >
              <span class="swatch" style={swatchStyle(glass)} aria-hidden="true"></span>
              <span class="meta">
                <span class="name">{glass.name}</span>
                <span class="sub">{cap(glass.transparency)} · {cap(glass.texture)}</span>
              </span>
            </button>
            {#if onSelect}
              <IconButton
                size="sm"
                variant="ghost"
                label={`Edit ${glass.name}`}
                onclick={() => openEdit(glass)}
              >
                ✎
              </IconButton>
            {/if}
            {#if scope === 'library' && onAddToProject}
              <IconButton
                size="sm"
                variant="ghost"
                label={`Add ${glass.name} to project`}
                onclick={() => onAddToProject(glass)}
              >
                +
              </IconButton>
            {/if}
            {#if removable(glass)}
              <!-- Only for project glass no piece shows any more: experimenting leaves entries
                   behind and nothing pruned them (run 2026-08-16-b). Glass in use has no remove
                   button at all, rather than a disabled one — `removeGlass` would leave the
                   assignment dangling, so it is not a thing to offer and then refuse. -->
              <IconButton
                size="sm"
                variant="ghost"
                label={`Remove ${glass.name} from project`}
                onclick={() => activeActions.remove(glass.id)}
              >
                <Trash2 size={13} strokeWidth={1.7} />
              </IconButton>
            {/if}
          </Card>
        </li>
      {/each}
    </ul>
  {/if}

  {#if scope === 'library' && (onImport || onExport)}
    <div class="io">
      {#if onImport}<Button size="sm" variant="ghost" onclick={onImport}>Import…</Button>{/if}
      {#if onExport}<Button size="sm" variant="ghost" onclick={onExport}>Export…</Button>{/if}
    </div>
  {/if}
</section>

<GlassEditorDialog
  open={editorOpen}
  glass={editing}
  newId={activeActions.newId}
  scopeLabel={scope === 'project' ? 'Project glass' : 'Library glass'}
  {onSave}
  onDelete={editing ? onDelete : undefined}
  onDuplicate={editing ? onDuplicate : undefined}
  onClose={closeEditor}
/>

<style>
  /* A column that fills the dock: the controls keep their natural height and the list takes
     whatever is left, so it scrolls to the bottom of the panel instead of stopping short. */
  .palette {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
    min-height: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .filters {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .count {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .empty {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
    /* Fills the rest of the panel. The floor keeps a usable list on a short window — and makes
       the dock scroll rather than clip when even that no longer fits. */
    flex: 1;
    min-height: 8rem;
    overflow-y: auto;
    /* Rows keep their content height. A grid's default `align-content` resolves to `stretch`, so
       with `flex: 1` giving this container more height than its rows need — a narrow filter, seven
       results — the auto rows inflated and the cards drifted apart (run 2026-08-16-b). Leftover
       space belongs at the bottom of the list, not between the items. */
    align-content: start;
  }

  .grid :global(.card) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .glass {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }

  .glass.selected .swatch {
    outline: 2px solid var(--cobalt-500);
    outline-offset: 1px;
  }

  .swatch {
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-subtle);
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .name {
    font: var(--text-small);
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .io {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
</style>
