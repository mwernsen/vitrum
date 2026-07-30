<script lang="ts">
  import { formatArea, formatLength, pieceKey, type LengthUnit, type Piece } from '@vitrum/core'
  import {
    identityTextureTransform,
    type Command,
    type GlassId,
    type Glass,
    type PieceTextureTransform,
    type Project,
  } from '@vitrum/model'
  import type { Violation } from '@vitrum/drc'

  import Button from '../components/Button.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import type { AssignmentController } from '../glass/assignment.svelte'
  import type { NumberingController } from '../numbering/controller.svelte'
  import type { PaintController } from '../tools/paint.svelte'
  import { setPieceTextureTransforms } from '@vitrum/model'

  interface Props {
    pieces: readonly Piece[]
    unit: LengthUnit
    paint: PaintController
    assignments?: AssignmentController
    numbering?: NumberingController
    doc?: Project
    execute?: (command: Command) => void
    /** Set/clear a manual per-piece number override (F-040), keyed by content id. */
    onSetNumber?: (pieceContentId: string, label: string | null) => void
    /** Whether the realistic render view (F-053) is active — reveals texture placement. */
    renderActive?: boolean
    /** Active violations touching the selected piece (F-030), most severe first. */
    issues?: readonly Violation[]
    /** Apply a violation's quick fix. */
    onQuickFix?: (violation: Violation) => void
  }

  let {
    pieces,
    unit,
    paint,
    assignments,
    numbering,
    doc,
    execute,
    onSetNumber,
    renderActive = false,
    issues = [],
    onQuickFix,
  }: Props = $props()

  const selected = $derived<Piece[]>(pieces.filter((p) => paint.selectedPieces.has(pieceKey(p))))
  const single = $derived<Piece | null>(selected.length === 1 ? selected[0]! : null)

  const glasses = $derived<Glass[]>(Object.values(doc?.glasses ?? {}))
  const glassOf = (piece: Piece): Glass | undefined => {
    const id = assignments?.glassFor(piece)
    return id ? doc?.glasses[id] : undefined
  }
  const glassOptions = $derived([
    { value: '', label: 'Choose glass…' },
    ...glasses.map((g) => ({ value: g.id, label: g.name })),
  ])

  // The six most recently defined project glasses, as one-click swatches. A palette this small is
  // faster than a select for the common case of "make it the same as that one".
  const quickGlass = $derived(glasses.slice(0, 6))

  const stats = $derived.by(() => {
    if (!single) return []
    const w = single.bbox.max.x - single.bbox.min.x
    const h = single.bbox.max.y - single.bbox.min.y
    return [
      { label: 'Area', value: formatArea(single.area, unit) },
      { label: 'Perimeter', value: formatLength(single.perimeter, unit) },
      { label: 'Width', value: formatLength(w, unit) },
      { label: 'Height', value: formatLength(h, unit) },
    ]
  })

  const topIssue = $derived<Violation | null>(issues[0] ?? null)

  function textureOf(piece: Piece): PieceTextureTransform {
    return doc?.render.textureTransforms[pieceKey(piece)] ?? identityTextureTransform()
  }
  function setTexture(piece: Piece, patch: Partial<PieceTextureTransform>): void {
    execute?.(setPieceTextureTransforms({ [pieceKey(piece)]: { ...textureOf(piece), ...patch } }))
  }
</script>

{#if single}
  {@const piece = single}
  {@const glass = glassOf(piece)}
  <!-- The piece, named and coloured, so the panel and the inspector agree at a glance. -->
  <div class="hero">
    <span
      class="swatch"
      style={`background:${glass?.color ?? 'var(--paper-100)'}`}
      class:unassigned={!glass}
    ></span>
    <span class="hero-text">
      <span class="label">{numbering?.labelFor(piece) ?? 'Unnumbered'}</span>
      <span class="sub">{glass?.name ?? 'No glass assigned'}</span>
    </span>
  </div>

  <div class="stats">
    {#each stats as stat (stat.label)}
      <span class="stat">
        <span class="eyebrow">{stat.label}</span>
        <span class="stat-value">{stat.value}</span>
      </span>
    {/each}
  </div>

  {#if topIssue}
    <div class="issue" data-testid="piece-issue">
      <span class="issue-title">
        <span class="dot" class:warn={topIssue.severity !== 'error'}></span>{topIssue.title}
      </span>
      <span class="issue-msg">{topIssue.message}</span>
      {#if topIssue.quickFix && onQuickFix}
        <button class="primary" onclick={() => onQuickFix?.(topIssue)}>
          {topIssue.quickFix.label}
        </button>
      {/if}
    </div>
  {/if}

  <section class="block">
    <span class="eyebrow">Glass</span>
    {#if quickGlass.length > 0}
      <div class="swatches" role="group" aria-label="Assign glass">
        {#each quickGlass as g (g.id)}
          <button
            class="pick"
            class:on={glass?.id === g.id}
            style={`background:${g.color ?? 'var(--paper-100)'}`}
            aria-label={g.name}
            title={g.name}
            onclick={() => paint.assignSelected(g.id as GlassId)}
          ></button>
        {/each}
      </div>
    {/if}
    <Select
      size="sm"
      options={glassOptions}
      value=""
      onchange={(id) => id && paint.assignSelected(id as GlassId)}
    />
    <div class="actions">
      <Button size="sm" variant="ghost" onclick={() => paint.unassignSelected()}>Unassign</Button>
    </div>
  </section>

  {#if onSetNumber}
    <section class="block">
      <span class="eyebrow">Piece number</span>
      <Input
        size="sm"
        label="Custom number"
        value={numbering?.effectiveOverrides.get(pieceKey(piece)) ?? ''}
        onchange={(v) => onSetNumber?.(pieceKey(piece), v.trim() === '' ? null : v.trim())}
      />
    </section>
  {/if}

  {#if renderActive && execute}
    {@const tt = textureOf(piece)}
    <section class="block">
      <span class="eyebrow">Texture placement</span>
      <Input
        size="sm"
        label="Rotation (deg)"
        value={String(tt.rotationDeg)}
        onchange={(v) => setTexture(piece, { rotationDeg: Number(v) || 0 })}
      />
      <div class="pair">
        <Input
          size="sm"
          label="Offset x (mm)"
          value={String(tt.offsetXmm)}
          onchange={(v) => setTexture(piece, { offsetXmm: Number(v) || 0 })}
        />
        <Input
          size="sm"
          label="Offset y (mm)"
          value={String(tt.offsetYmm)}
          onchange={(v) => setTexture(piece, { offsetYmm: Number(v) || 0 })}
        />
      </div>
      <Input
        size="sm"
        label="Scale"
        value={String(tt.scale)}
        onchange={(v) => setTexture(piece, { scale: Math.max(0.1, Number(v) || 1) })}
      />
      <div class="actions">
        <Button
          size="sm"
          variant="ghost"
          onclick={() => execute?.(setPieceTextureTransforms({ [pieceKey(piece)]: null }))}
        >
          Reset texture
        </Button>
      </div>
    </section>
  {/if}
{:else}
  <!-- Several pieces: only the operations that make sense in bulk. -->
  <div class="hero">
    <span class="hero-text">
      <span class="label">{selected.length} pieces</span>
      <span class="sub">Paint them all in one step.</span>
    </span>
  </div>
  <section class="block">
    <span class="eyebrow">Glass</span>
    {#if quickGlass.length > 0}
      <div class="swatches" role="group" aria-label="Assign glass">
        {#each quickGlass as g (g.id)}
          <button
            class="pick"
            style={`background:${g.color ?? 'var(--paper-100)'}`}
            aria-label={g.name}
            title={g.name}
            onclick={() => paint.assignSelected(g.id as GlassId)}
          ></button>
        {/each}
      </div>
    {/if}
    <Select
      size="sm"
      options={glassOptions}
      value=""
      onchange={(id) => id && paint.assignSelected(id as GlassId)}
    />
    <div class="actions">
      <Button size="sm" variant="ghost" onclick={() => paint.unassignSelected()}>Unassign</Button>
    </div>
  </section>
{/if}

<style>
  .hero {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .swatch {
    width: 56px;
    height: 56px;
    flex: none;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--ink-900);
  }

  .swatch.unassigned {
    border-style: dashed;
    border-color: var(--border-strong);
  }

  .hero-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .label {
    font: 800 19px/1 var(--font-sans);
    letter-spacing: var(--tracking-tight);
    color: var(--ink-950);
    font-variant-numeric: tabular-nums;
  }

  .sub {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink-950);
  }

  .issue {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 12px 14px;
    padding: 11px;
    border: 1px solid var(--ruby-100);
    background: color-mix(in srgb, var(--ruby-600) 5%, var(--paper-0));
    border-radius: var(--radius-sm);
  }

  .issue-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font: 600 12.5px/1.3 var(--font-sans);
    color: var(--ink-950);
  }

  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: var(--radius-full);
    background: var(--ruby-600);
  }

  .dot.warn {
    background: var(--amber-600);
  }

  .issue-msg {
    font: var(--text-caption);
    color: var(--ink-600);
  }

  .primary {
    align-self: flex-start;
    padding: 5px 11px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--ink-950);
    color: var(--paper-0);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .pick {
    width: 30px;
    height: 30px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    cursor: pointer;
  }

  .pick.on {
    border-color: var(--ink-950);
    box-shadow: 0 0 0 2px var(--cobalt-100);
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
