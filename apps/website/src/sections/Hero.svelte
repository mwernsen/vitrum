<script lang="ts">
  import { Badge } from '@vitrum/ui'

  import AppWindowMock from '../lib/AppWindowMock.svelte'
  import Cta from '../lib/Cta.svelte'
  import { GITHUB_URL } from '../links'
</script>

<section class="hero container">
  <div class="copy">
    <div class="eyebrow-row">
      <p class="eyebrow">CAD for stained glass</p>
      <Badge tone="neutral">Beta</Badge>
    </div>
    <h1>Draw the lead lines. Everything else follows.</h1>
    <p class="sub">
      Vitrum is a desktop app for designing stained glass panels with CAD discipline. The lead line
      network is the single source of truth — pieces, cut patterns, cutting lists and full-scale
      cartoons are derived from it and checked live against real manufacturability rules.
    </p>
    <div class="actions">
      <Cta href="#download" variant="accent" size="lg">Download for free</Cta>
      <Cta href={GITHUB_URL} variant="secondary" size="lg" target="_blank" rel="noreferrer">
        View on GitHub
      </Cta>
    </div>
    <p class="fine">macOS, Windows and Linux. Local-first: your designs are files you own.</p>
  </div>
  <div class="visual">
    <AppWindowMock />
  </div>
</section>

<style>
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
    align-items: center;
    gap: var(--space-16);
    padding-block: var(--space-20);
  }

  .eyebrow-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .eyebrow {
    margin: 0;
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--action-accent);
  }

  h1 {
    margin: 0 0 var(--space-6);
    font: var(--text-display);
    letter-spacing: var(--tracking-display);
    color: var(--text-strong);
  }

  .sub {
    margin: 0 0 var(--space-8);
    font: var(--text-body-lg);
    color: var(--text-body);
    max-width: 34em;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .fine {
    margin: var(--space-5) 0 0;
    font: var(--text-small);
    color: var(--text-muted);
  }

  @media (max-width: 900px) {
    .hero {
      grid-template-columns: 1fr;
      padding-block: var(--space-12);
    }

    .visual {
      max-width: 520px;
    }
  }
</style>
