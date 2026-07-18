<script lang="ts">
  import type { Panel } from '@vitrum/core'
  import { onMount } from 'svelte'

  import { createBrowserHost } from './document/browserHost'
  import { DocumentController } from './document/controller.svelte'
  import DebugPalette from './document/DebugPalette.svelte'
  import type { AppHost } from './document/host'
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

  // Placeholder panel for the canvas/inspector until F-003 renders the real document.
  // F-002 owns the document model, command/undo machinery and persistence; wiring the
  // viewport to draw `controller.doc` is F-003.
  const panel: Panel = {
    id: 'sample',
    name: 'Sample panel',
    widthMm: 300,
    heightMm: 400,
    pieces: [
      {
        id: 'sky',
        label: 'Sky',
        color: '#3b82f6',
        vertices: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
          { x: 300, y: 150 },
          { x: 0, y: 150 },
        ],
      },
      {
        id: 'hill',
        label: 'Hill',
        color: '#16a34a',
        vertices: [
          { x: 0, y: 150 },
          { x: 300, y: 150 },
          { x: 150, y: 400 },
        ],
      },
      {
        id: 'sun',
        label: 'Sun',
        color: '#f59e0b',
        vertices: [
          { x: 200, y: 40 },
          { x: 260, y: 40 },
          { x: 260, y: 100 },
          { x: 200, y: 100 },
        ],
      },
    ],
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

<AppShell {panel} {controller} />
<DebugPalette {controller} />

<style>
  :global(body) {
    margin: 0;
    font: var(--text-body);
    background: var(--surface-page);
    color: var(--text-body);
  }
</style>
