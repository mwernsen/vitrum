<script lang="ts">
  const steps = [
    {
      number: '01',
      title: 'Draw',
      body: 'Sketch the lead line network with lines, arcs and béziers. Snapping and construction guides keep every joint exact.',
    },
    {
      number: '02',
      title: 'Check',
      body: 'The design rule checker validates every piece for cuttability and the panel for structural integrity, live.',
    },
    {
      number: '03',
      title: 'Build',
      body: 'Print the cartoon at 1:1 across tiled pages, cut from numbered patterns, and work through the cutting list.',
    },
  ]
</script>

<section id="workflow">
  <div class="container">
    <p class="eyebrow">Workflow</p>
    <h2>From sketch to workbench</h2>
    <ol>
      {#each steps as step (step.number)}
        <li>
          <span class="number">{step.number}</span>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </li>
      {/each}
    </ol>
  </div>
</section>

<style>
  section {
    background: var(--surface-sunken);
    border-block: 1px solid var(--border-subtle);
    padding-block: var(--space-24);
  }

  .eyebrow {
    margin: 0 0 var(--space-4);
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--action-accent);
  }

  h2 {
    margin: 0 0 var(--space-12);
    font: var(--text-h1);
    letter-spacing: var(--tracking-tight);
    color: var(--text-strong);
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-12);
  }

  .number {
    display: inline-block;
    margin-bottom: var(--space-4);
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
  }

  h3 {
    margin: 0 0 var(--space-3);
    font: var(--text-h3);
    color: var(--text-strong);
  }

  li p {
    margin: 0;
    font: var(--text-body);
  }

  @media (max-width: 640px) {
    ol {
      grid-template-columns: 1fr;
      gap: var(--space-8);
    }
  }
</style>
