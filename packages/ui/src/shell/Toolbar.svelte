<script lang="ts">
  import type { ToolId } from '@vitrum/core'
  import Circle from 'lucide-svelte/icons/circle'
  import Minus from 'lucide-svelte/icons/minus'
  import MousePointer2 from 'lucide-svelte/icons/mouse-pointer-2'
  import PaintBucket from 'lucide-svelte/icons/paint-bucket'
  import PenTool from 'lucide-svelte/icons/pen-tool'
  import Ruler from 'lucide-svelte/icons/ruler'
  import Shapes from 'lucide-svelte/icons/shapes'
  import Spline from 'lucide-svelte/icons/spline'
  import Square from 'lucide-svelte/icons/square'
  import SquareDashed from 'lucide-svelte/icons/square-dashed'
  import Triangle from 'lucide-svelte/icons/triangle'
  import Wrench from 'lucide-svelte/icons/wrench'

  import IconButton from '../components/IconButton.svelte'
  import type { ToolController } from '../tools/controller.svelte'
  import type { PaintController } from '../tools/paint.svelte'
  import type { ReinforcementController } from '../tools/reinforcement.svelte'

  interface Props {
    /** The drawing-tool controller (F-011). Optional so the shell renders in isolation. */
    tools?: ToolController
    /** The paint / piece-select controller (F-023). Optional so the shell renders in isolation. */
    paint?: PaintController
    /** The reinforcement-bar controller (F-032). Optional so the shell renders in isolation. */
    reinforce?: ReinforcementController
  }

  let { tools, paint, reinforce }: Props = $props()

  // The palette and their single-key shortcuts (F-011). The border tool has no single-key
  // shortcut (the resolved set is L/A/B/R/C/P), so it is toolbar-only.
  const items: { id: ToolId | 'select'; label: string; key: string; icon: typeof Minus }[] = [
    { id: 'select', label: 'Select', key: 'Esc', icon: MousePointer2 },
    { id: 'line', label: 'Line', key: 'L', icon: Minus },
    { id: 'arc', label: 'Arc', key: 'A', icon: Spline },
    { id: 'bezier', label: 'Bézier curve', key: 'B', icon: PenTool },
    { id: 'rectangle', label: 'Rectangle', key: 'R', icon: Square },
    { id: 'circle', label: 'Circle or ellipse', key: 'C', icon: Circle },
    { id: 'polygon', label: 'Regular polygon', key: 'P', icon: Triangle },
    { id: 'border', label: 'Panel border', key: '', icon: SquareDashed },
    { id: 'guide', label: 'Construction guide', key: 'G', icon: Ruler },
  ]

  // A drawing/select tool is active only when the paint and bar layers are off.
  const activeId = $derived(paint?.active || reinforce?.active ? '' : (tools?.activeId ?? 'select'))

  function select(id: ToolId | 'select') {
    paint?.setMode('off')
    reinforce?.setMode('off')
    if (id === 'select') tools?.deactivate()
    else tools?.activate(id)
  }

  // Paint tools (F-023): activating one deactivates the drawing and bar layers.
  function paintMode(mode: 'paint' | 'select') {
    tools?.deactivate()
    reinforce?.setMode('off')
    paint?.setMode(paint.mode === mode ? 'off' : mode)
  }

  // Reinforcement bars (F-032): activating deactivates the drawing and paint layers.
  function barMode() {
    tools?.deactivate()
    paint?.setMode('off')
    reinforce?.setMode(reinforce.mode === 'draw' ? 'off' : 'draw')
  }
</script>

<div class="palette" role="toolbar" aria-orientation="vertical" aria-label="Tools">
  {#each items as tool (tool.id)}
    {@const Icon = tool.icon}
    <IconButton
      label={tool.key ? `${tool.label} (${tool.key})` : tool.label}
      variant={tool.id === activeId ? 'outline' : 'ghost'}
      aria-pressed={tool.id === activeId}
      onclick={() => select(tool.id)}
    >
      <Icon size={18} />
    </IconButton>
  {/each}

  {#if paint}
    <div class="divider" aria-hidden="true"></div>
    <IconButton
      label="Paint glass"
      variant={paint.mode === 'paint' ? 'outline' : 'ghost'}
      aria-pressed={paint.mode === 'paint'}
      onclick={() => paintMode('paint')}
    >
      <PaintBucket size={18} />
    </IconButton>
    <IconButton
      label="Select pieces"
      variant={paint.mode === 'select' ? 'outline' : 'ghost'}
      aria-pressed={paint.mode === 'select'}
      onclick={() => paintMode('select')}
    >
      <Shapes size={18} />
    </IconButton>
  {/if}

  {#if reinforce}
    <div class="divider" aria-hidden="true"></div>
    <IconButton
      label="Reinforcement bar"
      variant={reinforce.mode === 'draw' ? 'outline' : 'ghost'}
      aria-pressed={reinforce.mode === 'draw'}
      onclick={() => barMode()}
    >
      <Wrench size={18} />
    </IconButton>
  {/if}
</div>

<style>
  /* Floating tool palette overlaid on the canvas (Portal cockpit). The enclosing canvas stage
     is the positioned ancestor. Offset clears the canvas rulers (RULER_SIZE = 22px) so the
     palette floats over the drawing area, not the ruler strips. */
  .palette {
    position: absolute;
    left: 34px;
    top: 34px;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 5px;
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
  }

  .divider {
    height: 1px;
    margin: 2px 4px;
    background: var(--border-subtle);
  }
</style>
