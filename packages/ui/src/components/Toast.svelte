<script lang="ts" module>
  export type ToastTone = 'info' | 'success' | 'danger'
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    tone?: ToastTone
    /** Optional inline action label (e.g. "Undo"). */
    action?: string
    onAction?: () => void
    children?: Snippet
  }

  let { tone = 'info', action, onAction, children }: Props = $props()
</script>

<div class="toast" role="status">
  {#if tone === 'success'}
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--emerald-600)"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <path d="m9 11 3 3L22 4"></path>
    </svg>
  {:else if tone === 'danger'}
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--ruby-600)"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 8v4M12 16h.01"></path>
    </svg>
  {:else}
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--cobalt-600)"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 16v-4M12 8h.01"></path>
    </svg>
  {/if}
  <span class="msg">{@render children?.()}</span>
  {#if action}
    <button class="action" type="button" onclick={() => onAction?.()}>{action}</button>
  {/if}
</div>

<style>
  .toast {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: var(--ink-950);
    color: var(--text-inverse);
    font: var(--text-small);
    font-weight: 500;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
  }

  .icon {
    width: 16px;
    height: 16px;
    flex: none;
  }

  .action {
    background: none;
    border: none;
    /* Source uses a light cobalt tint (#9db6f5); nearest token on dark. */
    color: var(--cobalt-100);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    margin-left: 4px;
  }
</style>
