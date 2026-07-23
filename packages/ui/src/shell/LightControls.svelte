<script lang="ts">
  import type { LightController } from '../light/controller.svelte'

  import LightPanel from './LightPanel.svelte'

  interface Props {
    /** The sunlight-simulation controller (F-054). */
    light: LightController
  }

  let { light }: Props = $props()
</script>

<!--
  Floating light-controls card (F-054). The sun placement, halo and photo controls live over the
  canvas stage as a floating card — shown only in the light view, so the controls and the lit stage
  always agree. `.stage` is the positioned ancestor; the card clears the canvas rulers, mirroring the
  drawing Toolbar. It reuses the LightPanel content (always in the active state here).
-->
<aside class="light-card" aria-label="Light controls">
  <header class="head">
    <span class="title">Light</span>
  </header>
  <div class="scroll">
    <LightPanel {light} lightViewActive={true} />
  </div>
</aside>

<style>
  .light-card {
    position: absolute;
    top: 34px;
    right: 34px;
    z-index: 6;
    width: 270px;
    max-height: calc(100% - 68px);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
  }

  .head {
    display: flex;
    align-items: center;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .title {
    font: var(--text-h4);
    color: var(--text-strong);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
  }
</style>
