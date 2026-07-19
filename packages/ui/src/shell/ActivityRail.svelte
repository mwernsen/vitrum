<script lang="ts">
  import History from 'lucide-svelte/icons/history'
  import Layers from 'lucide-svelte/icons/layers'
  import List from 'lucide-svelte/icons/list'
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
    /** Count of pieces with no glass (F-023) — surfaced as the "rules" attention badge for now. */
    attentionCount?: number
  }

  let { active, onSelect, attentionCount = 0 }: Props = $props()

  // Rail items. `section` links to a live dock section; placeholder items (versions/settings)
  // have no section and are disabled until their feature lands.
  type RailItem = {
    label: string
    icon: typeof Layers
    section?: DockSection
    /** Roadmap feature that will enable a placeholder item. */
    feature?: string
  }

  const items: RailItem[] = [
    { label: 'Layers', icon: Layers, section: 'layers' },
    { label: 'Glass', icon: SquareStack, section: 'glass' },
    { label: 'Design rules', icon: ShieldCheck, section: 'rules' },
    { label: 'Manufacturing', icon: List, section: 'make' },
    { label: 'Versions', icon: History, section: 'versions' },
  ]
</script>

<nav class="rail" aria-label="Workspace sections">
  {#each items as item (item.label)}
    {@const Icon = item.icon}
    {@const disabled = !item.section}
    <Tooltip
      label={disabled ? `${item.label} (coming with ${item.feature})` : item.label}
      side="right"
    >
      <button
        class="rail-btn"
        class:active={item.section === active}
        aria-pressed={item.section === active}
        aria-label={item.label}
        {disabled}
        onclick={() => item.section && onSelect(item.section)}
      >
        <Icon size={19} strokeWidth={1.6} />
        {#if item.section === 'rules' && attentionCount > 0}
          <span class="badge" aria-hidden="true"></span>
        {/if}
      </button>
    </Tooltip>
  {/each}

  <Tooltip label="Settings (coming soon)" side="right">
    <button class="rail-btn foot" disabled aria-label="Settings">
      <Settings size={19} strokeWidth={1.6} />
    </button>
  </Tooltip>
</nav>

<style>
  .rail {
    grid-area: rail;
    width: 52px;
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: 10px 0;
    background: var(--paper-100);
    border-right: 1px solid var(--border-subtle);
  }

  .rail-btn {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--ink-600);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .rail-btn:hover:not(:disabled) {
    background: var(--paper-200);
    color: var(--ink-800);
  }

  .rail-btn.active {
    background: var(--ink-950);
    color: var(--paper-0);
  }

  .rail-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .foot {
    margin-top: auto;
  }

  .badge {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: var(--ruby-600);
    border: 1.5px solid var(--paper-100);
  }

  .rail-btn.active .badge {
    border-color: var(--ink-950);
  }
</style>
