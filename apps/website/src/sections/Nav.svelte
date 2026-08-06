<script lang="ts">
  import Logo from '@vitrum/ui/design/Logo.svelte'
  import Cta from '../lib/Cta.svelte'
  import { GITHUB_URL } from '../links'
</script>

<header>
  <nav class="container" aria-label="Site">
    <a class="brand" href="#top">
      <Logo height={24} />
      <span class="wordmark">Vitrum</span>
    </a>
    <div class="links">
      <a href="#features">Features</a>
      <a href="#workflow">Workflow</a>
      <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
    </div>
    <Cta href="#download" variant="primary" size="sm">Download</Cta>
  </nav>
</header>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(250, 250, 248, 0.85);
    backdrop-filter: var(--blur-glass);
    border-bottom: 1px solid var(--border-subtle);
  }

  nav {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    height: 56px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--text-strong);
  }

  .wordmark {
    font: var(--text-h4);
    letter-spacing: var(--tracking-tight);
  }

  .links {
    display: flex;
    gap: var(--space-6);
    margin-left: auto;
  }

  .links a {
    font: var(--text-small);
    font-weight: 500;
    text-decoration: none;
    color: var(--text-body);
  }

  .links a:hover {
    color: var(--text-strong);
  }

  @media (max-width: 640px) {
    .links {
      display: none;
    }

    nav {
      justify-content: space-between;
    }
  }
</style>
