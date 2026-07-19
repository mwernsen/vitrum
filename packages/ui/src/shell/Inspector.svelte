<script lang="ts">
  import {
    convertLength,
    formatLength,
    pieceKey,
    resolveCame,
    toMillimetres,
    type LengthUnit,
    type Panel,
    type Piece,
  } from '@vitrum/core'
  import { curveLength, vec2 } from '@vitrum/geometry'
  import {
    geometryEndpoints,
    setCameOverride,
    type Command,
    type GlassId,
    type Project,
    type Segment,
  } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import type { AssignmentController } from '../glass/assignment.svelte'
  import type { EditController } from '../tools/edit.svelte'
  import type { PaintController } from '../tools/paint.svelte'
  import type { SelectionController } from '../tools/selection.svelte'

  import TechniquePanel from './TechniquePanel.svelte'

  interface Props {
    panel: Panel
    unit: LengthUnit
    /** Editing controller (F-013). Absent ⇒ inspector shows the panel summary only. */
    edit?: EditController
    /** Selection model (F-013). */
    selection?: SelectionController
    /** The paint / piece-select controller (F-023). */
    paint?: PaintController
    /** The glass assignment resolver (F-023). */
    assignments?: AssignmentController
    /** The current document, for reading selected geometry. */
    doc?: Project
    /** Detected pieces (F-020), derived from the live network. */
    pieces?: readonly Piece[]
    /** Command sink (F-021 technique edits). Absent ⇒ technique panel is read-only/hidden. */
    execute?: (command: Command) => void
  }

  let {
    panel,
    unit,
    edit,
    selection,
    paint,
    assignments,
    doc,
    pieces = [],
    execute,
  }: Props = $props()

  // Pieces selected in piece-select mode (F-023), resolved from their content keys.
  const selectedPieceList = $derived<Piece[]>(
    paint ? pieces.filter((p) => paint.selectedPieces.has(pieceKey(p))) : [],
  )
  const glassName = (piece: Piece): string => {
    const id = assignments?.glassFor(piece)
    return (id && doc?.glasses[id]?.name) || 'Unassigned'
  }
  const glassOptions = $derived([
    { value: '', label: 'Choose glass…' },
    ...Object.values(doc?.glasses ?? {}).map((g) => ({ value: g.id, label: g.name })),
  ])
  function assignToSelection(glassId: string): void {
    if (glassId) paint?.assignSelected(glassId as GlassId)
  }

  const width = $derived(formatLength(panel.widthMm, unit))
  const height = $derived(formatLength(panel.heightMm, unit))

  /** Piece area in the active unit's squared measure (mm → cm², in → in²). */
  function formatArea(mm2: number): string {
    return unit === 'in' ? `${(mm2 / 645.16).toFixed(2)} in²` : `${(mm2 / 100).toFixed(1)} cm²`
  }

  const selectedIds = $derived(selection ? [...selection.selected] : [])
  const selectedSegments = $derived<Segment[]>(
    doc ? selectedIds.map((id) => doc!.segments[id]).filter((s): s is Segment => !!s) : [],
  )
  const single = $derived<Segment | null>(
    selectedSegments.length === 1 ? selectedSegments[0]! : null,
  )

  // Display a mm value in the active unit as a plain, trimmed number string (FR-5: the number
  // the user types round-trips exactly, since editing converts straight back to mm).
  function show(mm: number): string {
    return String(Number(convertLength(mm, unit).toFixed(4)))
  }
  function toMm(text: string): number | null {
    const n = Number(text)
    return Number.isFinite(n) ? toMillimetres(n, unit) : null
  }

  const ends = $derived(single ? geometryEndpoints(single.geometry) : null)
  const isLine = $derived(single?.geometry.kind === 'line')
  const lengthMm = $derived(single ? curveLength(single.geometry) : 0)
  const angleDeg = $derived.by(() => {
    if (!ends) return 0
    return (Math.atan2(ends[1].y - ends[0].y, ends[1].x - ends[0].x) * 180) / Math.PI
  })

  const bboxSize = $derived.by(() => {
    if (selectedSegments.length === 0) return null
    const b = edit?.selectionBBox
    return b ? { w: b.max.x - b.min.x, h: b.max.y - b.min.y } : null
  })

  function setEnd(which: 0 | 1, axis: 'x' | 'y', text: string): void {
    if (!edit || !single || !ends) return
    const mm = toMm(text)
    if (mm === null) return
    const cur = ends[which]
    edit.setEndpoint(single.id, which, axis === 'x' ? vec2(mm, cur.y) : vec2(cur.x, mm))
  }

  function setLength(text: string): void {
    if (!edit || !single || !ends) return
    const mm = toMm(text)
    if (mm === null || mm <= 0) return
    const a = ends[0]
    const rad = (angleDeg * Math.PI) / 180
    edit.setEndpoint(single.id, 1, vec2(a.x + Math.cos(rad) * mm, a.y + Math.sin(rad) * mm))
  }

  function setAngle(text: string): void {
    if (!edit || !single || !ends) return
    const deg = Number(text)
    if (!Number.isFinite(deg)) return
    const a = ends[0]
    const rad = (deg * Math.PI) / 180
    edit.setEndpoint(
      single.id,
      1,
      vec2(a.x + Math.cos(rad) * lengthMm, a.y + Math.sin(rad) * lengthMm),
    )
  }

  // Per-segment came override (F-021), shown for a single selected segment in lead mode.
  const leadMode = $derived(doc?.technique.kind === 'lead')
  const cameOptions = $derived(
    doc
      ? [
          {
            value: '',
            label: `Default (${doc.technique.lead.profiles[doc.technique.lead.defaultProfileId]?.name ?? '—'})`,
          },
          ...Object.values(doc.technique.lead.profiles).map((p) => ({
            value: p.id,
            label: p.name,
          })),
        ]
      : [],
  )
  const cameOverrideValue = $derived(
    single && doc ? (doc.technique.lead.overrides[single.id]?.profileId ?? '') : '',
  )
  const effectiveCame = $derived(single && doc ? resolveCame(doc.technique, single.id) : null)

  function setSegmentCame(profileId: string): void {
    if (!execute || !single) return
    execute(setCameOverride(single.id, profileId === '' ? null : { profileId }))
  }
</script>

<aside class="inspector" aria-label="Inspector">
  {#if paint && selectedPieceList.length > 0}
    <h2>{selectedPieceList.length === 1 ? 'Piece' : `${selectedPieceList.length} pieces`}</h2>

    {#if selectedPieceList.length === 1}
      {@const piece = selectedPieceList[0]!}
      <dl class="props">
        <div>
          <dt>Glass</dt>
          <dd>{glassName(piece)}</dd>
        </div>
        <div>
          <dt>Number</dt>
          <dd>—</dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>{formatArea(piece.area)}</dd>
        </div>
        <div>
          <dt>Perimeter</dt>
          <dd>{formatLength(piece.perimeter, unit)}</dd>
        </div>
      </dl>
    {/if}

    <h3>Assign glass</h3>
    <div class="fields">
      <Select size="sm" options={glassOptions} value="" onchange={assignToSelection} />
      <div class="actions">
        <Button size="sm" variant="ghost" onclick={() => paint.unassignSelected()}>Unassign</Button>
      </div>
    </div>
  {:else if edit && selection && selectedSegments.length > 0}
    <h2>{single ? 'Segment' : `${selectedSegments.length} selected`}</h2>

    {#if single && ends}
      <div class="fields">
        <div class="row">
          <Input
            size="sm"
            label="Start x"
            value={show(ends[0].x)}
            onchange={(v) => setEnd(0, 'x', v)}
          />
          <Input
            size="sm"
            label="Start y"
            value={show(ends[0].y)}
            onchange={(v) => setEnd(0, 'y', v)}
          />
        </div>
        <div class="row">
          <Input
            size="sm"
            label="End x"
            value={show(ends[1].x)}
            onchange={(v) => setEnd(1, 'x', v)}
          />
          <Input
            size="sm"
            label="End y"
            value={show(ends[1].y)}
            onchange={(v) => setEnd(1, 'y', v)}
          />
        </div>
        {#if isLine}
          <div class="row">
            <Input size="sm" label="Length" value={show(lengthMm)} onchange={setLength} />
            <Input
              size="sm"
              label="Angle"
              value={String(Number(angleDeg.toFixed(3)))}
              onchange={setAngle}
            />
          </div>
        {:else}
          <dl class="props">
            <div>
              <dt>Length</dt>
              <dd>{formatLength(lengthMm, unit)}</dd>
            </div>
          </dl>
        {/if}
      </div>
    {:else}
      <dl class="props">
        <div>
          <dt>Segments</dt>
          <dd>{selectedSegments.length}</dd>
        </div>
        {#if bboxSize}
          <div>
            <dt>Size</dt>
            <dd>{show(bboxSize.w)} × {show(bboxSize.h)}</dd>
          </div>
        {/if}
      </dl>
    {/if}

    {#if single && leadMode && doc && execute}
      <h3>Came</h3>
      <div class="fields">
        <Select
          size="sm"
          label="Came on this line"
          options={cameOptions}
          value={cameOverrideValue}
          onchange={setSegmentCame}
        />
        {#if effectiveCame}
          <dl class="props">
            <div>
              <dt>Heart</dt>
              <dd>{effectiveCame.heartMm} mm</dd>
            </div>
            <div>
              <dt>Flange</dt>
              <dd>{effectiveCame.flangeMm} mm</dd>
            </div>
          </dl>
        {/if}
      </div>
    {/if}

    <h3>Transform</h3>
    <div class="actions">
      <Button size="sm" variant="secondary" onclick={() => edit.mirror('horizontal')}>
        Mirror horizontal
      </Button>
      <Button size="sm" variant="secondary" onclick={() => edit.mirror('vertical')}>
        Mirror vertical
      </Button>
      <Button size="sm" variant="secondary" onclick={() => edit.rotateBy(90)}>Rotate 90°</Button>
      <Button size="sm" variant="secondary" onclick={() => edit.duplicate()}>Duplicate</Button>
    </div>
    <div class="actions">
      <Button size="sm" variant="ghost" onclick={() => edit.deleteSelection()}>Delete</Button>
    </div>
  {:else}
    <h2>{panel.name}</h2>
    <dl class="props">
      <div>
        <dt>Size</dt>
        <dd>{width} × {height}</dd>
      </div>
      <div>
        <dt>Pieces</dt>
        <dd data-testid="inspector-piece-count">{pieces.length}</dd>
      </div>
    </dl>

    {#if doc && execute}
      <TechniquePanel technique={doc.technique} {execute} />
    {/if}

    <h3>Pieces</h3>
    {#if pieces.length === 0}
      <p class="empty">Draw a closed region to detect a piece.</p>
    {:else}
      <ul>
        {#each pieces as piece (piece.id)}
          <li class="piece">
            <span class="pid">{piece.id}</span>
            <span class="pmeta">
              {formatArea(piece.area)} · {formatLength(piece.perimeter, unit)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</aside>

<style>
  .inspector {
    grid-area: inspector;
    flex: none;
    width: 236px;
    padding: var(--space-4);
    background: var(--paper-0);
    border-left: 1px solid var(--border-subtle);
    overflow-y: auto;
  }

  h2 {
    margin: 0 0 var(--space-3);
    font: var(--text-h4);
    color: var(--text-strong);
  }

  h3 {
    margin: var(--space-5) 0 var(--space-2);
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .fields {
    display: grid;
    gap: var(--space-3);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .props {
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }

  .props div {
    display: flex;
    justify-content: space-between;
    font: var(--text-small);
  }

  .props dt {
    color: var(--text-muted);
  }

  .props dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--text-body);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .piece {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2);
    background: var(--surface-sunken);
    border-radius: var(--radius-xs);
  }

  .pid {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-strong);
  }

  .pmeta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .empty {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }
</style>
