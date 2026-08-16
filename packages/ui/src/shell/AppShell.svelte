<script lang="ts">
  import {
    computeBom,
    computeQuote,
    formatAreaLarge,
    formatLength,
    leadFlangeMm,
    pieceKey,
    renumber,
    toDrafts,
    type NumberingScheme,
    type Panel,
    type Piece,
    type QuotePieceMetric,
  } from '@vitrum/core'
  import { bboxOf, bboxUnion, pointInPolygon, polygon, vec2, type BBox } from '@vitrum/geometry'
  import {
    addSegments,
    createEmptyProject,
    defaultBomSettings,
    defaultQuoteSettings,
    identityTextureTransform,
    segmentsFromDrafts,
    setGlassAssignments,
    updateBomSettings,
    updateNumbering,
    updateQuoteSettings,
    type BomSettings,
    type GlassId,
    type OpenedFile,
    type PieceId,
    type PieceTextureTransform,
    type QuoteSettings,
  } from '@vitrum/model'

  import { panelWeight, type DrcInput } from '@vitrum/drc'
  import { onDestroy } from 'svelte'

  import { BomController } from '../bom/controller.svelte'
  import { QuoteController } from '../quote/controller.svelte'
  import type { PriceBookController } from '../quote/priceBook.svelte'

  import CalibrationDialog from '../canvas/CalibrationDialog.svelte'
  import type { TechniqueRender } from '../canvas/render'
  import { defaultSymmetryCenter, documentBounds, panelRect } from '../canvas/scene'
  import { ViewportController } from '../canvas/viewport.svelte'
  import type { DocumentController } from '../document/controller.svelte'
  import type { OpenedImage } from '../document/host'
  import { DrcController } from '../drc/controller.svelte'
  import { AssignmentController } from '../glass/assignment.svelte'
  import GlassDock from '../glass/GlassDock.svelte'
  import type { GlassLibraryController } from '../glass/library.svelte'
  import { LightController } from '../light/controller.svelte'
  import { NestController } from '../nest/controller.svelte'
  import { NumberingController } from '../numbering/controller.svelte'
  import { ExportController, type SavePdf } from '../export/controller.svelte'
  import ExportDialog from '../export/ExportDialog.svelte'
  import { buildExportScene } from '../export/scene'
  import { ImportController } from '../import/controller.svelte'
  import ImportDialog from '../import/ImportDialog.svelte'
  import { TraceController } from '../trace/controller.svelte'
  import TraceDialog from '../trace/TraceDialog.svelte'
  import { ReferenceController } from '../reference/controller.svelte'
  import { PrintController } from '../print/controller.svelte'
  import { buildPrintScene } from '../print/scene'
  import { ToolController } from '../tools/controller.svelte'
  import type { VersionController } from '../versions/controller.svelte'
  import { EditController } from '../tools/edit.svelte'
  import { PaintController } from '../tools/paint.svelte'
  import { ReinforcementController } from '../tools/reinforcement.svelte'
  import { SelectionController } from '../tools/selection.svelte'
  import { SnapController } from '../tools/snap.svelte'
  import { SymmetryController } from '../tools/symmetry.svelte'

  import type { PrintTileOverlay } from '../canvas/render'

  import ActivityRail from './ActivityRail.svelte'
  import BenchOutputs from './BenchOutputs.svelte'
  import QuotePanel from './QuotePanel.svelte'
  import Canvas from './Canvas.svelte'
  import type { PieceNote } from './CutListTable.svelte'
  import { type DockSection } from './dock'
  import DockPanel from './DockPanel.svelte'
  import Inspector, { type PanelStat } from './Inspector.svelte'
  import NestPanel from './NestPanel.svelte'
  import NestView from './NestView.svelte'
  import OutputDrawer, { type DrawerTab } from './OutputDrawer.svelte'
  import OverlaysChip from './OverlaysChip.svelte'
  import ReferenceOverlay from './ReferenceOverlay.svelte'
  import NumberingPanel, { type LegendEntry } from './NumberingPanel.svelte'
  import RulesPanel from './RulesPanel.svelte'
  import StatusBar from './StatusBar.svelte'
  import { activeTool } from './tools'
  import VersionsPanel from './VersionsPanel.svelte'
  import TopBar from './TopBar.svelte'
  import ViewBanner from './ViewBanner.svelte'
  import ViewportChip from './ViewportChip.svelte'
  import { VIEW_MODES, type ViewMode } from './viewmode'

  interface Props {
    panel: Panel
    /** The document controller (F-002). Optional so the shell renders in isolation tests. */
    controller?: DocumentController
    /** The global glass library controller (F-022). Optional so the shell renders in isolation. */
    glassLibrary?: GlassLibraryController
    /** The version-history controller (F-055). Optional so the shell renders in isolation. */
    versions?: VersionController
    /** The global workshop price book controller (F-056). Optional so the shell renders in isolation. */
    priceBook?: PriceBookController
    /** Writes a generated PDF to the host (F-041). Absent ⇒ printing is unavailable. */
    exportPdf?: SavePdf
    /** Writes a generated text document (CSV / SVG / DXF) to the host (F-042/F-043). */
    exportText?: (suggestedName: string, text: string) => Promise<string | null>
    /** Writes raw image bytes (the PNG snapshot) to the host (F-043). */
    exportPng?: (suggestedName: string, bytes: Uint8Array) => Promise<string | null>
    /** Reads an SVG file to import into the active document (F-050). Absent ⇒ import is hidden. */
    importSvg?: () => Promise<OpenedFile | null>
    /** Reads a raster image to add as a reference underlay (F-051). Absent ⇒ the add button hides. */
    importImage?: () => Promise<OpenedImage | null>
    /** Leave the editor for the panel library (F-058 FR-5). Absent ⇒ the back button stays inert. */
    onLibrary?: () => void
    /**
     * Set when the panel was just created "from a photo" (F-058 FR-12): the shell runs F-051's
     * reference-image import once and calls {@link onPhotoImported}. Cancelling the file dialog is a
     * no-op inside the import, so the panel is simply left blank — never half-created.
     */
    photoRequested?: boolean
    onPhotoImported?: () => void
    /** Open the dock on a section — used to land on History from the library's hero (FR-9). */
    initialSection?: DockSection
  }

  let {
    panel,
    controller,
    glassLibrary,
    versions,
    priceBook,
    exportPdf,
    exportText,
    exportPng,
    importSvg,
    importImage,
    onLibrary,
    photoRequested = false,
    onPhotoImported,
    initialSection,
  }: Props = $props()

  // The viewport (F-003) is independent of the document controller, so the shell always
  // owns one — tests render without a controller, the app renders with one.
  const viewport = new ViewportController()

  // The drawing-tool controller (F-011). It needs a command sink; when no document
  // controller is present (isolation tests) commits are simply dropped.
  const tools = new ToolController({
    viewport,
    execute: (command) => controller?.execute(command),
    getSegments: () => (controller ? Object.values(controller.doc.segments) : []),
    getNodes: () => (controller ? controller.doc.nodes : {}),
  })

  // The snapping controller (F-012) replaces the tool controller's identity resolver with
  // one that snaps to nodes, intersections, the grid and construction guides.
  const snap = new SnapController(viewport)

  // Live symmetry (F-052). Owns the document's symmetry setup and the two seams that make replicas
  // appear: pointer canonicalization (composed in front of the snap resolver below, so drawing is
  // confined to the source sector) and the pure replica expansion consumed by detection/outputs.
  const symmetry = new SymmetryController({
    getDoc: () => controller?.doc ?? createEmptyProject(),
    execute: (command) => controller?.execute(command),
    // The panel's centre, so "draw one half" puts the replicas on the glass. The original
    // 2026-07-22 default was the world origin, which is the panel's top-left *corner* — every
    // axis and spoke anchored off the panel (run 2026-08-16-a, F-052 finding 1). Editable from
    // the Draw panel's centre fields; on-canvas handles are still a follow-up.
    defaultCenter: () => (controller ? defaultSymmetryCenter(controller.doc) : vec2(0, 0)),
  })
  // Fold every pointer into the source sector before snapping (Decision §1 / FR-5): a click
  // anywhere authors geometry in the source, which then replicates live. No tool contract changes.
  tools.resolver = (world, ctx) => snap.resolver(symmetry.canonicalize(world), ctx)

  // Selection + editing (F-013). Selection lives outside the document; the edit controller
  // drives the inert `select` tool (click/marquee, node & handle drag, transforms).
  const selection = new SelectionController()
  const edit = new EditController({
    viewport,
    selection,
    snap,
    getDoc: () => controller?.doc ?? createEmptyProject(),
    execute: (command, options) => controller?.execute(command, options),
  })

  // Reference-image underlay (F-051). Owns the embedded image blobs and layer edits; its assets are
  // packed into / read from the `.vitrum` zip via the document controller's collect/load hooks.
  const reference = new ReferenceController({
    getDoc: () => controller?.doc ?? createEmptyProject(),
    execute: (command, options) => controller?.execute(command, options),
  })
  $effect(() => {
    if (!controller) return
    controller.collectAssets = () => reference.collectAssets()
    controller.loadAssets = (assets) => reference.loadAssets(assets)
  })
  function openAddReference(): void {
    if (importImage) void reference.importImage(importImage)
  }

  const segments = $derived(controller ? Object.values(controller.doc.segments) : [])
  // Hidden guides drop out of both rendering and snapping (F-012 visibility toggle).
  const shownSegments = $derived(
    viewport.guidesVisible ? segments : segments.filter((s) => s.role !== 'construction'),
  )
  // Derived symmetry replicas (F-052): read-only linework the canvas renders and the outputs
  // consume, expanded from the source by the pure core transform. Empty when symmetry is off.
  const replicaSegments = $derived<readonly import('@vitrum/model').Segment[]>(
    controller ? controller.replicaNetwork() : [],
  )

  // The panel rectangle the canvas frames the drawing with (F-058): the size the new-panel dialog
  // asked for, finally visible. `null` on a document with no panel size, and only in the design
  // view — it is a drawing aid, so it stays out of the four derived readings.
  const panelFrame = $derived<BBox | null>(controller ? panelRect(controller.doc) : null)

  // Bounds frame the full design (source + replicas), so zoom-to-fit sees the whole rosette.
  const bounds = $derived.by<BBox | null>(() => {
    if (!controller) return null
    let box = documentBounds(controller.doc)
    for (const seg of replicaSegments) {
      const b = bboxOf(seg.geometry)
      box = box ? bboxUnion(box, b) : b
    }
    return box
  })

  // Symmetry axis/spoke guides, sized to the framed content so they span the panel.
  const symmetryAxes = $derived(
    symmetry.active ? symmetry.axisSegments(symmetryRadius(bounds)) : [],
  )

  // The source fundamental domain to shade (where drawing lands) and the live tool preview mirrored
  // into the replica sectors, so drawing shows the full symmetric result live (F-052 UX).
  const symmetryDomain = $derived(symmetry.active ? symmetry.sourceDomain : null)
  const previewReplicaShapes = $derived(
    symmetry.active ? symmetry.previewReplicas(tools.previewShapes) : [],
  )

  /** A guide radius (mm) big enough to span the framed content from the symmetry center. */
  function symmetryRadius(b: BBox | null): number {
    if (!b) return 500
    const diag = Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y)
    return Math.max(diag, 100)
  }

  /** Read a PNG's pixel dimensions from its IHDR chunk (bytes 16–24), for the quote image aspect. */
  function pngSize(bytes: Uint8Array): { w: number; h: number } {
    if (bytes.length < 24) return { w: 1, h: 1 }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { w: view.getUint32(16) || 1, h: view.getUint32(20) || 1 }
  }

  // Rebuild the snap spatial index whenever the visible network changes. Snapping stays over the
  // *source* only (replicas are read-only), so editing is confined to the source sector.
  $effect(() => snap.updateScene(shownSegments))

  // Piece detection (F-020). Feeds both the inspector (always) and the dev overlay (when its
  // toggle is on). Reads `controller.doc` inside `detect()`, so it re-runs on edits. Capped so
  // the debug stress scene (thousands of segments) doesn't stall the render path.
  const DETECT_SEGMENT_CAP = 2000
  const detection = $derived(
    controller && segments.length <= DETECT_SEGMENT_CAP ? controller.detect() : null,
  )
  const pieces = $derived(detection?.pieces ?? [])
  const diagnostics = $derived(detection?.diagnostics ?? [])

  // Glass assignment (F-023). The document stores only what the user painted; this controller
  // resolves each piece's effective glass (direct, or inherited across splits/merges via the
  // detector lineage). It also owns the "selected glass" the paint tool assigns.
  const assignments = new AssignmentController()
  $effect(() => {
    if (!controller) return
    assignments.update(detection, pieces, detection?.lineage ?? {}, controller.doc.assignments)
  })

  // Piece numbering (F-040). Resolves each live piece's effective number (from the last renumber or a
  // manual override, inherited across edits via the detector lineage the way glass is). The stored
  // numbers change only on an explicit renumber, never on a geometry edit (FR-3).
  const numbering = new NumberingController()
  $effect(() => {
    if (!controller) return
    numbering.update(detection, pieces, detection?.lineage ?? {}, controller.doc.numbering)
  })

  // The paint / piece-select controller (F-023). Assignments key off project glasses, so painting a
  // library swatch auto-imports a project copy first (handled in the glass dock).
  const paint = new PaintController({
    viewport,
    assignments,
    getPieces: () => pieces,
    execute: (command) => controller?.execute(command),
  })

  // Reinforcement bars (F-032): a first-class document entity placed across the panel. Its own
  // interactive controller (parallel to paint) since a bar is not a lead-line segment.
  const reinforce = new ReinforcementController({
    viewport,
    getBars: () => controller?.doc.reinforcements ?? [],
    execute: (command, options) => controller?.execute(command, options),
  })

  const projectGlasses = $derived(controller?.doc.glasses ?? {})
  const reinforcements = $derived(controller?.doc.reinforcements ?? [])
  const unassignedCount = $derived(pieces.filter((p) => !assignments.glassFor(p)).length)
  const unnumberedCount = $derived(numbering.unnumberedCount(pieces))

  // The glass legend (F-040 FR-4): one row per glass actually in use, with its code and piece count.
  // Recomputed from the live pieces + effective glass, so it always matches current assignments.
  const legend = $derived.by<LegendEntry[]>(() => {
    if (!controller) return []
    const codes = controller.doc.numbering.glassCodes
    const counts: Record<GlassId, number> = {}
    for (const piece of pieces) {
      const g = assignments.glassFor(piece)
      if (g) counts[g] = (counts[g] ?? 0) + 1
    }
    return Object.entries(counts)
      .map(([glassId, count]) => {
        const glass = controller.doc.glasses[glassId]
        return {
          glassId,
          code: codes[glassId] ?? '?',
          name: glass?.name ?? 'Unknown glass',
          manufacturer: glass?.manufacturer,
          count,
        }
      })
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  })

  // --- Numbering actions (F-040) ---------------------------------------------

  /** Renumber every piece under the current scheme, keeping manual overrides (FR-1). One undo step. */
  function renumberPieces(): void {
    if (!controller) return
    const result = renumber({
      pieces,
      scheme: controller.doc.numbering.scheme,
      glassOf: (piece) => assignments.glassFor(piece),
      glassCodes: controller.doc.numbering.glassCodes,
      overrides: Object.fromEntries(numbering.effectiveOverrides),
    })
    controller.execute(updateNumbering({ auto: result.auto, glassCodes: result.glassCodes }))
  }

  function setScheme(scheme: NumberingScheme): void {
    controller?.execute(updateNumbering({ scheme }))
  }

  /** Edit a glass's code, keeping the rest of the map. Clearing (empty) drops the entry. */
  function setGlassCode(glassId: GlassId, code: string): void {
    if (!controller) return
    const glassCodes = { ...controller.doc.numbering.glassCodes }
    if (code === '') delete glassCodes[glassId]
    else glassCodes[glassId] = code
    controller.execute(updateNumbering({ glassCodes }))
  }

  // --- Output hub: the single Export dialog (F-043, consolidated) ------------

  // The 1:1 tiled template's settings + tiling live on the F-041 print controller; the export dialog
  // composes it (plus the F-042 BOM controller) rather than owning a separate dialog.
  const print = new PrintController()
  // The export hub's own state (document type + design PDF / SVG / DXF / PNG options).
  const exporter = new ExportController()
  // The canvas hands back a PNG-snapshot getter once mounted (rasterises the live design).
  let takeSnapshot: (() => Promise<Uint8Array | null>) | undefined

  const exportAvailable = $derived(!!bounds && (!!exportText || !!exportPdf))

  // The tile grid previewed on the canvas while the export dialog's 1:1 tiled type is active
  // (world-space rectangles) — preserved from the F-041 PrintDialog preview.
  const printTiles = $derived.by<PrintTileOverlay[]>(() => {
    if (!(exporter.open && exporter.docType === 'tiled')) return []
    const tiling = print.tilingFor(bounds)
    if (!tiling) return []
    return tiling.tiles.map((tile) => ({
      min: vec2(tile.worldRect.x, tile.worldRect.y),
      max: vec2(tile.worldRect.x + tile.worldRect.w, tile.worldRect.y + tile.worldRect.h),
      label: tile.label,
    }))
  })

  const legendRows = () =>
    legend.map((row) => ({
      code: row.code,
      name: row.name,
      manufacturer: row.manufacturer,
      color: controller?.doc.glasses[row.glassId]?.color,
      count: row.count,
    }))

  /** Build the F-041 print scene (1:1 tiled document type) from the live derived data. */
  function buildTiledScene(ctrl: DocumentController, b: BBox) {
    return buildPrintScene({
      contentBounds: b,
      segments: ctrl.outputNetwork(),
      leadWidthMm: (seg) =>
        techniqueRender
          ? techniqueRender.leadWidthMm(seg.id, seg.role)
          : seg.role === 'border'
            ? 2
            : 1,
      pieces,
      cutContours: drcCutContours,
      glassFor: (piece) => assignments.glassFor(piece),
      glasses: projectGlasses,
      labelFor: (piece) => numbering.labelFor(piece),
      placementFor: (piece) => numbering.placements.get(pieceKey(piece)),
      legend: legendRows(),
    })
  }

  /** Build the F-043 export scene (design sheet / design files) from the live derived data. */
  function buildDesignScene(ctrl: DocumentController, b: BBox) {
    return buildExportScene({
      contentBounds: b,
      segments: ctrl.outputNetwork(),
      leadWidthMm: (seg) =>
        techniqueRender
          ? techniqueRender.leadWidthMm(seg.id, seg.role)
          : seg.role === 'border'
            ? 2
            : 1,
      pieces,
      pieceKeyOf: (piece) => pieceKey(piece),
      cutContours: drcCutContours,
      glassFor: (piece) => assignments.glassFor(piece),
      glasses: projectGlasses,
      labelFor: (piece) => numbering.labelFor(piece),
      placementFor: (piece) => numbering.placements.get(pieceKey(piece)),
      reinforcements,
      legend: legendRows(),
    })
  }

  // --- SVG import (F-050) ----------------------------------------------------

  const importer = new ImportController()

  /** Open the import dialog, reading the chosen SVG through the host. */
  function openImport(): void {
    if (importSvg) void importer.load(importSvg)
  }

  /**
   * Merge the healed imported network into the active document as one undo step (decision #4). The
   * healed drafts become welded segments (coincident endpoints share a node, F-013) added in a single
   * `addSegments` command, so one undo removes the whole import and redo reproduces it (FR-3).
   */
  function runImport(): void {
    const p = importer.preview
    if (!controller || !p || p.segments.length === 0) return
    const segments = segmentsFromDrafts(toDrafts(p.segments), controller.doc.nodes)
    controller.execute(addSegments(segments))
    importer.close()
  }

  // --- Raster autotrace (F-059) ----------------------------------------------

  // The pipeline runs on a worker so a slider drag never blocks the canvas (FR-7); the controller
  // falls back to running it inline where workers are unavailable.
  const tracer = new TraceController()
  $effect(() => () => tracer.dispose())

  /** Open the autotrace dialog on the selected reference layer (F-059). */
  function openTrace(): void {
    const layer = reference.selected
    if (!layer) return
    void tracer.load(layer, reference.assets.get(layer.assetId))
  }

  /**
   * Merge the traced network into the active document as one undo step (FR-5), by exactly the same
   * route as the SVG import (F-050): the traced drafts carry no ids, `segmentsFromDrafts` welds
   * coincident endpoints onto shared nodes (F-013), and one `addSegments` command lands the lot — so
   * one undo removes the whole trace and redo reproduces it identically.
   */
  function runTrace(): void {
    const p = tracer.preview
    if (!controller || !p || p.segments.length === 0) return
    const traced = segmentsFromDrafts(p.segments, controller.doc.nodes)
    controller.execute(addSegments(traced))
    tracer.close()
  }

  /** Open the export dialog, seeding technique-aware defaults (F-043). */
  function openExport(): void {
    if (technique) exporter.applyTechniqueDefaults(technique.kind)
    exporter.open = true
  }

  /**
   * Dispatch the dialog's current document type to its runner and close on success. Every output
   * routes through here (F-043 consolidation): the design PDF / SVG / DXF via `ExportController`, the
   * 1:1 tiled template via `PrintController` (F-041), the cutting list / BOM via `BomController`
   * (F-042), and the PNG snapshot via the canvas getter.
   */
  async function runOutput(): Promise<void> {
    if (!controller || !bounds) return
    let path: string | null = null
    switch (exporter.docType) {
      case 'tiled':
        if (exportPdf)
          path = await print.export(buildTiledScene(controller, bounds), panel.name, exportPdf)
        break
      case 'bom':
        if (bomReport && exporter.bomFormat === 'pdf' && exportPdf)
          path = await bom.exportPdf(bomReport, panel.name, viewport.unit, exportPdf)
        else if (bomReport && exporter.bomFormat === 'csv' && exportText)
          path = await bom.exportCsv(bomReport, panel.name, viewport.unit, exportText)
        break
      case 'quote': {
        if (!quoteReport || !exportPdf) break
        // Optionally embed the rendered panel snapshot (F-053 render view if active, flat otherwise).
        let panelImage:
          { data: Uint8Array; format: 'png'; widthPx: number; heightPx: number } | undefined
        if (quote.includePanelImage) {
          const bytes = (await takeSnapshot?.()) ?? null
          if (bytes) {
            const size = pngSize(bytes)
            panelImage = { data: bytes, format: 'png', widthPx: size.w, heightPx: size.h }
          }
        }
        path = await quote.exportPdf(
          quoteReport,
          {
            projectName: panel.name,
            unit: viewport.unit,
            client: controller.doc.quote.client,
            date: new Date().toISOString().slice(0, 10),
            includeBreakdown: quote.includeBreakdown,
            ...(panelImage ? { panelImage } : {}),
          },
          exportPdf,
        )
        break
      }
      case 'png': {
        const bytes = (await takeSnapshot?.()) ?? null
        if (exportPng) path = await exporter.runPng(bytes, panel.name, exportPng)
        break
      }
      default:
        path = await exporter.run(buildDesignScene(controller, bounds), panel.name, {
          saveText: exportText,
          savePdf: exportPdf,
        })
    }
    if (path !== null) exporter.open = false
  }

  /** Set or clear a manual per-piece number override (FR-1). Keyed by content id. */
  function setPieceNumber(pieceContentId: PieceId, label: string | null): void {
    if (!controller) return
    const overrides = { ...controller.doc.numbering.overrides }
    if (label === null || label === '') delete overrides[pieceContentId]
    else overrides[pieceContentId] = label
    controller.execute(updateNumbering({ overrides }))
  }

  // Design rule checks (F-030). The engine runs off the main thread (debounced live, immediate on
  // "Run checks"); this shell builds its input from the derived data and routes the results into the
  // Rules panel, the canvas markers, the readiness strip and the activity-rail badge.
  const drc = new DrcController({
    execute: (command) => controller?.execute(command),
    zoomTo: (at) => viewport.centerOn(at),
  })
  onDestroy(() => drc.dispose())

  // Content ids of pieces with an *effective* glass (direct or inherited), so `unassigned-glass`
  // respects F-023 inheritance rather than only the stored map.
  const assignedKeys = $derived(
    pieces.filter((p) => assignments.glassFor(p)).map((p) => pieceKey(p)),
  )
  // Each piece's effective glass (content id → glass id), so the structural weight rule (F-032) can
  // read glass thickness; inheritance is already resolved by the assignment controller.
  const effectiveGlass = $derived(
    Object.fromEntries(
      pieces
        .map((p) => [pieceKey(p), assignments.glassFor(p)] as const)
        .filter((entry): entry is readonly [string, GlassId] => entry[1] !== undefined),
    ),
  )
  // The technique-inset cut contours the cuttability pack (F-031) checks. Computed unconditionally
  // for DRC (the overlay's copy at `cutContours` is gated on visibility); the cache makes the second
  // call in a cycle free.
  const drcCutContours = $derived(
    controller && pieces.length > 0 ? controller.cutContours(pieces) : [],
  )
  const drcInput = $derived<DrcInput | null>(
    controller
      ? {
          project: controller.doc,
          pieces,
          diagnostics,
          cutContours: drcCutContours,
          assignedKeys,
          effectiveGlass,
        }
      : null,
  )
  // Live mode: re-run (debounced) whenever the document or its derived data changes.
  $effect(() => {
    if (drcInput) drc.schedule(drcInput)
  })

  // --- Cutting list & bill of materials (F-042) ------------------------------

  const bom = new BomController()

  // Panel weight reuses F-032's estimator; the pure BOM calc takes it as an input so `core` stays a
  // leaf (no core → drc edge).
  const bomWeight = $derived(
    drcInput ? panelWeight(drcInput) : { grams: 0, glassGrams: 0, leadGrams: 0 },
  )

  // The live cutting list / BOM, derived from the same snapshotted data everything else reads, so it
  // regenerates on any relevant edit and no stale data is reachable (FR-2).
  const bomReport = $derived.by(() => {
    if (!controller) return null
    return computeBom({
      technique: controller.doc.technique,
      pieces,
      cutContours: drcCutContours,
      segments: controller.outputNetwork(),
      glasses: projectGlasses,
      glassCodes: controller.doc.numbering.glassCodes,
      glassByPiece: effectiveGlass,
      labelByPiece: Object.fromEntries(numbering.labels),
      reinforcements,
      factors: controller.doc.bom,
      weight: bomWeight,
    })
  })

  function setBomFactor(patch: Partial<BomSettings>): void {
    controller?.execute(updateBomSettings(patch))
  }

  /** Write the live cutting list straight out as CSV from the drawer (F-042). */
  function exportCutListCsv(): void {
    if (bomReport && exportText)
      void bom.exportCsv(bomReport, panel.name, viewport.unit, exportText)
  }

  // The cutting list / BOM export is dispatched by `runOutput` (the single Export dialog), not from
  // the BOM panel; the panel keeps the live table, factor editing and row-hover highlight.
  const hasBom = $derived(bomReport !== null && pieces.length > 0)

  // --- Cost estimation & quoting (F-056) -------------------------------------

  const quote = new QuoteController()

  // Per-piece metrics for the labor model + sensitivity view. Complexity comes from each piece's own
  // geometry (perimeter vs bounding box), so it is independent of the cut contour.
  const quotePieces = $derived<QuotePieceMetric[]>(
    pieces.map((p) => ({
      contentId: pieceKey(p),
      pieceId: p.id,
      label: numbering.labelFor(p) ?? '',
      glassId: assignments.glassFor(p) ?? null,
      areaMm2: p.area,
      perimeterMm: p.perimeter,
      bboxWidthMm: p.bbox.max.x - p.bbox.min.x,
      bboxHeightMm: p.bbox.max.y - p.bbox.min.y,
    })),
  )

  // The live quote, derived from the same BOM + the persisted quote intent, so it regenerates on any
  // relevant edit (FR-2). The model's quote sub-objects are structurally the core's quote inputs.
  const quoteReport = $derived.by(() => {
    if (!controller || !bomReport) return null
    const q = controller.doc.quote
    return computeQuote(
      {
        bom: bomReport,
        currency: q.currency,
        priceBook: q.priceBook,
        labor: q.labor,
        overheadPct: q.overheadPct,
        marginPct: q.marginPct,
        manualLines: q.manualLines,
        pieces: quotePieces,
      },
      viewport.unit,
    )
  })
  const hasQuote = $derived(quoteReport !== null && pieces.length > 0)

  function setQuote(patch: Partial<QuoteSettings>): void {
    controller?.execute(updateQuoteSettings(patch))
  }

  /** Save the current project's price book as the global workshop default (F-056 FR-5). */
  function saveWorkshopDefault(): void {
    if (controller && priceBook) void priceBook.saveDefault(controller.doc.quote.priceBook)
  }
  /** Load the workshop default price book into the project (one undo entry). */
  function loadWorkshopDefault(): void {
    if (priceBook) setQuote({ priceBook: priceBook.defaultBook })
  }

  // What the active tool's next click does. The Draw palette and the status bar read the same line,
  // so the hint follows the pointer's attention rather than living in one place.
  const toolHint = $derived(
    activeTool({ toolId: tools.activeId, paintMode: paint.mode, barMode: reinforce.mode }).hint,
  )

  // Materialise inherited/reshaped assignments under each live piece's current content id right
  // before a save, so colours split or reshaped this session persist across reload (FR-5).
  function normalizeAssignments(): void {
    if (!controller) return
    const stored = controller.doc.assignments
    const patch: Record<PieceId, GlassId | null> = {}
    const live: Record<PieceId, true> = {}
    for (const piece of pieces) {
      const key = pieceKey(piece)
      live[key] = true
      const glass = assignments.glassFor(piece)
      if (glass && stored[key] !== glass) patch[key] = glass
    }
    // Drop assignments whose piece no longer exists, so the file mirrors the current panel.
    for (const key of Object.keys(stored)) if (!live[key]) patch[key] = null
    if (Object.keys(patch).length > 0) controller.execute(setGlassAssignments(patch))
  }

  // Materialise inherited/reshaped numbers under each live piece's current content id before a save,
  // so numbers split or reshaped this session persist across reload (mirrors the assignment
  // normaliser). Rebuilds both `auto` and `overrides` under current ids and drops vanished pieces.
  function normalizeNumbering(): void {
    if (!controller) return
    const cur = controller.doc.numbering
    const auto: Record<PieceId, string> = {}
    const overrides: Record<PieceId, string> = {}
    for (const piece of pieces) {
      const key = pieceKey(piece)
      const a = numbering.effectiveAuto.get(key)
      const o = numbering.effectiveOverrides.get(key)
      if (a !== undefined) auto[key] = a
      if (o !== undefined) overrides[key] = o
    }
    const same = (
      x: Readonly<Record<string, string>>,
      y: Readonly<Record<string, string>>,
    ): boolean => {
      const kx = Object.keys(x)
      if (kx.length !== Object.keys(y).length) return false
      return kx.every((k) => x[k] === y[k])
    }
    if (!same(auto, cur.auto) || !same(overrides, cur.overrides)) {
      controller.execute(updateNumbering({ auto, overrides }))
    }
  }

  $effect(() => {
    if (controller)
      controller.onBeforeSave = () => {
        normalizeAssignments()
        normalizeNumbering()
      }
  })

  /**
   * Hand the document layer this panel's derived figures for the library index (F-058 FR-10). Read on
   * the save path only — everything here is already computed for the editor, so indexing costs nothing
   * extra, which is exactly why the index is written at save rather than at browse time.
   *
   * The three judgements mirror the readiness meter (geometry closes / every piece has glass / checks
   * are clear) so the library and the cockpit never disagree about whether a panel is ready.
   */
  $effect(() => {
    if (!controller) return
    controller.indexFacts = () => ({
      panes: pieces.length,
      paintedPanes: Math.max(0, pieces.length - unassignedCount),
      leadLengthMm: bomReport
        ? technique?.kind === 'foil'
          ? (bomReport.foil?.netSeamLengthMm ?? 0)
          : bomReport.came.reduce((sum, c) => sum + c.netLengthMm, 0)
        : 0,
      checksOutstanding: drc.result.counts.error + drc.result.counts.warning,
      checksRun: drc.hasRun,
    })
  })

  // "Start a panel → from a photo" (FR-12): run F-051's import once for a just-created panel.
  $effect(() => {
    if (!photoRequested) return
    onPhotoImported?.()
    if (importImage) void reference.importImage(importImage)
  })

  // Version history (F-055). Point the controller at the open document's history (keyed by path,
  // Decision §1), and feed it every document change so it can take automatic snapshots (FR-1).
  $effect(() => {
    if (versions && controller) void versions.useDocument(controller.currentPath)
  })
  $effect(() => {
    if (!versions || !controller) return
    // Read `doc` so this re-runs on every command (each produces a new document identity), and
    // `isDirty` so a clean load/save resets the snapshot baseline rather than counting as an edit.
    void controller.doc
    versions.onChange(controller.isDirty)
  })

  /** Export a self-contained shared copy (FR-7); the working document is untouched. */
  function shareCopy(note: string): void {
    void controller?.exportForSharing(note || undefined)
  }
  /** Detach a read-only shared document into an editable copy (FR-8). */
  function editSharedCopy(): void {
    void controller?.editCopy()
  }

  const hoveredPieceId = $derived.by(() => {
    const world = viewport.cursorWorld
    // Hover feedback for the piece dev overlay (F-020) and paint/select modes (F-023).
    if (!world || !(viewport.piecesVisible || paint.active)) return null
    let best: string | null = null
    let bestArea = Infinity
    for (const piece of pieces) {
      if (pointInPolygon(polygon(piece.ring, piece.holeRings), world) && piece.area < bestArea) {
        best = piece.id
        bestArea = piece.area
      }
    }
    return best
  })

  // Technique model (F-021): how the network is styled (lead came flange vs thin foil solder
  // line), plus the technique-derived cut contours (computed only when the overlay is on).
  const technique = $derived(controller?.doc.technique)
  const techniqueRender = $derived<TechniqueRender | undefined>(
    technique
      ? {
          kind: technique.kind,
          solderFinish: technique.foil.solderFinish,
          leadWidthMm: (segmentId: string) => leadFlangeMm(technique, segmentId),
        }
      : undefined,
  )
  const cutContours = $derived(
    controller && viewport.cutsVisible && pieces.length > 0 ? controller.cutContours(pieces) : [],
  )

  // Realistic render (F-053): the persisted backlight, and a resolver for per-piece texture
  // placements keyed by content id (identity when the user has not set one). Both feed the WebGL
  // render pass; the render itself is a derived view, so only this intent is persisted.
  const renderSettings = $derived(controller?.doc.render)
  const backlight = $derived({
    intensity: renderSettings?.backlightIntensity ?? 1,
    warmth: renderSettings?.backlightWarmth ?? 0,
  })
  const textureTransforms = $derived(renderSettings?.textureTransforms ?? {})
  function textureTransformFor(piece: Piece): PieceTextureTransform {
    return textureTransforms[pieceKey(piece)] ?? identityTextureTransform()
  }

  // Sunlight simulation (F-054): the light view's resolved sun + transient scrub/animation state.
  // Reads the persisted `light` block; edits are ordinary undoable commands. The resolved sun is a
  // pure core derivation, so nothing extra is persisted.
  const light = new LightController({
    getDoc: () => controller?.doc ?? createEmptyProject(),
    execute: (command) => controller?.execute(command),
  })
  onDestroy(() => light.dispose())

  // Sheet nesting (F-057): lays each glass's assigned pieces onto sheets. The nested layout is a
  // derived output computed off the main thread from the live pieces + assignments + numbering; only
  // the tunable intent (cut allowance, per-glass sheet/rotation, seed) is persisted on `nesting`.
  const nest = new NestController({
    getDoc: () => controller?.doc ?? createEmptyProject(),
    execute: (command) => controller?.execute(command),
    getPieces: () => pieces,
    glassFor: (piece) => assignments.glassFor(piece),
    labelFor: (piece) => numbering.labelFor(piece),
  })
  onDestroy(() => nest.dispose())

  // Auto-nest the first time the nest view is opened with something to nest, so it never shows an
  // empty stage when a layout could be computed. Later geometry/setting changes re-nest via the
  // panel's explicit "Re-nest" / "Reshuffle" actions.
  $effect(() => {
    if (viewMode === 'nest' && !nest.hasRun && !nest.running && nest.canNest) void nest.run()
  })

  /** Capture a PNG photo of the lit stage (F-054 FR-6): reuse the F-043 snapshot + export port. */
  async function capturePhoto(): Promise<void> {
    if (!exportPng) return
    const bytes = (await takeSnapshot?.()) ?? null
    if (bytes) await exporter.runPng(bytes, panel.name, exportPng)
  }

  let calibrationOpen = $state(false)

  // Cockpit v2 shell state. The dock opens on "draw" — a new panel starts as geometry, and the
  // drawing tools are what the first click needs.
  let viewMode = $state<ViewMode>('design')
  // svelte-ignore state_referenced_locally
  let dockSection = $state<DockSection>(initialSection ?? 'draw')
  // A later request from the library (e.g. the hero's "Version history") switches the dock.
  $effect(() => {
    if (initialSection) dockSection = initialSection
  })
  // The bench-outputs drawer under the stage (cutting list / BOM / quote). Closed until asked for,
  // because it costs the canvas 266px.
  let drawerOpen = $state(false)
  let drawerTab = $state<DrawerTab>('cut')

  function openDrawer(tab: DrawerTab): void {
    drawerTab = tab
    drawerOpen = true
  }

  /**
   * Switch the reading on the stage. The selection is dropped with it: the derived views are
   * read-only, so a piece picked in the design view would otherwise hold the inspector on controls
   * that cannot act on what is being shown.
   */
  function setViewMode(mode: ViewMode): void {
    if (mode === viewMode) return
    viewMode = mode
    paint.clearSelection()
    selection.clear()
    reinforce.selectedId = null
  }

  /** The 1:1 tiled template, reached from the cartoon inspector and the Make section. */
  function openTemplate(): void {
    if (!exportAvailable) return
    exporter.docType = 'tiled'
    exporter.open = true
  }

  // The per-piece note the cutting list shows: the most severe DRC violation touching that piece,
  // so a cutter reading the bench list sees what would go wrong before cutting it.
  const pieceNotes = $derived.by<Record<string, PieceNote>>(() => {
    const notes: Record<string, PieceNote> = {}
    for (const v of drc.result.violations) {
      for (const pieceId of v.pieceIds) {
        const blocking = v.severity === 'error'
        // Violations arrive most-severe first, so the first note for a piece is the one to show.
        if (!notes[pieceId] || (blocking && !notes[pieceId]!.blocking)) {
          notes[pieceId] = { text: v.title, blocking }
        }
      }
    }
    return notes
  })

  // Headline panel numbers for the inspector when nothing is selected: what this panel *is*.
  const panelStats = $derived<PanelStat[]>([
    { label: 'Pieces', value: String(pieces.length) },
    {
      label: 'Glass area',
      value: bomReport
        ? formatAreaLarge(
            bomReport.cutting.reduce((sum, g) => sum + g.netAreaMm2, 0),
            viewport.unit,
          )
        : '—',
    },
    {
      label: technique?.kind === 'foil' ? 'Foil seam' : 'Lead came',
      value: bomReport
        ? formatLength(
            technique?.kind === 'foil'
              ? (bomReport.foil?.netSeamLengthMm ?? 0)
              : bomReport.came.reduce((sum, c) => sum + c.netLengthMm, 0),
            viewport.unit,
          )
        : '—',
    },
    {
      label: 'Weight',
      value:
        bomWeight.grams >= 1000
          ? `${(bomWeight.grams / 1000).toFixed(2)} kg`
          : `${Math.round(bomWeight.grams)} g`,
    },
  ])

  /** What the Make section's cutting-list link summarises. */
  const cutSummary = $derived(
    bomReport
      ? `${pieces.length} piece${pieces.length === 1 ? '' : 's'} · ${formatAreaLarge(
          bomReport.cutting.reduce((sum, g) => sum + g.netAreaMm2, 0),
          viewport.unit,
        )} glass`
      : 'nothing to cut yet',
  )

  /** The mono one-liner in the dock header: the count that section is about. */
  const dockMeta = $derived.by(() => {
    switch (dockSection) {
      case 'draw':
        return `${segments.length} line${segments.length === 1 ? '' : 's'}`
      case 'glass':
        return `${Object.keys(projectGlasses).length} in project`
      case 'check': {
        const total = drc.result.counts.error + drc.result.counts.warning + drc.result.counts.info
        if (!drc.hasRun) return 'not run'
        return total === 0 ? 'clear' : `${total} issue${total === 1 ? '' : 's'}`
      }
      case 'make':
        return `${pieces.length} piece${pieces.length === 1 ? '' : 's'}`
      case 'cost':
        return controller?.doc.quote.currency.code ?? ''
      case 'history':
        return versions ? `${versions.snapshots.length} versions` : ''
    }
  })

  const viewMeta = $derived(VIEW_MODES.find((v) => v.id === viewMode))
  // What qualifies the derived reading currently on the stage.
  const bannerMeta = $derived.by(() => {
    if (viewMode === 'light') {
      const m = Math.round(light.effectiveMinutes)
      const clock = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      return `${clock} · az ${Math.round(light.sun.azimuthDeg)}°`
    }
    if (viewMode === 'nest') {
      const sheets = nest.result?.glasses.reduce((n, g) => n + g.sheets.length, 0) ?? 0
      return sheets > 0 ? `${sheets} sheet${sheets === 1 ? '' : 's'}` : 'not nested yet'
    }
    return 'read-only'
  })
</script>

{#snippet glassPanel()}
  {#if glassLibrary}
    <GlassDock
      {glassLibrary}
      {assignments}
      {paint}
      glasses={projectGlasses}
      execute={controller ? (command) => controller.execute(command) : undefined}
    />
  {/if}
{/snippet}

{#snippet checkPanel()}
  <RulesPanel
    {drc}
    doc={controller?.doc}
    onRun={() => {
      if (drcInput) void drc.runNow(drcInput)
    }}
  />
{/snippet}

{#snippet historyPanel()}
  {#if versions}
    <VersionsPanel
      {versions}
      readOnly={controller?.readOnly ?? false}
      onShare={controller ? shareCopy : undefined}
      onEditCopy={editSharedCopy}
    />
  {/if}
{/snippet}

{#snippet makePanel()}
  <NumberingPanel
    scheme={numbering.scheme}
    onScheme={setScheme}
    onRenumber={renumberPieces}
    onSetCode={setGlassCode}
    pieceCount={pieces.length}
    unnumbered={unnumberedCount}
    {legend}
  />
  <BenchOutputs
    {cutSummary}
    onOpenCutList={() => openDrawer('cut')}
    onPrintTemplate={exportAvailable && exportPdf ? openTemplate : undefined}
    templateSummary={print.tilingFor(bounds)
      ? `${print.tilingFor(bounds)!.tiles.length} tiles`
      : 'nothing to tile yet'}
  />
{/snippet}

{#snippet nestPanel()}
  <NestPanel {nest} glasses={projectGlasses} unit={viewport.unit} />
{/snippet}

{#snippet costPanel()}
  <QuotePanel
    report={quoteReport}
    settings={controller?.doc.quote ?? defaultQuoteSettings()}
    onPatch={setQuote}
    smallestN={quote.smallestN}
    onSmallestN={(n) => (quote.smallestN = n)}
    onHighlight={(pieceIds, segmentIds) => bom.highlight(pieceIds, segmentIds)}
    onClearHighlight={() => bom.clearHighlight()}
    onSaveWorkshopDefault={priceBook ? saveWorkshopDefault : undefined}
    onLoadWorkshopDefault={priceBook ? loadWorkshopDefault : undefined}
  />
  {#if hasQuote}
    <button class="breakdown" onclick={() => openDrawer('quote')}>
      Full breakdown &amp; line items
    </button>
  {/if}
{/snippet}

<div class="shell">
  <TopBar
    title={panel.name}
    {controller}
    doc={controller?.doc}
    execute={controller ? (command) => controller.execute(command) : undefined}
    {viewMode}
    onViewMode={setViewMode}
    onExport={exportText || exportPdf ? openExport : undefined}
    exportEnabled={exportAvailable && pieces.length > 0}
    onImport={importSvg && controller ? openImport : undefined}
    {onLibrary}
    onGoTo={(section) => (dockSection = section)}
    pieceCount={pieces.length}
    {unassignedCount}
    {unnumberedCount}
    checksRun={drc.hasRun}
    errorCount={drc.result.counts.error}
    warningCount={drc.result.counts.warning}
    infoCount={drc.result.counts.info}
  />
  <div class="body">
    <ActivityRail
      active={dockSection}
      onSelect={(section) => (dockSection = section)}
      attentionCount={drc.result.counts.error + drc.result.counts.warning}
    />
    <DockPanel
      section={dockSection}
      meta={dockMeta}
      {viewport}
      {tools}
      {paint}
      {reinforce}
      {snap}
      onClearGuides={controller ? () => controller.clearGuides() : undefined}
      symmetry={controller ? symmetry : undefined}
      {reference}
      onAddReference={importImage && controller ? openAddReference : undefined}
      editable={viewMode === 'design' || viewMode === 'render'}
      onEnterDesign={() => setViewMode('design')}
      glass={glassLibrary ? glassPanel : undefined}
      check={checkPanel}
      make={makePanel}
      cost={costPanel}
      history={versions ? historyPanel : undefined}
      nest={viewMode === 'nest' ? nestPanel : undefined}
    />
    <div class="stage">
      <div class="viewport">
        <Canvas
          {viewport}
          referenceLayers={reference.renderLayers}
          resolveReferenceSource={reference.resolveSource}
          referenceVersion={reference.sourcesVersion}
          segments={shownSegments}
          {replicaSegments}
          symmetryAxes={viewMode === 'cartoon' ? [] : symmetryAxes}
          symmetryCenter={symmetry.active ? symmetry.center : null}
          symmetryDomain={viewMode === 'cartoon' ? null : symmetryDomain}
          previewReplicaShapes={viewMode === 'cartoon' ? [] : previewReplicaShapes}
          {bounds}
          panelRect={viewMode === 'design' ? panelFrame : null}
          {tools}
          {snap}
          {edit}
          {selection}
          {paint}
          {pieces}
          {diagnostics}
          showGlass={viewport.glassVisible}
          glassAssignments={assignments.effective}
          glasses={projectGlasses}
          selectedPieces={paint.selectedPieces}
          showPieces={viewport.piecesVisible}
          {hoveredPieceId}
          technique={techniqueRender}
          {cutContours}
          showCuts={viewport.cutsVisible}
          violations={drc.markers}
          selectedViolationKey={drc.selectedKey}
          {reinforcements}
          {reinforce}
          cartoon={viewMode === 'cartoon'}
          showNumbers={viewport.numbersVisible}
          numberLabels={numbering.labels}
          numberPlacements={numbering.placements}
          {printTiles}
          bomHighlightPieces={bom.highlightPieces}
          bomHighlightSegments={bom.highlightSegments}
          snapshotRegister={(fn) => (takeSnapshot = fn)}
          renderMode={viewMode === 'render'}
          {backlight}
          {textureTransformFor}
          lightMode={viewMode === 'light'}
          sun={light.sun}
          lightTextures={controller?.doc.light.showTextures ?? true}
          photoGrain={controller?.doc.light.photoGrain ?? false}
          onCapturePhoto={exportPng ? capturePhoto : undefined}
        />
        {#if viewMode !== 'cartoon' && viewMode !== 'light' && viewMode !== 'nest'}
          <ReferenceOverlay controller={reference} {viewport} />
        {/if}
        {#if viewMode === 'nest'}
          <NestView
            result={nest.result}
            glasses={projectGlasses}
            unit={viewport.unit}
            busy={nest.running}
            onCuttingList={() => openDrawer('cut')}
          />
        {/if}
        {#if controller?.readOnly}
          <div class="readonly-banner" role="status">
            <span>Read-only shared file</span>
            <button type="button" onclick={editSharedCopy}>Edit a copy</button>
          </div>
        {:else if viewMeta?.banner && viewMode !== 'nest'}
          <!-- Nest has its own canvas toolbar naming and totalling the layout, so no banner. -->
          <ViewBanner title={viewMeta.banner} meta={bannerMeta} />
        {/if}

        <!-- Overlay visibility and viewport controls sit on the canvas they act on (Cockpit v2). -->
        {#if viewMode === 'design' || viewMode === 'render'}
          <OverlaysChip {viewport} />
        {/if}
        {#if viewMode !== 'nest'}
          <ViewportChip
            {viewport}
            onFit={() => viewport.zoomToFit(bounds)}
            onCalibrate={() => (calibrationOpen = true)}
          />
        {/if}
      </div>

      <!-- Bench outputs get real width, under the stage rather than squeezed into the dock. -->
      {#if drawerOpen}
        <OutputDrawer
          tab={drawerTab}
          onTab={(t) => (drawerTab = t)}
          onClose={() => (drawerOpen = false)}
          report={bomReport}
          quote={quoteReport}
          unit={viewport.unit}
          sort={bom.sort}
          onSort={(s) => (bom.sort = s)}
          factors={controller?.doc.bom ?? defaultBomSettings()}
          onSetFactor={setBomFactor}
          {bom}
          notes={pieceNotes}
          onExportCsv={bomReport && exportText ? exportCutListCsv : undefined}
        />
      {/if}
    </div>
    {#if viewMode !== 'nest'}
      <Inspector
        unit={viewport.unit}
        {viewMode}
        {edit}
        {selection}
        {paint}
        {reinforce}
        {reference}
        {assignments}
        {numbering}
        onSetNumber={setPieceNumber}
        doc={controller?.doc}
        {pieces}
        execute={controller ? (command) => controller.execute(command) : undefined}
        {panelStats}
        {legend}
        scheme={numbering.scheme}
        violations={drc.result.violations}
        onQuickFix={(v) => drc.applyQuickFix(v)}
        light={controller ? light : undefined}
        onPrintTemplate={exportAvailable && exportPdf ? openTemplate : undefined}
        onAutotrace={openTrace}
      />
    {/if}
  </div>
  <StatusBar
    {viewport}
    widthMm={panel.widthMm}
    heightMm={panel.heightMm}
    hint={toolHint}
    onToggleDrawer={() => (drawerOpen = !drawerOpen)}
    {drawerOpen}
  />
</div>

<CalibrationDialog
  bind:open={calibrationOpen}
  {viewport}
  onClose={() => (calibrationOpen = false)}
/>

<ExportDialog
  controller={exporter}
  {print}
  {bom}
  {quote}
  {bounds}
  pieceCount={pieces.length}
  {hasBom}
  {hasQuote}
  drcErrorCount={drc.result.counts.error}
  checksRun={drc.hasRun}
  onExport={runOutput}
/>

<ImportDialog controller={importer} onImport={runImport} />

<TraceDialog controller={tracer} onTrace={runTrace} />

<style>
  /* Cockpit v2: the 44px readiness strip is gone — readiness is one meter in the top bar — so the
     shell is three rows and the canvas gets the space back. */
  .shell {
    display: grid;
    grid-template-rows: auto 1fr auto;
    /* `minmax(0, 1fr)`, not the implicit `auto`: an auto column sizes to the widest row's
       max-content, so the top bar's chips would stretch the whole shell past the window. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'menu'
      'body'
      'status';
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .body {
    grid-area: body;
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  /* The stage stacks the canvas over the bench-outputs drawer. */
  .stage {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* The positioned ancestor for the canvas chips, banner and overlays. */
  .viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  /* Cost → the wide quote breakdown in the drawer. */
  .breakdown {
    margin-top: var(--space-3);
    padding: 10px 11px;
    width: 100%;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    color: var(--ink-900);
    font: 600 12.5px/1.2 var(--font-sans);
    text-align: left;
    cursor: pointer;
  }

  .breakdown:hover {
    border-color: var(--border-strong);
  }

  /* Read-only shared file banner (F-055 FR-8), pinned to the top of the canvas stage. */
  .readonly-banner {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 5px 6px 5px 14px;
    border-radius: var(--radius-full);
    background: var(--ink-950);
    color: var(--paper-0);
    font: 600 12px/1 var(--font-sans);
    box-shadow: var(--shadow-modal);
    z-index: 6;
  }

  .readonly-banner button {
    border: none;
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-950);
    font: 600 12px/1 var(--font-sans);
    padding: 5px 11px;
    cursor: pointer;
  }
</style>
