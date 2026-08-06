<script lang="ts">
  import Logo from '@vitrum/ui/design/Logo.svelte'
  import { GITHUB_URL, ISSUES_URL, ROADMAP_URL } from '../links'
</script>

<footer>
  <div class="container inner">
    <div class="brand">
      <Logo height={20} />
      <span>Vitrum — CAD-grade design for stained glass</span>
    </div>
    <nav aria-label="Footer">
      <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
      <a href={ROADMAP_URL} target="_blank" rel="noreferrer">Roadmap</a>
      <a href={ISSUES_URL} target="_blank" rel="noreferrer">Report an issue</a>
    </nav>
    <span class="copyright">© 2026 Vitrum</span>
  </div>
</footer>

<style>
  footer {
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-page);
    padding-block: var(--space-10);
  }

  .inner {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font: var(--text-small);
    color: var(--text-muted);
  }

  nav {
    display: flex;
    gap: var(--space-6);
    margin-left: auto;
  }

  nav a {
    font: var(--text-small);
    text-decoration: none;
    color: var(--text-body);
  }

  nav a:hover {
    color: var(--text-strong);
  }

  .copyright {
    font: var(--text-small);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  @media (max-width: 640px) {
    nav {
      margin-left: 0;
    }
  }
</style>
