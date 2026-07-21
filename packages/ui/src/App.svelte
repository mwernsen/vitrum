<script lang="ts">
  import type { Panel } from '@vitrum/core'
  import { onMount } from 'svelte'

  import { createBrowserHost } from './document/browserHost'
  import { DocumentController } from './document/controller.svelte'
  import DebugPalette from './document/DebugPalette.svelte'
  import type { AppHost } from './document/host'
  import { GlassLibraryController } from './glass/library.svelte'
  import AppShell from './shell/AppShell.svelte'

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

  // Placeholder panel providing the inspector's name and size only. Pieces are no longer
  // mocked here — the inspector lists the *real* pieces F-020 detects from the live network
  // (F-020); named glass and lead totals arrive with F-021/F-023.
  const panel: Panel = {
    id: 'sample',
    name: 'Sample panel',
    widthMm: 300,
    heightMm: 400,
    pieces: [],
  }

  // Undo/redo and save/open are also wired to the native menu (desktop) via the host;
  // these shortcuts make them work in the browser too (F-002 scope).
  function onKeydown(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey)) return
    switch (event.key.toLowerCase()) {
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
        void controller.open()
        break
      case 'k':
        event.preventDefault()
        controller.togglePalette()
        break
    }
  }

  onMount(() => {
    void offerRecovery()
    void glassLibrary.init()
    return () => controller.dispose()
  })

  async function offerRecovery() {
    const snapshot = await host.storage.readAutosave()
    if (!snapshot) return
    const restore = host.confirmRecover ? await host.confirmRecover() : false
    if (restore) controller.recover(snapshot)
    else await host.storage.clearAutosave()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<AppShell
  {panel}
  {controller}
  {glassLibrary}
  exportPdf={host.export ? (name, bytes) => host.export!.savePdf(name, bytes) : undefined}
  exportText={host.export ? (name, text) => host.export!.saveText(name, text) : undefined}
  exportPng={host.export ? (name, bytes) => host.export!.savePng(name, bytes) : undefined}
/>
<DebugPalette {controller} />

<style>
  :global(body) {
    margin: 0;
    font: var(--text-body);
    background: var(--surface-page);
    color: var(--text-body);
  }
</style>
