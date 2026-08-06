<script lang="ts">
  import PanelArt from './PanelArt.svelte'
</script>

<!-- Illustrative mock of the Vitrum editor window, per the studio chrome. -->
<div class="window" aria-hidden="true">
  <div class="topbar">
    <span class="dots">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </span>
    <span class="doc-name">rose-window.vitrum</span>
    <span class="units">mm</span>
  </div>
  <div class="body">
    <div class="ruler">
      <span>0</span><span>100</span><span>200</span><span>300</span><span>400</span>
    </div>
    <div class="canvas">
      <div class="panel">
        <PanelArt />
      </div>
      <div class="drc-chip">
        <span class="drc-dot"></span>
        <span class="drc-label">DRC</span>
        <span class="drc-count">0 violations</span>
      </div>
      <div class="dim-chip">312 × 408 mm</div>
    </div>
  </div>
</div>

<style>
  .window {
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 56px;
    padding-inline: var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--paper-0);
  }

  .dots {
    display: inline-flex;
    gap: var(--space-2);
  }

  .dot {
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-full);
    background: var(--paper-300);
  }

  .doc-name {
    flex: 1;
    text-align: center;
    font: var(--text-caption);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .units {
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .body {
    position: relative;
  }

  .ruler {
    display: flex;
    justify-content: space-between;
    padding: var(--space-1) var(--space-4);
    background: var(--surface-sunken);
    border-bottom: 1px solid var(--border-subtle);
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--paper-400);
  }

  .canvas {
    position: relative;
    padding: var(--space-8) var(--space-12);
    background:
      linear-gradient(var(--paper-200) 1px, transparent 1px),
      linear-gradient(90deg, var(--paper-200) 1px, transparent 1px), var(--paper-100);
    background-size: 24px 24px;
  }

  .panel {
    max-width: 300px;
    margin-inline: auto;
    filter: drop-shadow(0 8px 20px rgba(5, 5, 5, 0.14));
  }

  .drc-chip {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-card);
  }

  .drc-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--success-600);
  }

  .drc-label {
    font: var(--text-eyebrow);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .drc-count {
    font: var(--text-caption);
    font-family: var(--font-mono);
    color: var(--text-strong);
  }

  .dim-chip {
    position: absolute;
    bottom: var(--space-4);
    left: var(--space-4);
    padding: var(--space-1) var(--space-3);
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-card);
    font: var(--text-caption);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
</style>
