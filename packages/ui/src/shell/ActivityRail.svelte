<script lang="ts">
  import CircleDollarSign from 'lucide-svelte/icons/circle-dollar-sign'
  import History from 'lucide-svelte/icons/history'
  import PenTool from 'lucide-svelte/icons/pen-tool'
  import Scissors from 'lucide-svelte/icons/scissors'
  import Settings from 'lucide-svelte/icons/settings'
  import ShieldCheck from 'lucide-svelte/icons/shield-check'
  import SquareStack from 'lucide-svelte/icons/square-stack'

  import Tooltip from '../components/Tooltip.svelte'

  import type { DockSection } from './dock'

  interface Props {
    /** Which dock section is open. */
    active: DockSection
    /** Select a dock section. */
    onSelect: (section: DockSection) => void
    /** Open design-rule violations (F-030) — the count badged on "Check". */
    attentionCount?: number
  }

  let { active, onSelect, attentionCount = 0 }: Props = $props()

  // Rail items carry the *task* name, not the feature name, and repeat it under the icon: at 66px
  // there is room for the word, and a labelled rail needs no tooltip-hunting to learn.
  const items: { id: DockSection; label: string; icon: typeof PenTool }[] = [
    { id: 'draw', label: 'Draw', icon: PenTool },
    { id: 'glass', label: 'Glass', icon: SquareStack },
    { id: 'check', label: 'Check', icon: ShieldCheck },
    { id: 'make', label: 'Make', icon: Scissors },
    { id: 'cost', label: 'Cost', icon: CircleDollarSign },
    { id: 'history', label: 'History', icon: History },
  ]

  // Two digits is the honest ceiling for a rail badge; past that the count stops being scannable.
  const badge = $derived(attentionCount > 99 ? '99+' : String(attentionCount))
</script>

<nav class="rail" aria-label="Workspace sections">
  {#each items as item (item.id)}
    {@const Icon = item.icon}
    <button
      class="rail-btn"
      class:active={item.id === active}
      aria-pressed={item.id === active}
      aria-label={item.label}
      onclick={() => onSelect(item.id)}
    >
      <span class="ic">
        <Icon size={18} strokeWidth={1.6} />
        {#if item.id === 'check' && attentionCount > 0}
          <span class="badge" data-testid="check-badge">{badge}</span>
        {/if}
      </span>
      <span class="label">{item.label}</span>
    </button>
  {/each}

  <span class="spacer"></span>

  <Tooltip label="Settings (coming soon)" side="right">
    <button class="rail-btn" disabled aria-label="Settings">
      <span class="ic"><Settings size={18} strokeWidth={1.6} /></span>
      <span class="label">Settings</span>
    </button>
  </Tooltip>
</nav>

<style>
  .rail {
    grid-area: rail;
    /* 66px is the whole rail, gutters and border included — the shell has no global border-box. */
    box-sizing: border-box;
    width: 66px;
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    padding: 6px 6px 8px;
    background: var(--paper-100);
    border-right: 1px solid var(--border-subtle);
  }

  .rail-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 8px 0 7px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-600);
    cursor: pointer;
  }

  .rail-btn:hover:not(:disabled):not(.active) {
    background: var(--paper-200);
    color: var(--ink-900);
  }

  .rail-btn.active {
    background: var(--ink-950);
    color: var(--paper-0);
  }

  .rail-btn:disabled {
    color: var(--ink-500);
    cursor: not-allowed;
  }

  .ic {
    position: relative;
    display: inline-flex;
  }

  .label {
    font: 600 10px/1 var(--font-sans);
    letter-spacing: 0.01em;
  }

  .badge {
    position: absolute;
    top: -5px;
    right: -9px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: var(--radius-full);
    background: var(--ruby-600);
    color: var(--paper-0);
    font: 700 9.5px/15px var(--font-mono);
    text-align: center;
  }

  .spacer {
    flex: 1;
  }
</style>
