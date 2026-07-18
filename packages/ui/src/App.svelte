<script lang="ts">
  import type { Panel } from '@vitrum/core'

  import AppShell from './shell/AppShell.svelte'

  // Placeholder panel until real project persistence exists (F-002).
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
</script>

<AppShell {panel} />

<style>
  :global(body) {
    margin: 0;
    font-family:
      'Inter',
      system-ui,
      -apple-system,
      sans-serif;
    background: #1c1917;
    color: #fafaf9;
  }
</style>
