<script lang="ts">
  import Check from 'lucide-svelte/icons/check'
  import Plus from 'lucide-svelte/icons/plus'
  import X from 'lucide-svelte/icons/x'

  import Badge from '../components/Badge.svelte'
  import Button from '../components/Button.svelte'
  import Card from '../components/Card.svelte'
  import Checkbox from '../components/Checkbox.svelte'
  import Dialog from '../components/Dialog.svelte'
  import IconButton from '../components/IconButton.svelte'
  import Input from '../components/Input.svelte'
  import Radio from '../components/Radio.svelte'
  import Select from '../components/Select.svelte'
  import Switch from '../components/Switch.svelte'
  import Tabs from '../components/Tabs.svelte'
  import Tag from '../components/Tag.svelte'
  import Toast from '../components/Toast.svelte'
  import Tooltip from '../components/Tooltip.svelte'

  const buttonVariants = [
    'primary',
    'secondary',
    'accent',
    'ghost',
    'inverse',
    'inverse-outline',
  ] as const
  const badgeTones = ['neutral', 'info', 'success', 'warning', 'danger', 'dark'] as const

  let checkA = $state(true)
  let checkB = $state(false)
  let unit = $state('mm')
  let toggle = $state(true)
  let tab = $state('panels')
  let panelName = $state('Rose window')
  let glass = $state('Cathedral')
  let dialogOpen = $state(false)
</script>

<div class="gallery">
  <header class="masthead">
    <p class="eyebrow">Vitrum design system</p>
    <h1>Component gallery</h1>
    <p class="lede">
      Every ported core component, for side-by-side comparison with the Claude Design specimens.
    </p>
  </header>

  <section>
    <h2>Button</h2>
    <div class="row">
      {#each buttonVariants as variant (variant)}
        <div class="on-{variant === 'inverse' || variant === 'inverse-outline' ? 'dark' : 'light'}">
          <Button {variant}>{variant}</Button>
        </div>
      {/each}
    </div>
    <div class="row">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button disabled>Disabled</Button>
      <Button variant="accent">
        {#snippet iconLeft()}<Plus size={16} />{/snippet}
        New panel
      </Button>
    </div>
  </section>

  <section>
    <h2>IconButton</h2>
    <div class="row">
      <IconButton label="Add"><Plus size={18} /></IconButton>
      <IconButton label="Confirm" variant="outline"><Check size={18} /></IconButton>
      <span class="on-dark"
        ><IconButton label="Close" variant="dark"><X size={18} /></IconButton></span
      >
      <IconButton label="Small" size="sm"><Plus size={16} /></IconButton>
      <IconButton label="Large" size="lg"><Plus size={20} /></IconButton>
    </div>
  </section>

  <section>
    <h2>Badge</h2>
    <div class="row">
      {#each badgeTones as tone (tone)}
        <Badge {tone}>{tone}</Badge>
      {/each}
    </div>
  </section>

  <section>
    <h2>Tag</h2>
    <div class="row">
      <Tag swatch="#a82430">Ruby antique</Tag>
      <Tag swatch="#1c714b" onRemove={() => {}}>Emerald cathedral</Tag>
      <Tag>No swatch</Tag>
    </div>
  </section>

  <section>
    <h2>Card</h2>
    <div class="row">
      <Card>Static card</Card>
      <Card interactive>Interactive card</Card>
      <span class="on-dark"><Card dark>Dark card</Card></span>
    </div>
  </section>

  <section>
    <h2>Checkbox · Radio · Switch</h2>
    <div class="row">
      <Checkbox label="Include in cut list" bind:checked={checkA} />
      <Checkbox label="Unchecked" bind:checked={checkB} />
      <Checkbox label="Disabled" disabled />
    </div>
    <div class="row">
      <Radio
        name="unit"
        value="mm"
        label="Millimeters"
        checked={unit === 'mm'}
        onchange={() => (unit = 'mm')}
      />
      <Radio
        name="unit"
        value="in"
        label="Inches"
        checked={unit === 'in'}
        onchange={() => (unit = 'in')}
      />
    </div>
    <div class="row">
      <Switch label="Snap to came lines" bind:checked={toggle} />
      <Switch label="Disabled" disabled />
    </div>
  </section>

  <section>
    <h2>Input · Select</h2>
    <div class="row fields">
      <Input label="Panel name" bind:value={panelName} hint="Shown on the cut list" />
      <Input label="Email" error="Enter a valid email" />
      <Select
        label="Glass type"
        options={['Cathedral', 'Opalescent', 'Flashed', 'Antique']}
        bind:value={glass}
      />
    </div>
  </section>

  <section>
    <h2>Tabs</h2>
    <Tabs
      items={[
        { label: 'Panels', value: 'panels' },
        { label: 'Cut lists', value: 'cuts' },
        { label: 'Glass', value: 'glass' },
      ]}
      bind:value={tab}
    />
    <p class="muted">Selected: {tab}</p>
  </section>

  <section>
    <h2>Tooltip</h2>
    <div class="row">
      <Tooltip label="Top"><Button variant="secondary">Top</Button></Tooltip>
      <Tooltip label="Bottom" side="bottom"><Button variant="secondary">Bottom</Button></Tooltip>
      <Tooltip label="Right" side="right"><Button variant="secondary">Right</Button></Tooltip>
    </div>
  </section>

  <section>
    <h2>Dialog</h2>
    <Button onclick={() => (dialogOpen = true)}>Open dialog</Button>
    <Dialog bind:open={dialogOpen} title="Delete panel?" onClose={() => (dialogOpen = false)}>
      This can't be undone.
      {#snippet footer()}
        <Button variant="secondary" onclick={() => (dialogOpen = false)}>Cancel</Button>
        <Button variant="accent" onclick={() => (dialogOpen = false)}>Delete</Button>
      {/snippet}
    </Dialog>
  </section>

  <section>
    <h2>Toast</h2>
    <div class="row">
      <Toast tone="info">Autosaved</Toast>
      <Toast tone="success" action="Undo" onAction={() => {}}>Cut list exported</Toast>
      <Toast tone="danger">Export failed</Toast>
    </div>
  </section>
</div>

<style>
  :global(body) {
    margin: 0;
    font: var(--text-body);
    background: var(--surface-page);
    color: var(--text-body);
  }

  .gallery {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-12) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  .masthead {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .eyebrow {
    margin: 0;
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  h1 {
    margin: 0;
    font: var(--text-h1);
    letter-spacing: var(--tracking-display);
    color: var(--text-strong);
  }

  .lede {
    margin: 0;
    font: var(--text-body-lg);
    color: var(--text-muted);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-6);
    border-top: 1px solid var(--border-subtle);
  }

  h2 {
    margin: 0;
    font: var(--text-h4);
    color: var(--text-strong);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }

  .fields {
    align-items: flex-start;
  }

  .fields :global(.field) {
    width: 220px;
  }

  .on-dark {
    display: inline-flex;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-dark);
  }

  .muted {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }
</style>
