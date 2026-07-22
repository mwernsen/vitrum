<script lang="ts">
  import {
    convertLength,
    formatLength,
    pieceKey,
    resolveCame,
    toMillimetres,
    type LengthUnit,
    type Piece,
  } from '@vitrum/core'
  import { curveLength, vec2 } from '@vitrum/geometry'
  import {
    geometryEndpoints,
    identityTextureTransform,
    setCameOverride,
    setPieceTextureTransforms,
    type Command,
    type GlassId,
    type PieceTextureTransform,
    type Project,
    type Segment,
  } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import type { AssignmentController } from '../glass/assignment.svelte'
  import type { NumberingController } from '../numbering/controller.svelte'
  import type { ReferenceController } from '../reference/controller.svelte'
  import type { EditController } from '../tools/edit.svelte'
  import type { PaintController } from '../tools/paint.svelte'
  import type { ReinforcementController } from '../tools/reinforcement.svelte'
  import type { SelectionController } from '../tools/selection.svelte'

  interface Props {
    unit: LengthUnit
    /** Editing controller (F-013). Absent ⇒ inspector shows the panel summary only. */
    edit?: EditController
    /** Selection model (F-013). */
    selection?: SelectionController
    /** The paint / piece-select controller (F-023). */
    paint?: PaintController
    /** The reinforcement-bar controller (F-032). */
    reinforce?: ReinforcementController
    /** The reference-image underlay controller (F-051). */
    reference?: ReferenceController
    /** The glass assignment resolver (F-023). */
    assignments?: AssignmentController
    /** The piece-numbering resolver (F-040). */
    numbering?: NumberingController
    /** Set/clear a manual per-piece number override (F-040), keyed by content id. */
    onSetNumber?: (pieceContentId: string, label: string | null) => void
    /** The current document, for reading selected geometry. */
    doc?: Project
    /** Detected pieces (F-020), derived from the live network. */
    pieces?: readonly Piece[]
    /** Command sink (F-021 technique edits). Absent ⇒ technique panel is read-only/hidden. */
    execute?: (command: Command) => void
    /** Whether the realistic render view (F-053) is active — reveals per-piece texture placement. */
    renderActive?: boolean
  }

  let {
    unit,
    edit,
    selection,
    paint,
    reinforce,
    reference,
    assignments,
    numbering,
    onSetNumber,
    doc,
    pieces = [],
    execute,
    renderActive = false,
  }: Props = $props()

  /** A piece's stored per-piece texture placement (F-053), or the identity when none is set. */
  function textureOf(piece: Piece): PieceTextureTransform {
    return doc?.render.textureTransforms[pieceKey(piece)] ?? identityTextureTransform()
  }
  /** Patch one field of a piece's texture placement — one undo entry (F-053). */
  function setTexture(piece: Piece, patch: Partial<PieceTextureTransform>): void {
    execute?.(setPieceTextureTransforms({ [pieceKey(piece)]: { ...textureOf(piece), ...patch } }))
  }
  /** Reset a piece to the identity texture placement. */
  function resetTexture(piece: Piece): void {
    execute?.(setPieceTextureTransforms({ [pieceKey(piece)]: null }))
  }

  // Reference-image layer editing (F-051): calibration and perspective scratch fields.
  let calibrationMm = $state('')
  let rectifyW = $state('')
  let rectifyH = $state('')
  const refLayer = $derived(reference?.selected ?? null)
  const refSelected = $derived(!!refLayer)

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

  // Turn-3 IA: the inspector shows the current selection only, and collapses when nothing is
  // selected — no feature panel lives here (those are in the dock).
  const pieceSelected = $derived(!!paint && selectedPieceList.length > 0)
  const segmentSelected = $derived(!!edit && !!selection && selectedSegments.length > 0)
  // The selected reinforcement bar (F-032), if the bar layer has one.
  const selectedBar = $derived(reinforce?.selectedBar() ?? null)
  const barSelected = $derived(!!selectedBar)
  const barLengthMm = $derived(
    selectedBar
      ? Math.hypot(selectedBar.b.x - selectedBar.a.x, selectedBar.b.y - selectedBar.a.y)
      : 0,
  )
  const MATERIAL_OPTIONS = [
    { value: 'zinc', label: 'Zinc' },
    { value: 'steel', label: 'Steel' },
    { value: 'brass', label: 'Brass' },
    { value: 'lead', label: 'Lead' },
  ]
  const collapsed = $derived(!pieceSelected && !segmentSelected && !barSelected && !refSelected)

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

<aside class="inspector" class:collapsed aria-label="Inspector">
  {#if refSelected && refLayer && reference}
    <h2>Reference image</h2>
    <dl class="props">
      <div>
        <dt>Size</dt>
        <dd>{refLayer.naturalWidthPx} × {refLayer.naturalHeightPx} px</dd>
      </div>
    </dl>

    <h3>Opacity</h3>
    <div class="opacity">
      <input
        type="range"
        min="0"
        max="100"
        value={Math.round(refLayer.opacity * 100)}
        aria-label="Layer opacity"
        oninput={(e) => reference.setOpacity(refLayer.id, e.currentTarget.valueAsNumber / 100)}
      />
      <span class="pct">{Math.round(refLayer.opacity * 100)}%</span>
    </div>

    <div class="toggles">
      <Button
        size="sm"
        variant={refLayer.desaturate ? 'primary' : 'secondary'}
        onclick={() => reference.toggleDesaturate(refLayer.id)}
      >
        Desaturate
      </Button>
      <Button
        size="sm"
        variant={refLayer.locked ? 'primary' : 'secondary'}
        onclick={() => reference.toggleLock(refLayer.id)}
      >
        {refLayer.locked ? 'Locked' : 'Lock'}
      </Button>
    </div>

    <h3>Scale calibration</h3>
    {#if reference.mode === 'calibrate'}
      <p class="hint">
        {reference.calibrationPoints.length < 2
          ? `Click two points on the image (${reference.calibrationPoints.length}/2).`
          : 'Enter the real distance between the two points.'}
      </p>
      {#if reference.calibrationPoints.length === 2}
        <div class="field">
          <Input
            label="Real distance (mm)"
            size="sm"
            value={calibrationMm}
            placeholder="distance"
            onchange={(v) => (calibrationMm = v)}
          />
        </div>
        <div class="actions">
          <Button
            size="sm"
            onclick={() => {
              const mm = Number(calibrationMm)
              if (Number.isFinite(mm) && mm > 0) reference.applyCalibration(mm)
              calibrationMm = ''
            }}
          >
            Apply scale
          </Button>
          <Button size="sm" variant="ghost" onclick={() => reference.setMode('place')}
            >Cancel</Button
          >
        </div>
      {/if}
    {:else}
      <Button size="sm" variant="secondary" onclick={() => reference.setMode('calibrate')}>
        Calibrate scale…
      </Button>
    {/if}

    <h3>Perspective</h3>
    {#if reference.mode === 'rectify'}
      <p class="hint">
        Drag the four handles onto the corners of the window, then enter its real size.
      </p>
      <div class="field">
        <Input
          label="Width (mm)"
          size="sm"
          value={rectifyW}
          placeholder="width"
          onchange={(v) => (rectifyW = v)}
        />
        <Input
          label="Height (mm)"
          size="sm"
          value={rectifyH}
          placeholder="height"
          onchange={(v) => (rectifyH = v)}
        />
      </div>
      <div class="actions">
        <Button
          size="sm"
          onclick={() => {
            const w = Number(rectifyW)
            const h = Number(rectifyH)
            if (w > 0 && h > 0) reference.applyRectify(w, h)
            rectifyW = ''
            rectifyH = ''
          }}
        >
          Rectify
        </Button>
        <Button size="sm" variant="ghost" onclick={() => reference.setMode('place')}>Cancel</Button>
      </div>
    {:else}
      <div class="toggles">
        <Button size="sm" variant="secondary" onclick={() => reference.setMode('rectify')}>
          Correct perspective…
        </Button>
        {#if refLayer.rectified}
          <Button size="sm" variant="ghost" onclick={() => reference.resetRectify(refLayer.id)}>
            Reset
          </Button>
        {/if}
      </div>
    {/if}

    <div class="actions">
      <Button size="sm" variant="ghost" onclick={() => reference.remove(refLayer.id)}>Remove</Button
      >
    </div>
  {:else if barSelected && selectedBar}
    <h2>Reinforcement bar</h2>
    <dl class="props">
      <div>
        <dt>Length</dt>
        <dd>{formatLength(barLengthMm, unit)}</dd>
      </div>
    </dl>
    <div class="fields">
      <Input
        size="sm"
        label="Width (mm)"
        value={String(selectedBar.widthMm)}
        onchange={(v) => {
          const n = Number(v)
          if (Number.isFinite(n)) reinforce?.setWidth(n)
        }}
      />
      <Select
        size="sm"
        label="Material"
        options={MATERIAL_OPTIONS}
        value={selectedBar.material}
        onchange={(m) => reinforce?.setMaterial(m as 'zinc' | 'steel' | 'brass' | 'lead')}
      />
    </div>
    <div class="actions">
      <Button size="sm" variant="ghost" onclick={() => reinforce?.deleteSelected()}>Delete</Button>
    </div>
  {:else if pieceSelected}
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
          <dd>{numbering?.labelFor(piece) ?? 'Unnumbered'}</dd>
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

      {#if onSetNumber}
        <h3>Number override</h3>
        <div class="fields">
          <Input
            size="sm"
            label="Custom number"
            value={numbering?.effectiveOverrides.get(pieceKey(piece)) ?? ''}
            onchange={(v) => onSetNumber?.(pieceKey(piece), v.trim() === '' ? null : v.trim())}
          />
        </div>
      {/if}

      {#if renderActive && execute}
        {@const tt = textureOf(piece)}
        <h3>Texture placement</h3>
        <div class="fields">
          <Input
            size="sm"
            label="Rotation (deg)"
            value={String(tt.rotationDeg)}
            onchange={(v) => setTexture(piece, { rotationDeg: Number(v) || 0 })}
          />
          <div class="row">
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
            <Button size="sm" variant="ghost" onclick={() => resetTexture(piece)}>
              Reset texture
            </Button>
          </div>
        </div>
      {/if}
    {/if}

    <h3>Assign glass</h3>
    <div class="fields">
      <Select size="sm" options={glassOptions} value="" onchange={assignToSelection} />
      <div class="actions">
        <Button size="sm" variant="ghost" onclick={() => paint?.unassignSelected()}>Unassign</Button
        >
      </div>
    </div>
  {:else if segmentSelected}
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
      <Button size="sm" variant="secondary" onclick={() => edit?.mirror('horizontal')}>
        Mirror horizontal
      </Button>
      <Button size="sm" variant="secondary" onclick={() => edit?.mirror('vertical')}>
        Mirror vertical
      </Button>
      <Button size="sm" variant="secondary" onclick={() => edit?.rotateBy(90)}>Rotate 90°</Button>
      <Button size="sm" variant="secondary" onclick={() => edit?.duplicate()}>Duplicate</Button>
    </div>
    <div class="actions">
      <Button size="sm" variant="ghost" onclick={() => edit?.deleteSelection()}>Delete</Button>
    </div>
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

  /* Turn-3 IA: with no selection the inspector collapses so the canvas gets the room. */
  .inspector.collapsed {
    width: 0;
    padding: 0;
    border-left: none;
    overflow: hidden;
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

  .opacity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .opacity input[type='range'] {
    flex: 1;
    accent-color: var(--cobalt-500);
  }
  .opacity .pct {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    min-width: 34px;
    text-align: right;
  }

  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .field {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }

  .hint {
    margin: 0;
    font: var(--text-caption);
    color: var(--text-muted);
  }
</style>
