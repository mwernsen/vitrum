<script lang="ts">
  import type { LengthUnit, Panel } from '@vitrum/core'

  import Canvas from './Canvas.svelte'
  import Inspector from './Inspector.svelte'
  import StatusBar from './StatusBar.svelte'
  import Toolbar from './Toolbar.svelte'
  import TopBar from './TopBar.svelte'

  interface Props {
    panel: Panel
  }

  let { panel }: Props = $props()

  // Shell-level UI state. Real document/viewport state arrives with F-002/F-003;
  // for now the cursor position and display unit are enough to make the four
  // regions functional and testable.
  let unit = $state<LengthUnit>('mm')
  let cursor = $state<{ x: number; y: number } | null>(null)

  function toggleUnit() {
    unit = unit === 'mm' ? 'in' : 'mm'
  }
</script>

<div class="shell">
  <TopBar title={panel.name} />
  <Toolbar />
  <Canvas onmove={(position) => (cursor = position)} onleave={() => (cursor = null)} />
  <Inspector {panel} {unit} />
  <StatusBar {cursor} {unit} ontoggleunit={toggleUnit} />
</div>

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
