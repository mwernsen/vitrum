<script lang="ts">
  import {
    pieceKey,
    type CutContour,
    type Diagnostic,
    type LabelPlacement,
    type Piece,
  } from '@vitrum/core'
  import type { BBox } from '@vitrum/geometry'
  import { vec2 } from '@vitrum/geometry'
  import type { Glass, GlassId, PieceId, ReinforcementBar, Segment } from '@vitrum/model'
  import { onMount } from 'svelte'

  import {
    RULER_SIZE,
    drawContent,
    drawCutContours,
    drawDiagnostics,
    drawBomHighlight,
    drawGlassFills,
    drawGrid,
    drawNumbers,
    drawOverlay,
    drawPieceFills,
    drawPieceHighlight,
    drawPieceSelection,
    drawPrintTiles,
    drawReinforcements,
    drawRuler,
    drawSnapMarker,
    drawToolPreview,
    drawViolations,
    fillBackground,
    prepareContext,
    readCanvasPalette,
    type CanvasPalette,
    type PrintTileOverlay,
    type TechniqueRender,
    type ViolationMarker,
  } from '../canvas/render'
  import { drawEditLayer } from '../canvas/selectionRender'
  import type { ViewportController } from '../canvas/viewport.svelte'
  import type { ToolController } from '../tools/controller.svelte'
  import type { EditController } from '../tools/edit.svelte'
  import type { PaintController } from '../tools/paint.svelte'
  import type { ReinforcementController } from '../tools/reinforcement.svelte'
  import type { SelectionController } from '../tools/selection.svelte'
  import type { SnapController } from '../tools/snap.svelte'

  interface Props {
    viewport: ViewportController
    /** The lead-line network to render. Empty until a document is loaded. */
    segments?: readonly Segment[]
    /** World bounds for zoom-to-fit; `null` frames the default panel region. */
    bounds?: BBox | null
    /** The drawing-tool controller (F-011). Absent ⇒ canvas is view-only. */
    tools?: ToolController
    /** The snapping controller (F-012). Absent ⇒ no snap markers. */
    snap?: SnapController
    /** The selection/editing controller (F-013). Drives the inert `select` tool. */
    edit?: EditController
    /** The selection model (F-013), for highlighting selected segments. */
    selection?: SelectionController
    /** The paint / piece-select controller (F-023). Absent ⇒ no painting. */
    paint?: PaintController
    /** Whether the coloured-glass panel render is on (F-023, on by default). */
    showGlass?: boolean
    /** Effective glass per piece, keyed by content id (F-023). */
    glassAssignments?: ReadonlyMap<PieceId, GlassId>
    /** The project's glass catalog, for fill colours (F-023). */
    glasses?: Readonly<Record<GlassId, Glass>>
    /** Content ids of pieces selected in piece-select mode (F-023). */
    selectedPieces?: ReadonlySet<PieceId>
    /** Detected pieces to overlay (F-020 dev visualization). Empty ⇒ nothing drawn. */
    pieces?: readonly Piece[]
    /** Network diagnostics to mark (F-020). */
    diagnostics?: readonly Diagnostic[]
    /** Whether the piece overlay is on (F-020 dev toggle). */
    showPieces?: boolean
    /** Id of the piece under the cursor, for hover highlight (F-020). */
    hoveredPieceId?: string | null
    /** Technique styling for the network (F-021). Absent ⇒ plain ink lines. */
    technique?: TechniqueRender
    /** Technique-derived cut contours to overlay (F-021 dev toggle). */
    cutContours?: readonly CutContour[]
    /** Whether the cut-contour overlay is on (F-021 dev toggle). */
    showCuts?: boolean
    /** DRC violation markers to draw on the overlay (F-030). */
    violations?: readonly ViolationMarker[]
    /** The selected violation's key, ringed on the canvas (F-030). */
    selectedViolationKey?: string | null
    /** Reinforcement bars to draw (F-032). */
    reinforcements?: readonly ReinforcementBar[]
    /** The reinforcement-bar controller (F-032). Absent ⇒ bars are view-only. */
    reinforce?: ReinforcementController
    /** Cartoon view mode (F-040): a white sheet with line work + numbers, no colour fills. */
    cartoon?: boolean
    /** Whether to overlay piece numbers in the coloured view (F-040). Always on in cartoon. */
    showNumbers?: boolean
    /** Effective piece number per content id (F-040). */
    numberLabels?: ReadonlyMap<PieceId, string>
    /** Label placement (pole of inaccessibility + radius) per content id (F-040). */
    numberPlacements?: ReadonlyMap<PieceId, LabelPlacement>
    /** 1:1 print page grid to preview on the canvas (F-041). Empty ⇒ no preview. */
    printTiles?: readonly PrintTileOverlay[]
    /** Piece display ids to highlight for a picked BOM line item (F-042 traceability). */
    bomHighlightPieces?: ReadonlySet<string>
    /** Segment ids to highlight for a picked BOM line item (F-042 traceability). */
    bomHighlightSegments?: ReadonlySet<string>
    /** Register a PNG-snapshot getter with the shell (F-043 snapshot button). */
    snapshotRegister?: (getter: () => Promise<Uint8Array | null>) => void
  }

  let {
    viewport,
    segments = [],
    bounds = null,
    tools,
    snap,
    edit,
    selection,
    paint,
    showGlass = true,
    glassAssignments,
    glasses = {},
    selectedPieces,
    pieces = [],
    diagnostics = [],
    showPieces = false,
    hoveredPieceId = null,
    technique,
    cutContours = [],
    showCuts = false,
    violations = [],
    selectedViolationKey = null,
    reinforcements = [],
    reinforce,
    cartoon = false,
    showNumbers = false,
    numberLabels,
    numberPlacements,
    printTiles = [],
    bomHighlightPieces,
    bomHighlightSegments,
    snapshotRegister,
  }: Props = $props()

  // Hand the snapshot getter to the shell once mounted (F-043); the getter reads the live canvas.
  $effect(() => {
    snapshotRegister?.(toPngBytes)
  })

  /** Resolve a piece's effective glass id from the assignment map (F-023). */
  function glassFor(piece: Piece): GlassId | undefined {
    return glassAssignments?.get(pieceKey(piece))
  }

  /** Shared empty set for the BOM highlight (F-042) when one axis is unset — avoids per-frame allocs. */
  const EMPTY_SET: ReadonlySet<string> = new Set()

  /** Resolve a piece's effective number (F-040). */
  function numberFor(piece: Piece): string | undefined {
    return numberLabels?.get(pieceKey(piece))
  }
  /** Resolve a piece's label placement (F-040). */
  function placementFor(piece: Piece): LabelPlacement | undefined {
    return numberPlacements?.get(pieceKey(piece))
  }

  /** True when the paint or piece-select layer (F-023) is driving. Inert in the cartoon view. */
  function painting(): boolean {
    return !cartoon && !!paint && paint.active
  }

  /** True when the reinforcement-bar layer (F-032) is driving. Inert in the cartoon view. */
  function placingBar(): boolean {
    return !cartoon && !!reinforce && reinforce.active
  }

  /** True when a drawing tool is active. Inert in the cartoon view (a derived, read-only view). */
  function drawing(): boolean {
    return !cartoon && !!tools && tools.activeId !== 'select'
  }

  /** True when the inert select tool is active, editing is wired in, and paint/bars are off. */
  function editing(): boolean {
    return (
      !cartoon &&
      !!edit &&
      !!selection &&
      !painting() &&
      !placingBar() &&
      (!tools || tools.activeId === 'select')
    )
  }

  let stackEl: HTMLDivElement
  let gridCanvas: HTMLCanvasElement
  let contentCanvas: HTMLCanvasElement
  let overlayCanvas: HTMLCanvasElement
  let rulerTopCanvas: HTMLCanvasElement
  let rulerLeftCanvas: HTMLCanvasElement

  let palette: CanvasPalette | null = null

  /**
   * Rasterise the rendered design to PNG bytes for the F-043 snapshot button. Composites the
   * document content layer (glass, lead, numbers — not the selection/cursor overlay or grid) onto a
   * white ground, so the snapshot is the design as drawn. Resolves null when the canvas or
   * `toBlob`/2D context is unavailable (e.g. jsdom).
   */
  export async function toPngBytes(): Promise<Uint8Array | null> {
    if (typeof document === 'undefined' || !contentCanvas) return null
    const out = document.createElement('canvas')
    out.width = contentCanvas.width
    out.height = contentCanvas.height
    const ctx = out.getContext('2d')
    if (!ctx || typeof out.toBlob !== 'function') return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(contentCanvas, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
  }

  // Per-layer dirty flags coalesced into a single rAF so a burst of pointer/wheel events
  // paints at most once per frame (FR-4). Overlays live on their own layer, so moving the
  // cursor never redraws the grid or content.
  const dirty = { grid: false, content: false, overlay: false, rulers: false }
  let frame = 0

  function schedule(...layers: (keyof typeof dirty)[]): void {
    for (const layer of layers) dirty[layer] = true
    if (frame || typeof requestAnimationFrame === 'undefined') return
    frame = requestAnimationFrame(flush)
  }

  function flush(): void {
    frame = 0
    if (!palette) return
    const size = viewport.size
    const dpr = viewport.devicePixelRatio

    if (dirty.grid) {
      const ctx = prepareContext(gridCanvas, size, dpr)
      if (viewport.gridVisible) drawGrid(ctx, viewport.transform, size, palette)
      dirty.grid = false
    }
    if (dirty.content) {
      const ctx = prepareContext(contentCanvas, size, dpr)
      if (cartoon) {
        // A monochrome workshop sheet: white ground, black line work, numbers — no colour fills.
        fillBackground(ctx, size, palette.rulerBg)
        drawContent(ctx, viewport.transform, size, segments, palette)
      } else {
        if (showGlass) {
          drawGlassFills(ctx, viewport.transform, size, pieces, glassFor, glasses, palette)
        }
        if (showPieces) drawPieceFills(ctx, viewport.transform, size, pieces, palette)
        drawContent(ctx, viewport.transform, size, segments, palette, technique)
        if (showCuts) drawCutContours(ctx, viewport.transform, cutContours, palette)
      }
      if (reinforcements.length > 0 || placingBar()) {
        drawReinforcements(
          ctx,
          viewport.transform,
          reinforcements,
          reinforce?.selectedId ?? null,
          reinforce?.placement ?? null,
          palette,
        )
      }
      // Numbers overlay: always in the cartoon, on demand in the coloured view (F-040).
      if (cartoon || showNumbers) {
        drawNumbers(ctx, viewport.transform, size, pieces, numberFor, placementFor, palette)
      }
      dirty.content = false
    }
    if (dirty.overlay) {
      const ctx = prepareContext(overlayCanvas, size, dpr)
      drawOverlay(ctx, size, viewport.cursorScreen, palette)
      if (painting() && selectedPieces) {
        drawPieceSelection(ctx, viewport.transform, pieces, selectedPieces, palette)
      }
      if (showPieces || painting()) {
        drawPieceHighlight(ctx, viewport.transform, pieces, hoveredPieceId, palette)
      }
      if (showPieces) drawDiagnostics(ctx, viewport.transform, diagnostics, palette)
      if (bomHighlightPieces || bomHighlightSegments) {
        drawBomHighlight(
          ctx,
          viewport.transform,
          pieces,
          bomHighlightPieces ?? EMPTY_SET,
          segments,
          bomHighlightSegments ?? EMPTY_SET,
          palette,
        )
      }
      drawViolations(ctx, viewport.transform, violations, selectedViolationKey, palette)
      if (printTiles.length > 0) drawPrintTiles(ctx, viewport.transform, printTiles, palette)
      if (tools) drawToolPreview(ctx, viewport.transform, tools.previewShapes, palette)
      if (snap) drawSnapMarker(ctx, viewport.transform, snap.hit, palette)
      if (edit && selection && editing()) {
        const selected = segments.filter((s) => selection!.has(s.id))
        const preview = edit.preview
        drawEditLayer(
          ctx,
          viewport.transform,
          {
            selected,
            nodeMarkers: edit.nodeMarkers,
            bezierHandles: edit.bezierHandles,
            handles: edit.handles,
            bbox: edit.selectionBBox,
            marquee: edit.marquee,
            preview: preview
              ? {
                  transform: preview.transform,
                  segments: segments.filter((s) => preview.ids.includes(s.id)),
                }
              : null,
          },
          palette,
        )
      }
      dirty.overlay = false
    }
    if (dirty.rulers) {
      const top = prepareContext(rulerTopCanvas, { width: size.width, height: RULER_SIZE }, dpr)
      drawRuler(
        top,
        'x',
        viewport.transform,
        size.width,
        viewport.unit,
        viewport.cursorScreen,
        palette,
      )
      const left = prepareContext(rulerLeftCanvas, { width: RULER_SIZE, height: size.height }, dpr)
      drawRuler(
        left,
        'y',
        viewport.transform,
        size.height,
        viewport.unit,
        viewport.cursorScreen,
        palette,
      )
      dirty.rulers = false
    }
  }

  // Reactive redraw triggers: each effect reads the state it depends on (so Svelte tracks
  // it) then marks the affected layers dirty. The actual paint is deferred to `flush`.
  $effect(() => {
    // grid + content follow the transform, size and grid toggle
    void viewport.transform
    void viewport.width
    void viewport.height
    void viewport.gridVisible
    void segments
    void pieces
    void showPieces
    void showGlass
    void glassAssignments
    void glasses
    void technique
    void cutContours
    void showCuts
    void reinforcements
    void reinforce?.selectedId
    void reinforce?.placement
    void cartoon
    void showNumbers
    void numberLabels
    void numberPlacements
    schedule('grid', 'content', 'rulers')
  })
  $effect(() => {
    void viewport.cursorScreen
    void viewport.unit
    void viewport.transform
    void tools?.previewShapes
    void tools?.activeId
    void snap?.hit
    void selection?.selected
    void edit?.marquee
    void edit?.preview
    void edit?.selectionBBox
    void edit?.handles
    void edit?.nodeMarkers
    void edit?.bezierHandles
    void segments
    void pieces
    void diagnostics
    void showPieces
    void hoveredPieceId
    void paint?.mode
    void selectedPieces?.size
    void violations
    void selectedViolationKey
    void printTiles
    void bomHighlightPieces?.size
    void bomHighlightSegments?.size
    schedule('overlay', 'rulers')
  })

  onMount(() => {
    palette = readCanvasPalette(stackEl)

    const measure = () => {
      const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
      viewport.resize(stackEl.clientWidth, stackEl.clientHeight, dpr)
      schedule('grid', 'content', 'overlay', 'rulers')
    }
    measure()

    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(stackEl)
    }
    window.addEventListener('resize', measure)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      if (frame) cancelAnimationFrame(frame)
    }
  })

  // --- Interaction -----------------------------------------------------------

  let panning = $state(false)
  let spaceDown = $state(false)
  let lastPointer: { x: number; y: number } | null = null

  function localPoint(event: PointerEvent | MouseEvent) {
    const rect = stackEl.getBoundingClientRect()
    return vec2(event.clientX - rect.left, event.clientY - rect.top)
  }

  function mods(event: PointerEvent | MouseEvent) {
    return { shift: event.shiftKey, alt: event.altKey }
  }

  // Feed the snap engine the pointer device (8 px mouse / 12 px pen-touch radius) and the
  // master temporary-disable modifier (FR-3): holding Ctrl/Cmd suspends snapping while drawn.
  function updateSnap(event: PointerEvent) {
    snap?.setPointer(event.pointerType, event.ctrlKey || event.metaKey)
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button === 1 || spaceDown) {
      panning = true
      lastPointer = { x: event.clientX, y: event.clientY }
      stackEl.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
    // Left button with the reinforcement layer active (F-032) places/selects bars.
    if (event.button === 0 && placingBar()) {
      reinforce!.pointerDown(localPoint(event))
      event.preventDefault()
      return
    }
    // Left button with the paint / piece-select layer active (F-023) assigns glass.
    if (event.button === 0 && painting()) {
      paint!.pointerDown(localPoint(event), mods(event))
      event.preventDefault()
      return
    }
    // Left button with a drawing tool active starts/continues a drawing gesture.
    if (event.button === 0 && drawing()) {
      updateSnap(event)
      tools!.pointerDown(localPoint(event), mods(event))
      event.preventDefault()
      return
    }
    // Left button in select mode drives selection / editing (F-013).
    if (event.button === 0 && editing()) {
      updateSnap(event)
      edit!.pointerDown(localPoint(event), mods(event))
      event.preventDefault()
    }
  }

  function handlePointerMove(event: PointerEvent) {
    const point = localPoint(event)
    viewport.setCursor(point)
    if (panning && lastPointer) {
      viewport.pan(event.clientX - lastPointer.x, event.clientY - lastPointer.y)
      lastPointer = { x: event.clientX, y: event.clientY }
      return
    }
    if (placingBar()) {
      reinforce!.pointerMove(point)
    } else if (painting()) {
      paint!.pointerMove(point)
    } else if (drawing()) {
      updateSnap(event)
      tools!.pointerMove(point, mods(event))
    } else if (editing()) {
      updateSnap(event)
      edit!.pointerMove(point, mods(event))
    }
  }

  function handlePointerUp(event: PointerEvent) {
    if (!panning && event.button === 0) {
      if (placingBar()) {
        reinforce!.pointerUp()
      } else if (painting()) {
        paint!.pointerUp()
      } else if (drawing()) {
        updateSnap(event)
        tools!.pointerUp(localPoint(event), mods(event))
      } else if (editing()) {
        updateSnap(event)
        edit!.pointerUp(localPoint(event), mods(event))
      }
    }
    endPan(event)
  }

  function endPan(event: PointerEvent) {
    if (!panning) return
    panning = false
    lastPointer = null
    if (stackEl.hasPointerCapture(event.pointerId)) stackEl.releasePointerCapture(event.pointerId)
  }

  function handlePointerLeave() {
    viewport.setCursor(null)
    snap?.clear()
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault()
    const rect = stackEl.getBoundingClientRect()
    const anchor = vec2(event.clientX - rect.left, event.clientY - rect.top)
    viewport.setCursor(anchor)
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd-scroll and trackpad pinch (which browsers report as ctrl+wheel) zoom,
      // anchored under the cursor (FR-2). The exponential keeps zoom speed uniform.
      viewport.zoomAt(Math.exp(-event.deltaY * 0.0015), anchor)
    } else {
      // Two-finger trackpad scroll pans.
      viewport.pan(-event.deltaX, -event.deltaY)
    }
  }

  function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    )
  }

  function handleDblClick(event: MouseEvent) {
    // Double-click finishes a polyline chain (the second click already placed the point).
    if (drawing()) {
      tools!.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
      event.preventDefault()
      return
    }
    // In select mode, double-click a segment to insert a node (split, F-013).
    if (editing()) {
      edit!.doubleClick(localPoint(event))
      event.preventDefault()
    }
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    if (isTyping(event.target)) return
    // The cartoon view (F-040) is read-only: only pan/zoom keys below apply, no tool/edit keys.
    if (!cartoon) {
      // The reinforcement layer (F-032) gets first refusal while active (Delete/Esc on a bar).
      if (placingBar() && reinforce!.handleKeyDown(event)) {
        event.preventDefault()
        return
      }
      // The tool layer gets first refusal (single-key activation, numeric entry, Esc/Enter).
      if (tools && tools.handleKeyDown(event)) {
        event.preventDefault()
        return
      }
      // In select mode, the edit layer handles delete / nudge / duplicate / select-all / Esc.
      if (editing() && edit!.handleKeyDown(event)) {
        event.preventDefault()
        return
      }
    }
    if (event.code === 'Space' && !spaceDown) {
      spaceDown = true
      event.preventDefault()
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    switch (event.key) {
      case 'f':
      case 'F':
        viewport.zoomToFit(bounds)
        event.preventDefault()
        break
      case '+':
      case '=':
        viewport.zoomIn(viewport.cursorScreen ?? undefined)
        event.preventDefault()
        break
      case '-':
      case '_':
        viewport.zoomOut(viewport.cursorScreen ?? undefined)
        event.preventDefault()
        break
      case '1':
        viewport.zoomToActualSize()
        event.preventDefault()
        break
    }
  }

  function handleWindowKeyUp(event: KeyboardEvent) {
    if (event.code === 'Space') spaceDown = false
    tools?.handleKeyUp(event)
  }
</script>

<svelte:window onkeydown={handleWindowKeyDown} onkeyup={handleWindowKeyUp} />

<main class="canvas" aria-label="Design canvas">
  <div class="frame" style="--ruler:{RULER_SIZE}px">
    <div class="corner" aria-hidden="true">{viewport.unit}</div>
    <canvas class="ruler ruler-top" bind:this={rulerTopCanvas}></canvas>
    <canvas class="ruler ruler-left" bind:this={rulerLeftCanvas}></canvas>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="stack"
      class:panning
      class:space={spaceDown}
      bind:this={stackEl}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={endPan}
      onpointerleave={handlePointerLeave}
      ondblclick={handleDblClick}
      onwheel={handleWheel}
    >
      <canvas class="layer" bind:this={gridCanvas}></canvas>
      <canvas class="layer" bind:this={contentCanvas}></canvas>
      <canvas class="layer" bind:this={overlayCanvas}></canvas>
      {#if tools && (tools.numericBuffer !== '' || tools.hint)}
        <div class="numeric" aria-label="Tool entry">
          {#if tools.hint}<span class="hint">{tools.hint}</span>{/if}
          {tools.numericBuffer}
        </div>
      {/if}
    </div>
  </div>
</main>

<style>
  .canvas {
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  .frame {
    display: grid;
    grid-template-columns: var(--ruler) 1fr;
    grid-template-rows: var(--ruler) 1fr;
    grid-template-areas:
      'corner rtop'
      'rleft stack';
    width: 100%;
    height: 100%;
  }

  .corner {
    grid-area: corner;
    display: grid;
    place-items: center;
    background: var(--paper-0);
    border-right: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    text-transform: lowercase;
  }

  .ruler {
    display: block;
    width: 100%;
    height: 100%;
  }
  .ruler-top {
    grid-area: rtop;
  }
  .ruler-left {
    grid-area: rleft;
  }

  .stack {
    grid-area: stack;
    position: relative;
    overflow: hidden;
    background: var(--surface-page);
    touch-action: none;
    cursor: crosshair;
  }
  .stack.space {
    cursor: grab;
  }
  .stack.panning {
    cursor: grabbing;
  }

  .layer {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .numeric {
    position: absolute;
    bottom: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    padding: 2px 10px;
    background: var(--ink-950);
    color: var(--text-inverse);
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: 12px;
    pointer-events: none;
  }

  .numeric .hint {
    color: var(--text-muted);
    margin-right: var(--space-2);
    text-transform: lowercase;
  }
</style>
