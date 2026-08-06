<script lang="ts">
  const features = [
    {
      title: 'One source of truth',
      body: 'Draw lead lines once. Pieces, cut contours and pattern sheets are derived automatically and regenerate with every edit — nothing to keep in sync by hand.',
    },
    {
      title: 'Design rule checks',
      body: 'Impossible cuts, fragile necks and structural weaknesses are flagged while you draw, with severity, location and an explanation — the way an EDA tool checks a board.',
    },
    {
      title: 'CAD discipline',
      body: 'Real-world units, precise snapping, node editing and unlimited undo. Millimetres first, inches supported.',
    },
    {
      title: 'Production outputs',
      body: 'Full-scale tiled cartoons, numbered pattern pieces, cutting lists and a bill of materials — one click away, always in sync with the design.',
    },
    {
      title: 'Glass catalog',
      body: 'Assign real glass to pieces and see the panel rendered with it. The cutting list groups pieces per sheet, with usage and cost.',
    },
    {
      title: 'Local-first',
      body: 'Designs are files on your disk. The app works fully offline — no account, no cloud, no lock-in.',
    },
  ]
</script>

<section id="features" class="container">
  <p class="eyebrow">Why Vitrum</p>
  <h2>Correct by construction, checked by rules</h2>
  <div class="grid">
    {#each features as feature (feature.title)}
      <article>
        <h3>{feature.title}</h3>
        <p>{feature.body}</p>
      </article>
    {/each}
  </div>
</section>

<style>
  section {
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
    max-width: 22em;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
  }

  article {
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    box-shadow: var(--shadow-card);
  }

  h3 {
    margin: 0 0 var(--space-3);
    font: var(--text-h3);
    color: var(--text-strong);
  }

  article p {
    margin: 0;
    font: var(--text-body);
    color: var(--text-body);
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
