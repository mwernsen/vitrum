<script lang="ts">
  import { Badge } from '@vitrum/ui/components'

  import Cta from '../lib/Cta.svelte'
  import { RELEASES_LATEST_URL, RELEASES_URL } from '../links'
  import { initRelease, releaseState } from '../release.svelte'
  import { pickDeb, pickInstaller, type PlatformId } from '../releases'

  initRelease()

  const release = $derived(releaseState.release)

  /** A direct asset link once the release is known, else the releases page. */
  function link(platform: PlatformId): string {
    const assets = release?.assets
    return (assets && pickInstaller(assets, platform)?.url) || RELEASES_LATEST_URL
  }

  const debHref = $derived((release && pickDeb(release.assets)?.url) || RELEASES_LATEST_URL)

  const cards = $derived([
    {
      name: 'macOS',
      detail: 'Apple silicon · .dmg',
      href: link('mac-arm64'),
      alt: { label: 'Intel Mac', href: link('mac-x64') },
      note: 'First launch: right-click the app and choose Open. Vitrum is not yet signed with an Apple Developer ID, so macOS asks once.',
    },
    {
      name: 'Windows',
      detail: '64-bit installer · .exe',
      href: link('windows'),
      alt: null,
      note: 'First launch: SmartScreen shows "more info" — the installer is not yet code-signed.',
    },
    {
      name: 'Linux',
      detail: 'AppImage · x86_64',
      href: link('linux'),
      alt: { label: 'Debian package', href: debHref },
      note: 'Mark the AppImage executable with chmod +x before running it.',
    },
  ])
</script>

<section id="download">
  <div class="container">
    <p class="eyebrow">Download</p>
    <h2>Get Vitrum</h2>
    <p class="sub">
      Vitrum is free — a hobby should be free and fun. Installers are published on GitHub with every
      release, together with checksums and release notes.
    </p>
    <div class="beta">
      <Badge tone="neutral">Beta</Badge>
      <p>
        The core drawing, checking and output tools work, but features are still landing and you may
        hit rough edges. Back up designs that matter, and report anything that breaks.
      </p>
    </div>
    <div class="grid">
      {#each cards as card (card.name)}
        <div class="card">
          <h3>{card.name}</h3>
          <p>{card.detail}</p>
          <Cta href={card.href} variant="inverse" rel="noreferrer">Download</Cta>
          {#if card.alt}
            <a class="alt" href={card.alt.href} rel="noreferrer">{card.alt.label}</a>
          {/if}
          <p class="note">{card.note}</p>
        </div>
      {/each}
    </div>
    <p class="all-releases">
      <a href={RELEASES_URL} target="_blank" rel="noreferrer">All releases and checksums</a>
    </p>
  </div>
</section>

<style>
  section {
    background: var(--surface-dark);
    color: var(--text-inverse);
    padding-block: var(--space-24);
  }

  .eyebrow {
    margin: 0 0 var(--space-4);
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--cobalt-500);
  }

  h2 {
    margin: 0 0 var(--space-4);
    font: var(--text-h1);
    letter-spacing: var(--tracking-tight);
    color: var(--text-inverse);
  }

  .sub {
    margin: 0 0 var(--space-6);
    font: var(--text-body-lg);
    color: var(--paper-300);
    max-width: 36em;
  }

  .beta {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: 0 0 var(--space-12);
    padding: var(--space-4) var(--space-5);
    max-width: 36em;
    background: var(--surface-dark-raised);
    border: 1px solid var(--border-dark);
    border-radius: var(--radius-md);
  }

  .beta p {
    margin: 0;
    font: var(--text-small);
    color: var(--paper-300);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
  }

  .card {
    background: var(--surface-dark-raised);
    border: 1px solid var(--border-dark);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }

  h3 {
    margin: 0;
    font: var(--text-h3);
    color: var(--text-inverse);
  }

  .card p {
    margin: 0 0 var(--space-4);
    font: var(--text-small);
    font-family: var(--font-mono);
    color: var(--paper-400);
  }

  .note {
    margin: var(--space-2) 0 0;
    font: var(--text-caption);
    color: var(--paper-400);
  }

  .alt {
    font: var(--text-small);
    color: var(--paper-400);
    text-decoration: none;
    border-bottom: 1px solid var(--border-dark);
  }

  .alt:hover {
    color: var(--paper-0);
  }

  .all-releases {
    margin: var(--space-12) 0 0;
    font: var(--text-body);
  }

  .all-releases a {
    color: var(--paper-300);
  }

  .all-releases a:hover {
    color: var(--paper-0);
  }

  @media (max-width: 640px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
