<script lang="ts">
  // Drawing tools land in F-011; these are placeholder buttons so the toolbar
  // region exists. `Select` is shown as the active tool.
  interface Tool {
    id: string
    label: string
    glyph: string
  }

  const tools: Tool[] = [
    { id: 'select', label: 'Select', glyph: '⌖' },
    { id: 'line', label: 'Line', glyph: '╱' },
    { id: 'arc', label: 'Arc', glyph: '◜' },
    { id: 'rectangle', label: 'Rectangle', glyph: '▭' },
    { id: 'bezier', label: 'Bézier curve', glyph: '∿' },
  ]

  const activeTool = 'select'
</script>

<div class="toolbar" role="toolbar" aria-orientation="vertical" aria-label="Tools">
  {#each tools as tool (tool.id)}
    <button
      type="button"
      class="tool"
      aria-label={tool.label}
      aria-pressed={tool.id === activeTool}
      disabled={tool.id !== activeTool}
    >
      <span aria-hidden="true">{tool.glyph}</span>
    </button>
  {/each}
</div>

<style>
  .toolbar {
    grid-area: tools;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    background: #292524;
    border-right: 1px solid #44403c;
  }

  .tool {
    width: 2.5rem;
    height: 2.5rem;
    display: grid;
    place-items: center;
    font-size: 1.25rem;
    background: none;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    color: #d6d3d1;
    cursor: pointer;
  }

  .tool[aria-pressed='true'] {
    background: #1c1917;
    border-color: #3b82f6;
    color: #fafaf9;
  }

  .tool:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
