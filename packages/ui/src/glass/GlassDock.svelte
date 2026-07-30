<script lang="ts">
  import {
    cloneGlass,
    newGlassId,
    removeGlass,
    upsertGlass,
    type Command,
    type Glass,
    type GlassId,
  } from '@vitrum/model'

  import Button from '../components/Button.svelte'

  import type { AssignmentController } from './assignment.svelte'
  import GlassPalette from './GlassPalette.svelte'
  import type { GlassLibraryController } from './library.svelte'
  import type { GlassScopeActions } from './types'

  import type { PaintController } from '../tools/paint.svelte'

  interface Props {
    /** The global glass library (F-022). */
    glassLibrary: GlassLibraryController
    /** The assignment resolver + selected-glass owner (F-023). */
    assignments: AssignmentController
    /** The paint / piece-select controller (F-023). */
    paint: PaintController
    /** The project's glass catalog (consume-by-value). */
    glasses: Readonly<Record<GlassId, Glass>>
    /** Document command sink. Absent ⇒ project edits are unavailable. */
    execute?: (command: Command) => void
  }

  let { glassLibrary, assignments, paint, glasses, execute }: Props = $props()

  const projectGlasses = $derived<Glass[]>(Object.values(glasses))

  // Library edits go through the library controller; project edits go through undoable, serialized
  // document commands (self-contained file, FR-1).
  const libraryActions = $derived<GlassScopeActions>({
    upsert: (g) => void glassLibrary.upsert(g),
    remove: (id) => void glassLibrary.remove(id),
    duplicate: (id) => void glassLibrary.duplicate(id),
    newId: () => glassLibrary.newId(),
  })
  const projectActions = $derived<GlassScopeActions | undefined>(
    execute
      ? {
          upsert: (g) => execute(upsertGlass(g)),
          remove: (id) => execute(removeGlass(id)),
          duplicate: (id) => {
            const src = glasses[id]
            if (src)
              execute(
                upsertGlass({ ...cloneGlass(src), id: newGlassId(), name: `${src.name} copy` }),
              )
          },
          newId: () => newGlassId(),
        }
      : undefined,
  )

  /** True when two glasses are the same material (used to dedupe library → project imports). */
  function sameMaterial(a: Glass, b: Glass): boolean {
    return (
      a.name === b.name &&
      a.color === b.color &&
      a.transparency === b.transparency &&
      a.texture === b.texture
    )
  }

  /** Copy a library glass into the project by value, deduping by material; returns its project id. */
  function ensureInProject(glass: Glass): GlassId {
    const existing = projectGlasses.find((g) => sameMaterial(g, glass))
    if (existing) return existing.id
    const copy: Glass = { ...cloneGlass(glass), id: newGlassId() }
    execute?.(upsertGlass(copy))
    return copy.id
  }

  // Selecting a swatch chooses the paint colour. A library swatch is imported into the project first
  // (consume-by-value), so assignments always reference a project glass.
  function onSelect(glass: Glass, scope: 'library' | 'project'): void {
    const id = scope === 'project' ? glass.id : ensureInProject(glass)
    assignments.setSelectedGlass(id)
    if (!paint.active) paint.setMode('paint')
  }

  function addToProject(g: Glass): void {
    execute?.(upsertGlass({ ...cloneGlass(g), id: newGlassId() }))
  }

  const selectedGlass = $derived<Glass | undefined>(
    assignments.selectedGlassId ? glasses[assignments.selectedGlassId] : undefined,
  )
</script>

<!-- A plain container, not a landmark: the enclosing DockPanel is the `complementary "Panel dock"`
     region and its header carries the section name, so a nested aside labelled "Glass" only
     duplicated it. -->
<div class="dock">
  {#if selectedGlass}
    <div class="selected" aria-label="Selected glass">
      <span class="swatch" style={`background-color: ${selectedGlass.color};`} aria-hidden="true"
      ></span>
      <span class="label">
        <span class="tag">Painting with</span>
        <span class="name">{selectedGlass.name}</span>
      </span>
    </div>
  {:else}
    <p class="hint">Select a glass to paint.</p>
  {/if}

  {#if paint.mode === 'paint'}
    <Button
      size="sm"
      variant="secondary"
      disabled={!assignments.selectedGlassId}
      onclick={() => paint.paintAllUnassigned()}
    >
      Fill unassigned pieces
    </Button>
  {/if}

  <GlassPalette
    library={glassLibrary.glasses}
    {libraryActions}
    project={execute ? projectGlasses : undefined}
    {projectActions}
    onAddToProject={execute ? addToProject : undefined}
    onImport={() => void glassLibrary.importLibrary()}
    onExport={() => void glassLibrary.exportLibrary()}
    onSelect={(glass) =>
      onSelect(glass, glassLibrary.glasses.includes(glass) ? 'library' : 'project')}
    selectedId={assignments.selectedGlassId}
  />
</div>

<style>
  /* Content-only: the enclosing DockPanel (Portal cockpit "2b") owns the column chrome
     (width, border, scroll). This just lays out the glass controls. */
  .dock {
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }

  .selected {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--surface-sunken);
    border-radius: var(--radius-xs);
  }

  .swatch {
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-subtle);
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .tag {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .name {
    font: var(--text-small);
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }
</style>
