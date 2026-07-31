<script lang="ts">
  import {
    convertLength,
    formatLength,
    pieceKey,
    resolveCame,
    toMillimetres,
    type LengthUnit,
    type NumberingScheme,
    type Piece,
  } from '@vitrum/core'
  import type { Violation } from '@vitrum/drc'
  import { curveLength, vec2 } from '@vitrum/geometry'
  import {
    geometryEndpoints,
    setCameOverride,
    updateRenderSettings,
    type Command,
    type Glass,
    type GlassId,
    type Project,
    type Segment,
  } from '@vitrum/model'

  import Button from '../components/Button.svelte'
  import Input from '../components/Input.svelte'
  import Select from '../components/Select.svelte'
  import type { AssignmentController } from '../glass/assignment.svelte'
  import type { LightController } from '../light/controller.svelte'
  import type { NestController } from '../nest/controller.svelte'
  import type { NumberingController } from '../numbering/controller.svelte'
  import type { ReferenceController } from '../reference/controller.svelte'
  import type { EditController } from '../tools/edit.svelte'
  import type { PaintController } from '../tools/paint.svelte'
  import type { ReinforcementController } from '../tools/reinforcement.svelte'
  import type { SelectionController } from '../tools/selection.svelte'

  import LightPanel from './LightPanel.svelte'
  import NestControls from './NestControls.svelte'
  import type { LegendEntry } from './NumberingPanel.svelte'
  import PieceInspector from './PieceInspector.svelte'
  import type { ViewMode } from './viewmode'

  /** One headline number about the whole panel, shown when nothing is selected. */
  export interface PanelStat {
    label: string
    value: string
  }

  interface Props {
    unit: LengthUnit
    /** The active view — the inspector shows the context that view needs. */
    viewMode?: ViewMode
    /** Editing controller (F-013). */
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
    /** Command sink. */
    execute?: (command: Command) => void
    /** Headline panel numbers, shown with nothing selected. */
    panelStats?: readonly PanelStat[]
    /** The glass legend (F-040 FR-4). */
    legend?: readonly LegendEntry[]
    /** Active numbering scheme, for the cartoon legend caption. */
    scheme?: NumberingScheme
    /** Active violations (F-030), so a selected piece can show what is wrong with it. */
    violations?: readonly Violation[]
    /** Apply a violation's quick fix. */
    onQuickFix?: (violation: Violation) => void
    /** Sunlight simulation (F-054) — the light view's controls live here. */
    light?: LightController
    /** Sheet nesting (F-057) — the nest view's controls live here. */
    nest?: NestController
    /** Project glasses, for the nest controls' names. */
    glasses?: Readonly<Record<GlassId, Glass>>
    /** Open the export hub on the 1:1 tiled template (F-041), from the cartoon view. */
    onPrintTemplate?: () => void
  }

  let {
    unit,
    viewMode = 'design',
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
    panelStats = [],
    legend = [],
    scheme = 'grouped',
    violations = [],
    onQuickFix,
    light,
    nest,
    glasses = {},
    onPrintTemplate,
  }: Props = $props()

  // Reference-image layer editing (F-051): calibration and perspective scratch fields.
  let calibrationMm = $state('')
  let rectifyW = $state('')
  let rectifyH = $state('')
  const refLayer = $derived(reference?.selected ?? null)
  const refSelected = $derived(!!refLayer)

  const selectedPieceList = $derived<Piece[]>(
    paint ? pieces.filter((p) => paint.selectedPieces.has(pieceKey(p))) : [],
  )
  const pieceSelected = $derived(!!paint && selectedPieceList.length > 0)

  const selectedIds = $derived(selection ? [...selection.selected] : [])
  const selectedSegments = $derived<Segment[]>(
    doc ? selectedIds.map((id) => doc.segments[id]).filter((s): s is Segment => !!s) : [],
  )
  const single = $derived<Segment | null>(
    selectedSegments.length === 1 ? selectedSegments[0]! : null,
  )
  const segmentSelected = $derived(!!edit && !!selection && selectedSegments.length > 0)

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

  const nothingSelected = $derived(
    !pieceSelected && !segmentSelected && !barSelected && !refSelected,
  )

  // Violations touching the one selected piece, most severe first (the engine already orders them).
  const pieceViolations = $derived.by<Violation[]>(() => {
    if (selectedPieceList.length !== 1) return []
    const id = selectedPieceList[0]!.id
    return violations.filter((v) => v.pieceIds.includes(id))
  })

  /**
   * The header reads as "what am I looking at": the selection when there is one, otherwise the
   * subject of the active view. Cockpit v2 keeps the inspector present at all times, so it needs a
   * title even with nothing selected.
   */
  const title = $derived.by(() => {
    if (refSelected) return 'Reference image'
    if (barSelected) return 'Reinforcement bar'
    if (pieceSelected)
      return selectedPieceList.length === 1 ? 'Piece' : `${selectedPieceList.length} pieces`
    if (segmentSelected) return single ? 'Segment' : `${selectedSegments.length} lines`
    return (
      {
        design: 'Panel',
        cartoon: 'Cartoon sheet',
        render: 'Render',
        light: 'Sunlight',
        nest: 'Sheets',
      } satisfies Record<ViewMode, string>
    )[viewMode]
  })

  const meta = $derived.by(() => {
    if (!nothingSelected) return 'selected'
    if (viewMode === 'design') return `${pieces.length} piece${pieces.length === 1 ? '' : 's'}`
    return ''
  })

  const schemeLabel = $derived(
    scheme === 'grouped' ? 'Grouped by glass' : scheme === 'sequential' ? 'Sequential' : 'Manual',
  )

  // --- Segment editing (F-013) ----------------------------------------------
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

  // Per-segment came override (F-021), for a single selected segment in lead mode.
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
  <div class="header">
    <span class="h-title">{title}</span>
    <span class="spacer"></span>
    {#if meta}<span class="h-meta">{meta}</span>{/if}
  </div>

  <div class="scroll">
    {#if refSelected && refLayer && reference}
      <div class="pad">
        <dl class="props">
          <div>
            <dt>Size</dt>
            <dd>{refLayer.naturalWidthPx} × {refLayer.naturalHeightPx} px</dd>
          </div>
        </dl>

        <h3>Placement</h3>
        <p class="hint">
          Drag the centre handle to move the image, a corner handle to resize it. Corners keep the
          aspect ratio; alt-drag a corner to move it on its own.
        </p>

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
              <Button size="sm" variant="ghost" onclick={() => reference.setMode('place')}>
                Cancel
              </Button>
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
            <Button size="sm" variant="ghost" onclick={() => reference.setMode('place')}>
              Cancel
            </Button>
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
          <Button size="sm" variant="ghost" onclick={() => reference.remove(refLayer.id)}>
            Remove
          </Button>
        </div>
      </div>
    {:else if barSelected && selectedBar}
      <div class="pad">
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
          <Button size="sm" variant="ghost" onclick={() => reinforce?.deleteSelected()}>
            Delete
          </Button>
        </div>
      </div>
    {:else if pieceSelected && paint}
      <PieceInspector
        {pieces}
        {unit}
        {paint}
        {assignments}
        {numbering}
        {doc}
        {execute}
        {onSetNumber}
        renderActive={viewMode === 'render'}
        issues={pieceViolations}
        {onQuickFix}
      />
    {:else if segmentSelected}
      <div class="pad">
        {#if single && ends}
          <div class="fields">
            <div class="pair">
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
            <div class="pair">
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
              <div class="pair">
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
              <dt>Lines</dt>
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
          <Button size="sm" variant="secondary" onclick={() => edit?.rotateBy(90)}>
            Rotate 90°
          </Button>
          <Button size="sm" variant="secondary" onclick={() => edit?.duplicate()}>Duplicate</Button>
        </div>
        <div class="actions">
          <Button size="sm" variant="ghost" onclick={() => edit?.deleteSelection()}>Delete</Button>
        </div>
      </div>

      <!-- ── Nothing selected: the context the active view needs ── -->
    {:else if viewMode === 'design'}
      <div class="pad">
        {#if panelStats.length > 0}
          <div class="tiles">
            {#each panelStats as stat (stat.label)}
              <span class="tile">
                <span class="eyebrow">{stat.label}</span>
                <span class="tile-value">{stat.value}</span>
              </span>
            {/each}
          </div>
        {/if}

        {#if legend.length > 0}
          <section class="ruled">
            <span class="eyebrow">Glass in this panel</span>
            {#each legend as entry (entry.glassId)}
              <div class="legend-row">
                <span
                  class="swatch"
                  style={`background:${doc?.glasses[entry.glassId]?.color ?? 'var(--paper-100)'}`}
                ></span>
                <span class="legend-name" title={entry.name}>{entry.name}</span>
                <span class="count">×{entry.count}</span>
              </div>
            {/each}
          </section>
        {/if}

        <p class="dashed">Click a piece on the panel to inspect it.</p>
      </div>
    {:else if viewMode === 'cartoon'}
      <div class="pad">
        <section>
          <div class="sec-head">
            <span class="eyebrow">Legend</span>
            <span class="h-meta">{schemeLabel}</span>
          </div>
          {#if legend.length === 0}
            <p class="hint">No glass assigned yet.</p>
          {:else}
            {#each legend as entry (entry.glassId)}
              <div class="cartoon-row">
                <span class="code">{entry.code}</span>
                <span class="legend-text">
                  <span class="legend-name">{entry.name}</span>
                  {#if entry.manufacturer}<span class="hint">{entry.manufacturer}</span>{/if}
                </span>
                <span class="count">×{entry.count}</span>
              </div>
            {/each}
          {/if}
        </section>

        {#if onPrintTemplate}
          <section class="ruled">
            <span class="eyebrow">Sheet</span>
            <p class="hint">Print the cartoon at 1:1 and cut glass straight off the paper.</p>
            <Button size="sm" onclick={onPrintTemplate}>Print template</Button>
          </section>
        {/if}
      </div>
    {:else if viewMode === 'render' && doc && execute}
      {@const ex = execute}
      <div class="pad">
        <section>
          <span class="eyebrow">Backlight</span>
          <label class="slider">
            <span class="slider-label">
              Intensity
              <span class="slider-value">{doc.render.backlightIntensity.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={doc.render.backlightIntensity}
              onchange={(e) =>
                ex(updateRenderSettings({ backlightIntensity: Number(e.currentTarget.value) }))}
              aria-label="Backlight intensity"
            />
          </label>
          <label class="slider">
            <span class="slider-label">
              Warmth
              <span class="slider-value">{doc.render.backlightWarmth.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.05"
              value={doc.render.backlightWarmth}
              onchange={(e) =>
                ex(updateRenderSettings({ backlightWarmth: Number(e.currentTarget.value) }))}
              aria-label="Backlight warmth"
            />
          </label>
          <span class="hint">Cool north light to warm afternoon sun.</span>
        </section>
        <section class="ruled">
          <span class="eyebrow">Texture placement</span>
          <span class="hint">Select a piece to nudge, rotate or scale its glass texture.</span>
        </section>
      </div>
    {:else if viewMode === 'light' && light}
      <div class="pad">
        <LightPanel {light} lightViewActive={true} />
      </div>
    {:else if viewMode === 'nest' && nest}
      <div class="pad">
        <NestControls {nest} {glasses} {unit} />
      </div>
    {/if}
  </div>
</aside>

<style>
  .inspector {
    grid-area: inspector;
    width: 282px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--paper-0);
    border-left: 1px solid var(--border-subtle);
  }

  .header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .h-title {
    font: var(--text-h4);
    color: var(--text-strong);
  }

  .spacer {
    flex: 1;
  }

  .h-meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-500);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .pad {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 14px;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  section.ruled {
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .sec-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  h3 {
    margin: var(--space-3) 0 0;
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  /* Headline panel numbers: sunken tiles so they read as facts, not controls. */
  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 11px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    background: var(--paper-50);
    border-radius: var(--radius-sm);
  }

  .tile-value {
    font-family: var(--font-mono);
    font-size: 15px;
    color: var(--ink-950);
  }

  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .swatch {
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 3px;
    border: 1px solid var(--border-subtle);
  }

  .legend-name {
    flex: 1;
    min-width: 0;
    font: var(--text-small);
    color: var(--ink-800);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cartoon-row {
    display: grid;
    grid-template-columns: 32px 1fr auto;
    align-items: baseline;
    gap: 9px;
  }

  .legend-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .code {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 13px;
    color: var(--ink-950);
  }

  .count {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--ink-500);
  }

  .dashed {
    margin: 0;
    padding: 11px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    text-align: center;
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .fields {
    display: grid;
    gap: var(--space-3);
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

  .slider {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .slider-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font: 500 12.5px/1 var(--font-sans);
    color: var(--ink-800);
  }

  .slider-value {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .slider input[type='range'] {
    width: 100%;
    accent-color: var(--cobalt-500);
  }
</style>
