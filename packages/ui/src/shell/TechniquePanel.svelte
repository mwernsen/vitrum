<script lang="ts">
  import { formatFractionalInch } from '@vitrum/core'
  import {
    newCameProfileId,
    removeCameProfile,
    setTechniqueKind,
    updateFoilSettings,
    updateLeadSettings,
    upsertCameProfile,
    type Command,
    type SolderFinish,
    type TechniqueSettings,
  } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import IconButton from '../components/IconButton.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import Tabs from '../components/Tabs.svelte'

  interface Props {
    technique: TechniqueSettings
    execute: (command: Command) => void
  }

  let { technique, execute }: Props = $props()

  const profiles = $derived(Object.values(technique.lead.profiles))
  const profileOptions = $derived(profiles.map((p) => ({ value: p.id, label: p.name })))

  const finishOptions: { value: SolderFinish; label: string }[] = [
    { value: 'silver', label: 'Silver' },
    { value: 'copper', label: 'Copper' },
    { value: 'black', label: 'Black patina' },
  ]

  function num(text: string): number | null {
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }

  function setHeart(id: string, text: string): void {
    const profile = technique.lead.profiles[id]
    const v = num(text)
    if (!profile || v === null || v < 0) return
    execute(upsertCameProfile({ ...profile, heartMm: v }))
  }

  function setFlange(id: string, text: string): void {
    const profile = technique.lead.profiles[id]
    const v = num(text)
    if (!profile || v === null || v < 0) return
    execute(upsertCameProfile({ ...profile, flangeMm: v }))
  }

  function addProfile(): void {
    const n = profiles.length + 1
    execute(
      upsertCameProfile({
        id: newCameProfileId(),
        name: `Came ${n}`,
        kind: 'H',
        flangeMm: 6,
        heartMm: 1.6,
      }),
    )
  }

  function setTolerance(text: string): void {
    const v = num(text)
    if (v === null || v < 0) return
    execute(updateLeadSettings({ cuttingToleranceMm: v }))
  }

  function setFoilWidth(text: string): void {
    const v = num(text)
    if (v === null || v <= 0) return
    execute(updateFoilSettings({ foilWidthMm: v }))
  }

  function setPieceGap(text: string): void {
    const v = num(text)
    if (v === null || v < 0) return
    execute(updateFoilSettings({ pieceGapMm: v }))
  }
</script>

<h3>Technique</h3>
<Tabs
  size="sm"
  items={[
    { value: 'lead', label: 'Lead came' },
    { value: 'foil', label: 'Copper foil' },
  ]}
  value={technique.kind}
  onchange={(v) => execute(setTechniqueKind(v as 'lead' | 'foil'))}
/>

{#if technique.kind === 'lead'}
  <div class="fields">
    <Select
      size="sm"
      label="Default came"
      options={profileOptions}
      value={technique.lead.defaultProfileId}
      onchange={(v) => execute(updateLeadSettings({ defaultProfileId: v }))}
    />
    <Input
      size="sm"
      label="Cutting tolerance (mm)"
      value={String(technique.lead.cuttingToleranceMm)}
      onchange={setTolerance}
    />
  </div>

  <h4>Came library</h4>
  <ul class="library">
    {#each profiles as profile (profile.id)}
      <li class="came">
        <div class="came-head">
          <span class="came-name">{profile.name}</span>
          <span class="came-kind">{profile.kind}</span>
          <IconButton
            size="sm"
            variant="ghost"
            label={`Remove ${profile.name}`}
            disabled={profile.id === technique.lead.defaultProfileId}
            onclick={() => execute(removeCameProfile(profile.id))}
          >
            ×
          </IconButton>
        </div>
        <div class="row">
          <Input
            size="sm"
            label="Flange"
            value={String(profile.flangeMm)}
            onchange={(v) => setFlange(profile.id, v)}
          />
          <Input
            size="sm"
            label="Heart"
            value={String(profile.heartMm)}
            onchange={(v) => setHeart(profile.id, v)}
          />
        </div>
      </li>
    {/each}
  </ul>
  <Button size="sm" variant="secondary" onclick={addProfile}>Add came</Button>
{:else}
  <div class="fields">
    <Input
      size="sm"
      label="Foil width (mm)"
      value={String(technique.foil.foilWidthMm)}
      onchange={setFoilWidth}
    />
    <p class="hint">≈ {formatFractionalInch(technique.foil.foilWidthMm)} as sold</p>
    <Input
      size="sm"
      label="Piece gap (mm)"
      value={String(technique.foil.pieceGapMm)}
      onchange={setPieceGap}
    />
    <Select
      size="sm"
      label="Solder finish"
      options={finishOptions}
      value={technique.foil.solderFinish}
      onchange={(v) => execute(updateFoilSettings({ solderFinish: v as SolderFinish }))}
    />
  </div>
{/if}

<style>
  h3 {
    margin: var(--space-5) 0 var(--space-2);
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  h4 {
    margin: var(--space-3) 0 var(--space-2);
    font: var(--text-small);
    color: var(--text-muted);
  }

  .fields {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .library {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .came {
    padding: var(--space-2);
    background: var(--surface-sunken);
    border-radius: var(--radius-xs);
    display: grid;
    gap: var(--space-2);
  }

  .came-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .came-name {
    flex: 1;
    font: var(--text-small);
    color: var(--text-strong);
  }

  .came-kind {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .hint {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
