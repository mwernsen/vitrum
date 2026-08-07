<script lang="ts">
  import { Badge } from '@vitrum/ui/components'

  import editorDesign from '../assets/editor-design.webp'
  import Cta from '../lib/Cta.svelte'
  import { GITHUB_URL } from '../links'
  import { initRelease, releaseState } from '../release.svelte'
  import { downloadHref, PLATFORM_LABELS } from '../releases'

  initRelease()

  const platform = $derived(releaseState.platform)
  const href = $derived(downloadHref(releaseState.release, platform))
  // Until the lookup settles, or on a platform we ship nothing for, the button
  // stays honest and sends people to the picker below rather than a guess.
  const isDirect = $derived(
    releaseState.settled && releaseState.release !== null && platform !== null,
  )
  // Only name the platform when the button really is that file; otherwise it just
  // scrolls to the picker and a specific promise would be a lie.
  const label = $derived(
    isDirect && platform ? `Download for ${PLATFORM_LABELS[platform]}` : 'Download for free',
  )
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
      <Cta href={isDirect ? href : '#download'} variant="accent" size="lg">{label}</Cta>
      <Cta href={GITHUB_URL} variant="secondary" size="lg" target="_blank" rel="noreferrer">
        View on GitHub
      </Cta>
    </div>
    <p class="fine">
      {#if isDirect}
        Version {releaseState.release?.version} · free · <a href="#download">other platforms</a>
      {:else}
        macOS, Windows and Linux. Local-first: your designs are files you own.
      {/if}
    </p>
  </div>
  <div class="visual">
    <img
      src={editorDesign}
      width="1200"
      height="750"
      alt="The Vitrum editor in design view: a stained glass panel on a millimetre grid, with drawing
           tools and snapping options at the left, and a panel inspector at the right reporting eight
           pieces, 0.060 m² of glass, 2144.9 mm of lead came and a 702 g weight."
    />
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

  /* A real capture of the editor, so the frame is only a border and a lift off
     the page — the app draws its own chrome. */
  .visual img {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
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
