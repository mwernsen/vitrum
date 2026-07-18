<script lang="ts">
  import type { ToolId } from '@vitrum/core'
  import Circle from 'lucide-svelte/icons/circle'
  import Minus from 'lucide-svelte/icons/minus'
  import MousePointer2 from 'lucide-svelte/icons/mouse-pointer-2'
  import PenTool from 'lucide-svelte/icons/pen-tool'
  import Ruler from 'lucide-svelte/icons/ruler'
  import Spline from 'lucide-svelte/icons/spline'
  import Square from 'lucide-svelte/icons/square'
  import SquareDashed from 'lucide-svelte/icons/square-dashed'
  import Triangle from 'lucide-svelte/icons/triangle'

  import IconButton from '../components/IconButton.svelte'
  import type { ToolController } from '../tools/controller.svelte'

  interface Props {
    /** The drawing-tool controller (F-011). Optional so the shell renders in isolation. */
    tools?: ToolController
  }

  let { tools }: Props = $props()

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

  const activeId = $derived(tools?.activeId ?? 'select')

  function select(id: ToolId | 'select') {
    if (id === 'select') tools?.deactivate()
    else tools?.activate(id)
  }
</script>

<div class="toolbar" role="toolbar" aria-orientation="vertical" aria-label="Tools">
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
</div>

<style>
  .toolbar {
    grid-area: tools;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--paper-50);
    border-right: 1px solid var(--border-subtle);
  }
</style>
