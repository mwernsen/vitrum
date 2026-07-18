<script lang="ts">
  import Minus from 'lucide-svelte/icons/minus'
  import MousePointer2 from 'lucide-svelte/icons/mouse-pointer-2'
  import PenTool from 'lucide-svelte/icons/pen-tool'
  import Spline from 'lucide-svelte/icons/spline'
  import Square from 'lucide-svelte/icons/square'

  import IconButton from '../components/IconButton.svelte'

  // Placeholder tools until the drawing tools land (F-011). Icon component type
  // is inferred from the lucide imports.
  const tools = [
    { id: 'select', label: 'Select', icon: MousePointer2 },
    { id: 'line', label: 'Line', icon: Minus },
    { id: 'arc', label: 'Arc', icon: Spline },
    { id: 'rectangle', label: 'Rectangle', icon: Square },
    { id: 'bezier', label: 'Bézier curve', icon: PenTool },
  ]

  const activeTool = 'select'
</script>

<div class="toolbar" role="toolbar" aria-orientation="vertical" aria-label="Tools">
  {#each tools as tool (tool.id)}
    {@const Icon = tool.icon}
    <IconButton
      label={tool.label}
      variant={tool.id === activeTool ? 'outline' : 'ghost'}
      aria-pressed={tool.id === activeTool}
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
