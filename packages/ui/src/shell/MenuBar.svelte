<script lang="ts">
  // Placeholder top menu. Commands become real with the document/command model
  // (F-002); for now these are inert menu items so the region is present.
  const menus = ['File', 'Edit', 'View', 'Help']
</script>

<div class="menubar" role="menubar" aria-label="Main menu">
  <span class="brand">Vitrum</span>
  {#each menus as label (label)}
    <button type="button" role="menuitem" disabled>{label}</button>
  {/each}
</div>

<style>
  .menubar {
    grid-area: menu;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.75rem;
    height: 2.25rem;
    background: #292524;
    border-bottom: 1px solid #44403c;
  }

  .brand {
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-right: 1rem;
    color: #fafaf9;
  }

  button {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button:not(:disabled):hover {
    background: #44403c;
  }
</style>
