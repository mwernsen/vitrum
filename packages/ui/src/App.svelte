<script lang="ts">
  import type { Panel } from '@vitrum/core'
  import type { NewPanelSpec } from '@vitrum/model'
  import { onMount } from 'svelte'

  import { createBrowserHost } from './document/browserHost'
  import { DocumentController } from './document/controller.svelte'
  import DebugPalette from './document/DebugPalette.svelte'
  import type { AppHost } from './document/host'
  import { GlassLibraryController } from './glass/library.svelte'
  import { LibraryController } from './library/controller.svelte'
  import LibraryScreen from './library/LibraryScreen.svelte'
  import NewPanelDialog, { type NewPanelChoice } from './library/NewPanelDialog.svelte'
  import type { DockSection } from './shell/dock'
  import { PriceBookController } from './quote/priceBook.svelte'
  import AppShell from './shell/AppShell.svelte'
  import { VersionController } from './versions/controller.svelte'

  interface Props {
    /** Host environment. Defaults to the browser stub so `pnpm dev:ui` and tests run. */
    host?: AppHost
  }

  let { host = createBrowserHost() }: Props = $props()

  // The host is fixed for the lifetime of the app (one per mount); creating the
  // controller from its initial value is intentional, not a missed reactive dependency.
  // svelte-ignore state_referenced_locally
  const controller = new DocumentController(host)

  // The global glass library (F-022), persisted through the host's library port.
  // svelte-ignore state_referenced_locally
  const glassLibrary = new GlassLibraryController(host.glassLibrary)

  // Version history (F-055): automatic + manual snapshots, persisted through the host's version
  // port and keyed per document. Restore re-enters the document through a single undoable command.
  // svelte-ignore state_referenced_locally
  const versions = new VersionController({
    getDoc: () => controller.doc,
    restore: (project) => controller.restoreProject(project),
    openCopy: (project) => controller.openCopyProject(project),
    port: host.versionStore,
  })

  // The global workshop price book (F-056), persisted through the host's price-book port.
  // svelte-ignore state_referenced_locally
  const priceBook = new PriceBookController(host.priceBook)

  // The panel library (F-058): the user's recent `.vitrum` files, their missing state and their
  // lazily rendered previews. App-level state, like the glass library and version history.
  // svelte-ignore state_referenced_locally
  const library = new LibraryController({ port: host.library, storage: host.storage })

  /**
   * The top-level app state (F-058). The launch screen sits *above* the cockpit's view modes and dock
   * sections — it is a different screen, not another panel. The desktop host opens on the library;
   * `pnpm dev:ui` opens on the editor so component work needs no click-through (`?library` opts in).
   */
  // svelte-ignore state_referenced_locally
  let screen = $state<'library' | 'editor'>(host.launchScreen ? 'library' : 'editor')
  let newPanelOpen = $state(false)
  /** Set when a panel was started "from a photo" — the shell runs F-051's import once (FR-12). */
  let photoRequested = $state(false)
  /** Which dock section to land on when entering the editor (the hero's "Version history", FR-9). */
  let entrySection = $state<DockSection | undefined>(undefined)

  // The panel the shell describes: the open document's own name, size and technique — the
  // `Project.settings` the new-panel dialog finally gives a creation-time UI (F-058 FR-3).
  const panel = $derived<Panel>({
    id: 'panel',
    name: controller.doc.settings.name || 'Untitled panel',
    widthMm: controller.doc.settings.panelSize?.width ?? 300,
    heightMm: controller.doc.settings.panelSize?.height ?? 400,
    pieces: [],
  })

  // Undo/redo and save/open are also wired to the native menu (desktop) via the host;
  // these shortcuts make them work in the browser too (F-002 scope).
  function onKeydown(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey)) return
    switch (event.key.toLowerCase()) {
      case 'n':
        // FR-3: Cmd-N opens the new-panel dialog from anywhere, library screen included.
        event.preventDefault()
        newPanelOpen = true
        break
      case 'z':
        event.preventDefault()
        if (event.shiftKey) controller.redo()
        else controller.undo()
        break
      case 'y':
        event.preventDefault()
        controller.redo()
        break
      case 's':
        event.preventDefault()
        void (event.shiftKey ? controller.saveAs() : controller.save())
        break
      case 'o':
        event.preventDefault()
        void openFromDialog()
        break
      case 'k':
        event.preventDefault()
        controller.togglePalette()
        break
    }
  }

  onMount(() => {
    // The native File ▸ New and Cmd-N both ask for a name, size and technique now (FR-3).
    controller.onNewPanel = () => (newPanelOpen = true)
    // A saved document belongs in the library, with a preview keyed to its new mtime (FR-2/FR-6) and
    // its derived figures indexed for the grid and hero (FR-10).
    controller.onSaved = (path) =>
      void library.recordSaved(path, controller.doc, controller.indexFacts?.())
    const offOpenFile = host.onOpenFile?.((path) => void openPath(path))
    void boot()
    void glassLibrary.init()
    void priceBook.init()
    return () => {
      offOpenFile?.()
      controller.dispose()
    }
  })

  /**
   * Decide which screen the app opens on (FR-1). Precedence, per the spec: the crash-recovery prompt
   * first, then a file the app was launched with, then the launch screen. Reading the library never
   * blocks any of it — a slow or missing store just yields an empty grid (FR-7).
   */
  async function boot(): Promise<void> {
    // Awaited so a panel opened moments later cannot be clobbered by the load finishing after it.
    // Every disk touch inside is guarded, so this cannot hang on a missing or slow store (FR-7).
    await library.init()
    if (await offerRecovery()) {
      screen = 'editor'
      return
    }
    const path = (await host.initialFile?.()) ?? null
    if (path) await openPath(path)
  }

  /** Restore an unclean-exit snapshot if the user wants it. Resolves true when a document was loaded. */
  async function offerRecovery(): Promise<boolean> {
    const snapshot = await host.storage.readAutosave()
    if (!snapshot) return false
    const restore = host.confirmRecover ? await host.confirmRecover() : false
    if (!restore) {
      await host.storage.clearAutosave()
      return false
    }
    controller.recover(snapshot)
    return true
  }

  /** Open a `.vitrum` path and enter the editor, recording it in the library (FR-1/FR-2). */
  async function openPath(path: string, section?: DockSection): Promise<void> {
    if (!(await controller.openPath(path))) {
      library.fail('That panel could not be opened. It may have moved, or it is not a Vitrum file.')
      await library.refresh()
      return
    }
    await library.recordOpened(path, controller.doc)
    entrySection = section
    screen = 'editor'
  }

  /** The native open dialog, from either screen (FR-2). */
  async function openFromDialog(): Promise<void> {
    if (!(await controller.open())) return
    const path = controller.currentPath
    if (path) await library.recordOpened(path, controller.doc)
    screen = 'editor'
  }

  /**
   * A `.vitrum` file dropped onto the launch screen (FR-4). The bytes come straight off the `File`;
   * the host resolves its real path (Electron `webUtils`) so the library entry stays openable, and an
   * unreadable drop produces a dismissible message rather than a blocked screen.
   */
  async function openDropped(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.vitrum')) {
      library.fail(`${file.name} is not a Vitrum panel.`)
      return
    }
    const path = host.filePathFor?.(file) ?? file.name
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!(await controller.openBytes(path, bytes))) {
      library.fail(`${file.name} could not be read as a Vitrum panel.`)
      return
    }
    library.clearError()
    await library.recordOpened(path, controller.doc)
    screen = 'editor'
  }

  /**
   * Create the panel the dialog described and enter the editor (FR-3). Unsaved until Save-As. When the
   * user chose "from a photo", the shell then runs F-051's reference import against the new panel
   * (FR-12) — a cancelled file dialog leaves the blank panel, not a half-created document.
   */
  async function createPanel(spec: NewPanelSpec, choice: NewPanelChoice): Promise<void> {
    if (!(await controller.newPanel(spec))) return
    newPanelOpen = false
    entrySection = choice.fromPhoto ? 'draw' : undefined
    photoRequested = choice.fromPhoto
    screen = 'editor'
  }

  /**
   * Back to the library from the editor (FR-5), behind the existing unsaved-changes guard. The panel
   * just closed is recorded, so it appears in the grid with an up-to-date preview.
   */
  async function goToLibrary(): Promise<void> {
    if (!(await controller.confirmDiscardIfDirty())) return
    const path = controller.currentPath
    if (path) await library.recordOpened(path, controller.doc)
    else await library.refresh()
    screen = 'library'
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if screen === 'library'}
  <LibraryScreen
    controller={library}
    onNew={() => (newPanelOpen = true)}
    onOpenFile={openFromDialog}
    onOpenEntry={(path) => void openPath(path)}
    onOpenHistory={(path) => void openPath(path, 'history')}
    onDropFile={(file) => void openDropped(file)}
    glassCount={glassLibrary.glasses.length}
  />
{:else}
  <AppShell
    {panel}
    {controller}
    {glassLibrary}
    {versions}
    {priceBook}
    onLibrary={goToLibrary}
    {photoRequested}
    onPhotoImported={() => (photoRequested = false)}
    initialSection={entrySection}
    exportPdf={host.export ? (name, bytes) => host.export!.savePdf(name, bytes) : undefined}
    exportText={host.export ? (name, text) => host.export!.saveText(name, text) : undefined}
    exportPng={host.export ? (name, bytes) => host.export!.savePng(name, bytes) : undefined}
    importSvg={host.import ? () => host.import!.openSvg() : undefined}
    importImage={host.import?.openImage ? () => host.import!.openImage!() : undefined}
  />
{/if}
<DebugPalette {controller} />

<NewPanelDialog
  open={newPanelOpen}
  onCreate={(spec, choice) => void createPanel(spec, choice)}
  onClose={() => (newPanelOpen = false)}
  photoAvailable={!!host.import?.openImage}
/>

<style>
  :global(body) {
    margin: 0;
    font: var(--text-body);
    background: var(--surface-page);
    color: var(--text-body);
  }
</style>
