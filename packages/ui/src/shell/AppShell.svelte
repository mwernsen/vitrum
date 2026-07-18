<script lang="ts">
  import type { Panel } from '@vitrum/core'

  import CalibrationDialog from '../canvas/CalibrationDialog.svelte'
  import { documentBounds } from '../canvas/scene'
  import { ViewportController } from '../canvas/viewport.svelte'
  import type { DocumentController } from '../document/controller.svelte'

  import Canvas from './Canvas.svelte'
  import Inspector from './Inspector.svelte'
  import StatusBar from './StatusBar.svelte'
  import Toolbar from './Toolbar.svelte'
  import TopBar from './TopBar.svelte'

  interface Props {
    panel: Panel
    /** The document controller (F-002). Optional so the shell renders in isolation tests. */
    controller?: DocumentController
  }

  let { panel, controller }: Props = $props()

  // The viewport (F-003) is independent of the document controller, so the shell always
  // owns one — tests render without a controller, the app renders with one.
  const viewport = new ViewportController()

  const segments = $derived(controller ? Object.values(controller.doc.segments) : [])
  const bounds = $derived(controller ? documentBounds(controller.doc) : null)

  let calibrationOpen = $state(false)
</script>

<div class="shell">
  <TopBar title={panel.name} {controller} onZoomFit={() => viewport.zoomToFit(bounds)} />
  <Toolbar />
  <Canvas {viewport} {segments} {bounds} />
  <Inspector {panel} unit={viewport.unit} />
  <StatusBar
    {viewport}
    onfit={() => viewport.zoomToFit(bounds)}
    oncalibrate={() => (calibrationOpen = true)}
  />
</div>

<CalibrationDialog
  bind:open={calibrationOpen}
  {viewport}
  onClose={() => (calibrationOpen = false)}
/>

<style>
  .shell {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      'menu menu menu'
      'tools canvas inspector'
      'status status status';
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }
</style>
