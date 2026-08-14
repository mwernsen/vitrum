<script lang="ts">
  import Check from 'lucide-svelte/icons/check'
  import FileQuestion from 'lucide-svelte/icons/file-question'
  import FolderOpen from 'lucide-svelte/icons/folder-open'
  import Plus from 'lucide-svelte/icons/plus'
  import Search from 'lucide-svelte/icons/search'

  import Badge from '../components/Badge.svelte'
  import Tooltip from '../components/Tooltip.svelte'
  import Logo from '../design/assets/Logo.svelte'

  import type { LibraryController } from './controller.svelte'
  import { editedAt, panelDimensions, panelFigures, readinessPills, relativeTime } from './format'
  import { RAIL_ITEMS } from './rail'

  interface Props {
    controller: LibraryController
    /** Start a new panel — opens the new-panel dialog (FR-3). */
    onNew: () => void
    /** Open a `.vitrum` file from disk through the native dialog (FR-2). */
    onOpenFile: () => void
    /** Open a library entry (FR-2). */
    onOpenEntry: (path: string) => void
    /** Open a panel with its version history showing — the hero's secondary action (FR-9). */
    onOpenHistory?: (path: string) => void
    /** A `.vitrum` file dropped onto the screen (FR-4). */
    onDropFile?: (file: File) => void
    /** How many glasses the global catalog holds, for the nav rail's count. */
    glassCount?: number
  }

  let { controller, onNew, onOpenFile, onOpenEntry, onOpenHistory, onDropFile, glassCount }: Props =
    $props()

  let dragging = $state(false)

  const hero = $derived(controller.hero)
  const gridRows = $derived(controller.gridRows)

  // Thumbnails are rendered lazily on browse (FR-6): the effect asks for every visible preview once,
  // and the template only reads the cache. Mutating the cache from the template would throw
  // `state_unsafe_mutation` (the F-055 lesson).
  $effect(() => {
    for (const row of controller.rows) if (!row.missing) controller.requestThumbnail(row.entry.path)
  })

  /**
   * The card's foot line. The design puts a lifecycle badge here; that taxonomy is deferred to F-061,
   * so the slot carries what we do know about the panel — its technique and size.
   */
  function techniqueLine(technique: 'lead' | 'foil', size: string | null): string {
    const label = technique === 'foil' ? 'Copper foil' : 'Lead came'
    return size ? `${label} · ${size}` : label
  }

  /** The count shown against a rail destination, where it has one. */
  function railCount(id: string): number | undefined {
    if (id === 'panels') return controller.rows.length
    if (id === 'glass') return glassCount
    return undefined
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault()
    dragging = false
    const file = event.dataTransfer?.files?.[0]
    if (file) onDropFile?.(file)
  }
</script>

<!-- The launch screen is a top-level app state above the cockpit, not a dock section or view mode.
     Structure and metrics follow panel `#2a` of docs/design/portal-redesign.dc.html. -->
<div
  class="portal"
  class:dragging
  ondragover={(event) => {
    if (!onDropFile) return
    event.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={handleDrop}
  role="presentation"
>
  <header class="topbar">
    <span class="brand">
      <Logo height={24} />
      <span class="wordmark">Vitrum</span>
    </span>
    <span class="studio">Studio</span>
    <span class="spacer"></span>

    <!-- Search filters panels by name; glass search arrives with the glass library home (F-063). -->
    <label class="search">
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        placeholder="Search panels"
        aria-label="Search panels"
        value={controller.query}
        oninput={(event) => (controller.query = event.currentTarget.value)}
      />
    </label>
  </header>

  <div class="body">
    <nav class="rail" aria-label="Library sections">
      {#each RAIL_ITEMS as item (item.id)}
        {@const Icon = item.icon}
        {@const count = railCount(item.id)}
        {#if item.live}
          <span class="rail-item active" aria-current="page">
            <Icon size={16} />
            {item.label}
            {#if count !== undefined}<span class="rail-count">{count}</span>{/if}
          </span>
        {:else}
          <Tooltip label={item.note ?? 'Not built yet'} side="right">
            <button class="rail-item" type="button" disabled>
              <Icon size={16} />
              {item.label}
              {#if count !== undefined}<span class="rail-count">{count}</span>{/if}
            </button>
          </Tooltip>
        {/if}
      {/each}
    </nav>

    <main class="content">
      {#if controller.error}
        <!-- Non-blocking: the screen stays usable and the message can be dismissed (FR-4). -->
        <div class="error" role="status">
          <span>{controller.error}</span>
          <button type="button" onclick={() => controller.clearError()}>Dismiss</button>
        </div>
      {/if}

      {#if hero}
        <!-- "Opens on what's in flight, not an empty grid" — the design's thesis (FR-9). -->
        <section class="resume" aria-label="Continue">
          <span class="eyebrow">Continue</span>
          <div class="hero">
            <div class="hero-thumb">
              {#if controller.thumbnailUrl(hero.entry.path)}
                <!-- Rendered document content: data-driven, so exempt from the token rule. -->
                <img src={controller.thumbnailUrl(hero.entry.path)} alt="" />
              {:else}
                <span class="placeholder" aria-hidden="true"></span>
              {/if}
            </div>
            <div class="hero-meta">
              <strong class="hero-name">{hero.entry.name}</strong>
              <span class="figures">
                edited {relativeTime(editedAt(hero.entry))}{#if panelFigures(hero.entry)}
                  · {panelFigures(hero.entry)}{/if}
              </span>
              {#if hero.entry.facts}
                <div class="pills">
                  {#each readinessPills(hero.entry.facts) as pill (pill.id)}
                    <span class="pill" data-tone={pill.tone}>
                      {#if pill.tone === 'done'}
                        <Check size={12} />
                      {:else if pill.percent !== undefined}
                        <span class="dial" style:--dial-pct="{pill.percent}%" aria-hidden="true"
                        ></span>
                      {:else}
                        <span class="dot" aria-hidden="true"></span>
                      {/if}
                      {pill.label}
                    </span>
                  {/each}
                </div>
              {:else}
                <span class="unindexed">Save this panel to see its figures here.</span>
              {/if}
            </div>
            <div class="hero-actions">
              <button class="primary" type="button" onclick={() => onOpenEntry(hero.entry.path)}>
                Resume editing
              </button>
              {#if onOpenHistory}
                <button
                  class="secondary"
                  type="button"
                  onclick={() => onOpenHistory(hero.entry.path)}
                >
                  Version history
                </button>
              {/if}
            </div>
          </div>
        </section>
      {/if}

      <div class="library-head">
        <h2>All panels</h2>

        <button class="open" type="button" onclick={onOpenFile}>
          <FolderOpen size={16} />
          Open panel…
        </button>
        <button class="new" type="button" onclick={onNew}>
          <Plus size={16} />
          New panel
        </button>
      </div>

      {#if controller.noMatches}
        <p class="note" data-testid="library-no-matches">
          No panels match “{controller.query.trim()}”.
        </p>
      {:else if controller.rows.length === 0}
        <p class="note" data-testid="library-empty">
          {controller.loaded
            ? 'No panels yet. Start one from a blank cartoon.'
            : 'Reading your panels…'}
        </p>
      {/if}

      <div class="grid">
        {#each gridRows as row (row.entry.path)}
          {@const url = controller.thumbnailUrl(row.entry.path)}
          {@const size = panelDimensions(row.entry)}
          {@const figures = panelFigures(row.entry)}
          <div class="card" data-missing={row.missing ? 'true' : undefined}>
            {#if row.missing}
              <div class="thumb missing"><FileQuestion size={26} /></div>
            {:else}
              <button
                class="thumb"
                type="button"
                onclick={() => onOpenEntry(row.entry.path)}
                aria-label={`Open ${row.entry.name}`}
              >
                {#if url}
                  <img src={url} alt="" />
                {:else}
                  <span class="placeholder" aria-hidden="true"></span>
                {/if}
              </button>
            {/if}

            <div class="card-meta">
              <strong class="card-name" title={row.entry.path}>{row.entry.name}</strong>
              <!-- Omitted, not zeroed, for an entry with no indexed facts (FR-10 back-compat). -->
              {#if figures}
                <span class="figures">{figures}</span>
              {/if}
              <div class="card-foot">
                {#if row.missing}
                  <Badge tone="warning">File not found</Badge>
                {:else}
                  <span class="technique">{techniqueLine(row.entry.technique, size)}</span>
                  <span class="when">{relativeTime(editedAt(row.entry))}</span>
                {/if}
              </div>
              {#if row.missing}
                <div class="fixes">
                  <button type="button" onclick={() => void controller.locate(row.entry.path)}>
                    Locate…
                  </button>
                  <button type="button" onclick={() => void controller.forget(row.entry.path)}>
                    Remove from library
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/each}

        <!-- Templates are deferred to F-060, so this reads "blank or photo" (spec §Scope). -->
        <button class="start" type="button" onclick={onNew}>
          <span class="start-icon"><Plus size={20} /></span>
          <span class="start-label">
            Start a panel
            <span class="start-sub">blank or photo</span>
          </span>
        </button>
      </div>

      {#if onDropFile}
        <p class="drop-hint">Drop a .vitrum file here to open it.</p>
      {/if}
    </main>
  </div>
</div>

<style>
  .portal {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--paper-0);
  }

  .portal.dragging {
    outline: 2px dashed var(--cobalt-500);
    outline-offset: -6px;
  }

  /* --- 56px header (#2a) ------------------------------------------------- */

  .topbar {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 56px;
    flex: none;
    padding: 0 16px;
    background: var(--paper-0);
    border-bottom: 1px solid var(--border-subtle);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .wordmark {
    font: 800 17px/1 var(--font-sans);
    letter-spacing: var(--tracking-tight);
    color: var(--ink-950);
  }

  .studio {
    font: var(--text-small);
    color: var(--text-muted);
  }

  .spacer {
    flex: 1;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    width: 220px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    color: var(--ink-500);
  }

  .search:focus-within {
    border-color: var(--cobalt-500);
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    outline: none;
    font: var(--text-small);
    color: var(--ink-950);
  }

  .search input::placeholder {
    color: var(--ink-500);
  }

  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* --- 210px nav rail (#2a) --------------------------------------------- */

  .rail {
    width: 210px;
    flex: none;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--paper-50);
    border-right: 1px solid var(--border-subtle);
  }

  .rail-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--ink-600);
    font: 500 13.5px/1.2 var(--font-sans);
    text-align: left;
  }

  .rail-item.active {
    background: var(--paper-200);
    color: var(--ink-950);
    font-weight: 600;
  }

  .rail-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .rail-count {
    margin-left: auto;
    font: 500 11px/1 var(--font-mono);
    color: var(--ink-500);
  }

  /* --- content ---------------------------------------------------------- */

  .content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 24px;
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

  /* --- "Continue" hero (#2a) -------------------------------------------- */

  .resume {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .hero {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--paper-50);
  }

  .hero-thumb {
    width: 80px;
    height: 104px;
    flex: none;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--paper-200);
  }

  .hero-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .hero-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hero-name {
    font: var(--text-h3);
    letter-spacing: var(--tracking-tight);
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The mono figure line the design prints under the title. */
  .figures {
    font: 500 12px/1.4 var(--font-mono);
    color: var(--text-muted);
  }

  .unindexed {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 2px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: var(--radius-full);
    font: 600 11.5px/1 var(--font-sans);
  }

  .pill[data-tone='done'] {
    background: var(--emerald-100);
    color: var(--emerald-600);
  }

  .pill[data-tone='progress'] {
    background: var(--paper-100);
    color: var(--ink-700);
  }

  .pill[data-tone='attention'] {
    background: var(--ruby-100);
    color: var(--ruby-600);
  }

  /* The design's part-filled dial for the glass fraction. */
  .dial {
    width: 9px;
    height: 9px;
    border-radius: var(--radius-xs);
    background: conic-gradient(var(--cobalt-600) var(--dial-pct), var(--paper-300) 0);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: currentcolor;
  }

  .hero-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: none;
  }

  .primary,
  .secondary,
  .open,
  .new {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border-radius: var(--radius-full);
    font: 600 13px/1 var(--font-sans);
    cursor: pointer;
  }

  .primary {
    padding: 10px 20px;
    border: none;
    background: var(--ink-950);
    color: var(--paper-0);
  }

  .primary:hover {
    background: var(--ink-700);
  }

  .secondary,
  .open {
    padding: 9px 20px;
    border: 1px solid var(--border-strong);
    background: var(--paper-0);
    color: var(--ink-800);
  }

  .secondary:hover,
  .open:hover {
    border-color: var(--ink-500);
  }

  /* --- library header (#2a) --------------------------------------------- */

  .library-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .library-head h2 {
    flex: 1;
    margin: 0;
    font: var(--text-h2);
    letter-spacing: var(--tracking-tight);
    color: var(--text-strong);
  }

  .open {
    padding: 8px 14px;
  }

  .new {
    padding: 9px 16px;
    border: none;
    background: var(--cobalt-600);
    color: var(--paper-0);
  }

  .new:hover {
    background: var(--cobalt-700);
  }

  .note {
    margin: 0;
    color: var(--ink-500);
    font: var(--text-body);
  }

  /* --- 4-column grid (#2a) ---------------------------------------------- */

  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  /* Below the design's 1180px content width four columns stop fitting. */
  @media (max-width: 1180px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    }
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--paper-0);
    box-shadow: var(--shadow-card);
  }

  .thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 120px;
    width: 100%;
    padding: 0;
    overflow: hidden;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--paper-100);
    cursor: pointer;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .thumb.missing {
    color: var(--ink-500);
    cursor: default;
  }

  .placeholder {
    width: 100%;
    height: 100%;
    background: var(--paper-200);
  }

  .card-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 2px 2px;
    min-width: 0;
  }

  .card-name {
    font: var(--text-h4);
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }

  .technique,
  .when {
    font: var(--text-caption);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  /* --- "Start a panel" cell (#2a) --------------------------------------- */

  .start {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 206px;
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--paper-50);
    color: var(--ink-500);
    cursor: pointer;
  }

  .start:hover {
    border-color: var(--cobalt-600);
    color: var(--ink-700);
  }

  .start-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    background: var(--paper-0);
    color: var(--cobalt-600);
  }

  .start-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font: 600 13px/1.3 var(--font-sans);
    text-align: center;
  }

  .start-sub {
    font: 500 12px/1.4 var(--font-sans);
    color: var(--ink-500);
  }

  .drop-hint {
    margin: auto 0 0;
    padding-top: var(--space-4);
    color: var(--ink-500);
    font: var(--text-caption);
  }
</style>
