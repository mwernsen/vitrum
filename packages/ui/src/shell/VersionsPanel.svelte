<script lang="ts">
  import type { SnapshotMeta } from '@vitrum/model'

  import Copy from 'lucide-svelte/icons/copy'
  import Pencil from 'lucide-svelte/icons/pencil'
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw'
  import Trash2 from 'lucide-svelte/icons/trash-2'

  import Button from '../components/Button.svelte'
  import Dialog from '../components/Dialog.svelte'
  import IconButton from '../components/IconButton.svelte'
  import Input from '../components/Input.svelte'
  import type { VersionController } from '../versions/controller.svelte'

  interface Props {
    /** The version-history controller (F-055). */
    versions: VersionController
    /** Whether the open document is a read-only shared package (F-055 FR-8). */
    readOnly?: boolean
    /** Export a self-contained shared copy with an optional note (FR-7). */
    onShare?: (note: string) => void
    /** Detach a read-only shared document into an editable copy (FR-8). */
    onEditCopy?: () => void
  }

  let { versions, readOnly = false, onShare, onEditCopy }: Props = $props()

  type DialogMode = 'save' | 'rename' | 'share' | 'delete' | null
  let mode = $state<DialogMode>(null)
  let activeId = $state<string | null>(null)
  let nameField = $state('')
  let noteField = $state('')

  function openSave(): void {
    mode = 'save'
    activeId = null
    nameField = ''
    noteField = ''
  }

  function openShare(): void {
    mode = 'share'
    noteField = ''
  }

  function openRename(snapshot: SnapshotMeta): void {
    mode = 'rename'
    activeId = snapshot.id
    nameField = snapshot.label ?? ''
    noteField = snapshot.note ?? ''
  }

  function openDelete(id: string): void {
    mode = 'delete'
    activeId = id
  }

  function close(): void {
    mode = null
    activeId = null
  }

  async function confirmDialog(): Promise<void> {
    if (mode === 'save') {
      await versions.saveVersion(nameField, noteField)
    } else if (mode === 'rename' && activeId) {
      await versions.rename(activeId, { label: nameField, note: noteField })
    } else if (mode === 'share') {
      onShare?.(noteField.trim())
    } else if (mode === 'delete' && activeId) {
      await versions.remove(activeId)
    }
    close()
  }

  const deleteTarget = $derived(
    mode === 'delete' && activeId ? versions.snapshots.find((s) => s.id === activeId) : undefined,
  )

  /** A short, human relative time, e.g. "just now", "5 min ago", or a date for older entries. */
  function relative(createdAt: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - createdAt) / 1000))
    if (seconds < 45) return 'just now'
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} h ago`
    return new Date(createdAt).toLocaleDateString()
  }

  /** Exact timestamp for the title attribute / accessibility. */
  function exact(createdAt: number): string {
    return new Date(createdAt).toLocaleString()
  }

  // Lazily render a thumbnail for every listed snapshot (FR-6). Runs in an effect so the map
  // mutation is allowed; the rows read the cached URL via `thumbnailUrl` during render.
  $effect(() => {
    for (const snapshot of versions.snapshots) versions.requestThumbnail(snapshot.id)
  })
</script>

<div class="versions">
  {#if readOnly}
    <div class="banner" role="status">
      <p>This is a shared file, opened read-only.</p>
      <Button size="sm" variant="primary" onclick={() => onEditCopy?.()}>Edit a copy</Button>
    </div>
  {:else}
    <div class="actions">
      <Button size="sm" variant="primary" onclick={openSave}>Save version…</Button>
      {#if onShare}
        <Button size="sm" variant="secondary" onclick={openShare}>Export for sharing…</Button>
      {/if}
    </div>
  {/if}

  {#if versions.snapshots.length === 0}
    <p class="note">
      No versions yet. Snapshots are captured automatically as you work, and you can save a named
      version at any time.
    </p>
  {:else}
    <ul class="list">
      {#each versions.snapshots as snapshot (snapshot.id)}
        {@const thumb = versions.thumbnailUrl(snapshot.id)}
        <li class="row">
          <div class="thumb" aria-hidden="true">
            {#if thumb}
              <img src={thumb} alt="" />
            {:else}
              <span class="thumb-empty"></span>
            {/if}
          </div>
          <div class="meta">
            <div class="line">
              <span class="label">
                {snapshot.label ?? 'Auto snapshot'}
              </span>
              {#if snapshot.kind === 'manual'}
                <span class="tag">Named</span>
              {/if}
            </div>
            <time
              class="time"
              datetime={new Date(snapshot.createdAt).toISOString()}
              title={exact(snapshot.createdAt)}
            >
              {relative(snapshot.createdAt)}
            </time>
            {#if snapshot.note}
              <p class="snap-note">{snapshot.note}</p>
            {/if}
          </div>
          <div class="row-actions">
            <IconButton
              size="sm"
              label="Restore this version"
              disabled={readOnly}
              onclick={() => versions.restore(snapshot.id)}
            >
              <RotateCcw size={15} strokeWidth={1.7} />
            </IconButton>
            <IconButton
              size="sm"
              label="Open a copy"
              onclick={() => versions.openCopy(snapshot.id)}
            >
              <Copy size={15} strokeWidth={1.7} />
            </IconButton>
            <IconButton size="sm" label="Rename version" onclick={() => openRename(snapshot)}>
              <Pencil size={15} strokeWidth={1.7} />
            </IconButton>
            <IconButton size="sm" label="Delete version" onclick={() => openDelete(snapshot.id)}>
              <Trash2 size={15} strokeWidth={1.7} />
            </IconButton>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<Dialog
  open={mode === 'save' || mode === 'rename'}
  title={mode === 'rename' ? 'Rename version' : 'Save version'}
  onClose={close}
  width={380}
>
  <div class="form">
    <Input label="Name" placeholder="e.g. client draft 2" bind:value={nameField} />
    <Input label="Note (optional)" placeholder="What changed?" bind:value={noteField} />
  </div>
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={close}>Cancel</Button>
    <Button variant="primary" size="sm" onclick={confirmDialog}>
      {mode === 'rename' ? 'Save' : 'Save version'}
    </Button>
  {/snippet}
</Dialog>

<Dialog open={mode === 'share'} title="Export for sharing" onClose={close} width={380}>
  <div class="form">
    <p class="note">
      Writes a self-contained copy that opens read-only, so a client or collaborator can view but
      not edit it in place. It carries no version history.
    </p>
    <Input
      label="Watermark note (optional)"
      placeholder="e.g. draft — do not cut"
      bind:value={noteField}
    />
  </div>
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={close}>Cancel</Button>
    <Button variant="primary" size="sm" onclick={confirmDialog}>Export</Button>
  {/snippet}
</Dialog>

<Dialog open={mode === 'delete'} title="Delete version" onClose={close} width={360}>
  <p class="note">
    Delete {deleteTarget?.label ?? 'this auto snapshot'}? This cannot be undone; other versions are
    kept.
  </p>
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={close}>Cancel</Button>
    <Button variant="accent" size="sm" onclick={confirmDialog}>Delete</Button>
  {/snippet}
</Dialog>

<style>
  .versions {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .banner {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--paper-100);
    border: 1px solid var(--border-subtle);
  }

  .banner p {
    margin: 0;
    font: var(--text-small);
    color: var(--text-body);
  }

  .note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .row {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
    background: var(--paper-0);
  }

  .thumb {
    width: 56px;
    height: 42px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--paper-200);
    border: 1px solid var(--border-subtle);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb-empty {
    display: block;
    width: 100%;
    height: 100%;
  }

  .meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .label {
    font: 600 12.5px/1.2 var(--font-sans);
    color: var(--ink-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--cobalt-700);
    background: var(--cobalt-50);
    border-radius: var(--radius-full);
    padding: 2px 7px;
  }

  .time {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
  }

  .snap-note {
    margin: 2px 0 0;
    font: var(--text-caption);
    color: var(--ink-600);
  }

  .row-actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 2px;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>
