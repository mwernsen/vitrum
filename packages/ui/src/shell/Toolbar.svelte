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

  import IconButton from '../components/IconButton.svelte'
  import type { ToolController } from '../tools/controller.svelte'
  import type { PaintController } from '../tools/paint.svelte'

  interface Props {
    /** The drawing-tool controller (F-011). Optional so the shell renders in isolation. */
    tools?: ToolController
    /** The paint / piece-select controller (F-023). Optional so the shell renders in isolation. */
    paint?: PaintController
  }

  let { tools, paint }: Props = $props()

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

  // A drawing/select tool is active only when the paint layer is off; picking one turns paint off.
  const activeId = $derived(paint?.active ? '' : (tools?.activeId ?? 'select'))

  function select(id: ToolId | 'select') {
    paint?.setMode('off')
    if (id === 'select') tools?.deactivate()
    else tools?.activate(id)
  }

  // Paint tools (F-023): activating one deactivates the drawing layer.
  function paintMode(mode: 'paint' | 'select') {
    tools?.deactivate()
    paint?.setMode(paint.mode === mode ? 'off' : mode)
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
</div>

<style>
  /* Floating tool palette overlaid on the canvas (Portal cockpit "2b"). The enclosing
     canvas stage is the positioned ancestor. */
  .palette {
    position: absolute;
    left: 14px;
    top: 14px;
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
