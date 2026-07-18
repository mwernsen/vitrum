<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    /** Controls visibility; bindable so callers can two-way bind. Renders nothing when false. */
    open?: boolean
    /** Accessible title, shown in the header and used as the dialog's label. */
    title?: string
    /** Called when the backdrop or the close button is clicked, or Escape is pressed. */
    onClose?: () => void
    /** Optional footer region, typically holding action buttons. */
    footer?: Snippet
    /** Panel width; a number is treated as px. Defaults to 440px. */
    width?: string | number
    children?: Snippet
  }

  let { open = $bindable(false), title, onClose, footer, width = 440, children }: Props = $props()

  const titleId = 'dialog-title'

  let panelWidth = $derived(typeof width === 'number' ? `${width}px` : width)

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose?.()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') onClose?.()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={handleBackdropClick}>
    <div
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-label={title ? undefined : 'Dialog'}
      aria-labelledby={title ? titleId : undefined}
      style:width={panelWidth}
    >
      {#if title}
        <header class="head">
          <h2 id={titleId} class="title">{title}</h2>
          <button class="close" type="button" aria-label="Close" onclick={() => onClose?.()}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>
      {/if}

      <div class="body">
        {@render children?.()}
      </div>

      {#if footer}
        <footer class="foot">
          {@render footer()}
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    /* Scrim overlay — an rgba, not a hex, kept from the source. */
    background: rgba(5, 5, 5, 0.4);
  }

  .panel {
    max-width: 100%;
    max-height: calc(100vh - var(--space-12));
    display: flex;
    flex-direction: column;
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-modal);
    color: var(--text-body);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
  }

  .title {
    margin: 0;
    font: var(--text-h3);
    letter-spacing: var(--tracking-tight);
    color: var(--text-strong);
  }

  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }
  .close:hover {
    background: var(--paper-100);
    color: var(--text-strong);
  }

  .body {
    padding: var(--space-6);
    overflow-y: auto;
    font: var(--text-body);
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-subtle);
  }
</style>
