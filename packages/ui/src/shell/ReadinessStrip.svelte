<script lang="ts">
  import Check from 'lucide-svelte/icons/check'

  interface Props {
    /** Detected pieces (F-020). Geometry is "complete" once at least one piece closes. */
    pieceCount?: number
    /** Pieces with no glass assigned (F-023). Drives the glass readiness ratio. */
    unassignedCount?: number
  }

  let { pieceCount = 0, unassignedCount = 0 }: Props = $props()

  const geometryComplete = $derived(pieceCount > 0)
  const glassAssigned = $derived(Math.max(0, pieceCount - unassignedCount))
  // Percent painted; a panel with no pieces yet reads 0 rather than NaN.
  const glassPercent = $derived(pieceCount > 0 ? Math.round((glassAssigned / pieceCount) * 100) : 0)
</script>

<div class="readiness" aria-label="Panel readiness">
  <span class="eyebrow">Panel readiness</span>
  <span class="rule" aria-hidden="true"></span>

  <!-- Geometry — live (F-020) -->
  <span class="pill" class:done={geometryComplete}>
    {#if geometryComplete}
      <span class="ic ok"><Check size={14} strokeWidth={2.4} /></span>
    {:else}
      <span class="dot" style="background:var(--paper-300)"></span>
    {/if}
    Geometry
    <span class="meta">{geometryComplete ? 'complete' : 'in progress'}</span>
  </span>

  <!-- Glass — live (F-023) -->
  <span class="pill" data-testid="glass-readiness">
    <span
      class="ring"
      style={`background:conic-gradient(var(--cobalt-600) ${glassPercent}%, var(--paper-300) 0)`}
    ></span>
    Glass
    <span class="meta">
      {glassPercent}%{#if unassignedCount > 0}
        · {unassignedCount} left{/if}
    </span>
  </span>

  <!-- Checks — placeholder until the DRC engine (F-030) lands -->
  <span
    class="pill"
    data-placeholder
    aria-disabled="true"
    title="Design rule checks arrive with F-030"
  >
    <span class="dot" style="background:var(--paper-300)"></span>
    Checks
    <span class="meta">not run yet</span>
  </span>

  <!-- Outputs — placeholder until the cartoon view (F-040) lands -->
  <span
    class="pill"
    data-placeholder
    aria-disabled="true"
    title="Manufacturing outputs arrive with F-040"
  >
    <span class="dot" style="background:var(--paper-300)"></span>
    Outputs
    <span class="meta">—</span>
  </span>

  <span class="spacer"></span>
  <span class="hint">tackle in any order</span>
</div>

<style>
  .readiness {
    grid-area: readiness;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 44px;
    padding: 0 14px;
    background: var(--paper-50);
    border-bottom: 1px solid var(--border-subtle);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .rule {
    width: 1px;
    height: 18px;
    background: var(--border-subtle);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 11px;
    border-radius: var(--radius-full);
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    font: 600 12px/1 var(--font-sans);
    color: var(--ink-800);
    white-space: nowrap;
  }

  .pill[data-placeholder] {
    opacity: 0.55;
  }

  .meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
    font-weight: 400;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: var(--radius-full);
  }

  .ring {
    width: 11px;
    height: 11px;
    border-radius: var(--radius-full);
  }

  .ic {
    display: inline-flex;
  }

  .ic.ok {
    color: var(--emerald-600);
  }

  .spacer {
    flex: 1;
  }

  .hint {
    font: 500 12px/1.4 var(--font-mono);
    color: var(--ink-500);
  }
</style>
