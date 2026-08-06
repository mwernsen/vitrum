<script lang="ts">
  import FileQuestion from 'lucide-svelte/icons/file-question'
  import FolderOpen from 'lucide-svelte/icons/folder-open'
  import Plus from 'lucide-svelte/icons/plus'

  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import Logo from '../design/assets/Logo.svelte'

  import type { LibraryController } from './controller.svelte'
  import { lastOpenedLabel, panelDimensions } from './format'

  interface Props {
    controller: LibraryController
    /** Start a new panel — opens the new-panel dialog (FR-3). */
    onNew: () => void
    /** Open a `.vitrum` file from disk through the native dialog (FR-2). */
    onOpenFile: () => void
    /** Open a library entry (FR-2). */
    onOpenEntry: (path: string) => void
    /** A `.vitrum` file dropped onto the screen (FR-4). */
    onDropFile?: (file: File) => void
    /** Continue with the document already loaded in the editor, without opening anything. */
    onResume?: () => void
    /** The open document's name, shown on the resume action. */
    resumeName?: string
  }

  let { controller, onNew, onOpenFile, onOpenEntry, onDropFile, onResume, resumeName }: Props =
    $props()

  let dragging = $state(false)

  const rows = $derived(controller.rows)

  // Thumbnails are rendered lazily on browse (FR-6): the effect asks for every listed row's preview
  // once, and the template only reads the cache. Mutating the cache from the template itself would
  // throw `state_unsafe_mutation` (the F-055 lesson).
  $effect(() => {
    for (const row of rows) if (!row.missing) controller.requestThumbnail(row.entry.path)
  })

  function handleDrop(event: DragEvent): void {
    event.preventDefault()
    dragging = false
    const file = event.dataTransfer?.files?.[0]
    if (file) onDropFile?.(file)
  }
</script>

<!-- The launch screen is a top-level app state above the cockpit, not a dock section or view mode. -->
<main
  class="library"
  class:dragging
  ondragover={(event) => {
    if (!onDropFile) return
    event.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={handleDrop}
>
  <header class="head">
    <Logo height={24} />
    <div class="actions">
      <Button variant="secondary" onclick={onOpenFile}>
        {#snippet iconLeft()}<FolderOpen size={16} />{/snippet}
        Open panel…
      </Button>
      <Button onclick={onNew}>
        {#snippet iconLeft()}<Plus size={16} />{/snippet}
        New panel
      </Button>
    </div>
  </header>

  {#if onResume}
    <button class="resume" type="button" onclick={onResume}>
      Continue with <span class="resume-name">{resumeName || 'the open panel'}</span>
    </button>
  {/if}

  {#if controller.error}
    <!-- Non-blocking: the screen stays usable and the message can be dismissed (FR-4). -->
    <div class="error" role="status">
      <span>{controller.error}</span>
      <button type="button" onclick={() => controller.clearError()}>Dismiss</button>
    </div>
  {/if}

  <h1 class="title">Your panels</h1>

  {#if rows.length === 0}
    <p class="empty" data-testid="library-empty">
      {controller.loaded
        ? 'No panels yet. Start one from a blank cartoon.'
        : 'Reading your panels…'}
    </p>
  {:else}
    <ul class="grid">
      {#each rows as row (row.entry.path)}
        {@const url = controller.thumbnailUrl(row.entry.path)}
        {@const size = panelDimensions(row.entry)}
        <li class="cell" data-missing={row.missing ? 'true' : undefined}>
          {#if row.missing}
            <div class="tile missing">
              <FileQuestion size={26} />
            </div>
          {:else}
            <button
              class="tile"
              type="button"
              onclick={() => onOpenEntry(row.entry.path)}
              aria-label={`Open ${row.entry.name}`}
            >
              {#if url}
                <!-- Rendered document content: data-driven, so exempt from the token rule. -->
                <img src={url} alt="" />
              {:else}
                <span class="placeholder" aria-hidden="true"></span>
              {/if}
            </button>
          {/if}

          <div class="meta">
            <p class="name" title={row.entry.path}>{row.entry.name}</p>
            <p class="facts">
              {#if size}<span class="num">{size}</span> ·{/if}
              {row.entry.technique === 'foil' ? 'Copper foil' : 'Lead came'}
            </p>
            {#if row.missing}
              <Badge tone="warning">File not found</Badge>
              <div class="fixes">
                <button type="button" onclick={() => void controller.locate(row.entry.path)}>
                  Locate…
                </button>
                <button type="button" onclick={() => void controller.forget(row.entry.path)}>
                  Remove from library
                </button>
              </div>
            {:else}
              <p class="when">{lastOpenedLabel(row.entry.lastOpenedAt)}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if onDropFile}
    <p class="hint">Drop a .vitrum file here to open it.</p>
  {/if}
</main>

<style>
  .library {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    height: 100vh;
    width: 100vw;
    padding: var(--space-8) var(--space-8);
    box-sizing: border-box;
    overflow-y: auto;
    background: var(--surface-page);
  }

  .library.dragging {
    outline: 2px dashed var(--cobalt-500);
    outline-offset: calc(-1 * var(--space-4));
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-5);
  }

  .actions {
    display: flex;
    gap: var(--space-3);
    margin-left: auto;
  }

  /* The document already loaded in the editor — the way back without opening anything. */
  .resume {
    align-self: flex-start;
    padding: 8px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-700);
    font: var(--text-small);
    cursor: pointer;
  }

  .resume:hover {
    border-color: var(--border-strong);
    color: var(--ink-950);
  }

  .resume-name {
    font-weight: 700;
    color: var(--ink-950);
  }

  .error {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 10px 14px;
    border: 1px solid var(--amber-600);
    border-radius: var(--radius-md);
    background: var(--amber-100);
    color: var(--ink-900);
    font: var(--text-small);
  }

  .error button {
    margin-left: auto;
    border: none;
    background: none;
    color: var(--ink-700);
    font: var(--text-small);
    font-weight: 600;
    cursor: pointer;
  }

  .title {
    margin: var(--space-3) 0 0;
    font: var(--text-h3);
    color: var(--ink-950);
  }

  .empty {
    margin: 0;
    color: var(--ink-500);
    font: var(--text-body);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .tile {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 4 / 3;
    width: 100%;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--paper-100);
    box-shadow: var(--shadow-xs);
    cursor: pointer;
  }

  .tile:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-card);
  }

  .tile img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .placeholder {
    width: 100%;
    height: 100%;
    background: var(--paper-200);
  }

  .tile.missing {
    color: var(--ink-500);
    cursor: default;
    box-shadow: none;
  }

  .meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
  }

  .name {
    margin: 0;
    max-width: 100%;
    font: var(--text-body);
    font-weight: 600;
    color: var(--ink-950);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .facts,
  .when {
    margin: 0;
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .num {
    font-family: var(--font-mono);
  }

  .fixes {
    display: flex;
    gap: var(--space-3);
    padding-top: 2px;
  }

  .fixes button {
    border: none;
    padding: 0;
    background: none;
    color: var(--cobalt-700);
    font: var(--text-caption);
    font-weight: 600;
    cursor: pointer;
  }

  .fixes button:hover {
    text-decoration: underline;
  }

  .hint {
    margin: auto 0 0;
    padding-top: var(--space-5);
    color: var(--ink-500);
    font: var(--text-caption);
  }
</style>
