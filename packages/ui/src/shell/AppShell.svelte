<script lang="ts">
  import { leadFlangeMm, pieceKey, type Panel } from '@vitrum/core'
  import { pointInPolygon, polygon } from '@vitrum/geometry'
  import {
    createEmptyProject,
    setGlassAssignments,
    type GlassId,
    type PieceId,
  } from '@vitrum/model'

  import CalibrationDialog from '../canvas/CalibrationDialog.svelte'
  import type { TechniqueRender } from '../canvas/render'
  import { documentBounds } from '../canvas/scene'
  import { ViewportController } from '../canvas/viewport.svelte'
  import type { DocumentController } from '../document/controller.svelte'
  import { AssignmentController } from '../glass/assignment.svelte'
  import GlassDock from '../glass/GlassDock.svelte'
  import type { GlassLibraryController } from '../glass/library.svelte'
  import { ToolController } from '../tools/controller.svelte'
  import { EditController } from '../tools/edit.svelte'
  import { PaintController } from '../tools/paint.svelte'
  import { SelectionController } from '../tools/selection.svelte'
  import { SnapController } from '../tools/snap.svelte'

  import Canvas from './Canvas.svelte'
  import Inspector from './Inspector.svelte'
  import StatusBar from './StatusBar.svelte'
  import Toolbar from './Toolbar.svelte'
  import TopBar from './TopBar.svelte'

  interface Props {
    panel: Panel
    /** The document controller (F-002). Optional so the shell renders in isolation tests. */
    controller?: DocumentController
    /** The global glass library controller (F-022). Optional so the shell renders in isolation. */
    glassLibrary?: GlassLibraryController
  }

  let { panel, controller, glassLibrary }: Props = $props()

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
  tools.resolver = snap.resolver

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

  const segments = $derived(controller ? Object.values(controller.doc.segments) : [])
  // Hidden guides drop out of both rendering and snapping (F-012 visibility toggle).
  const shownSegments = $derived(
    viewport.guidesVisible ? segments : segments.filter((s) => s.role !== 'construction'),
  )
  const bounds = $derived(controller ? documentBounds(controller.doc) : null)

  // Rebuild the snap spatial index whenever the visible network changes.
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

  // The paint / piece-select controller (F-023). Assignments key off project glasses, so painting a
  // library swatch auto-imports a project copy first (handled in the glass dock).
  const paint = new PaintController({
    viewport,
    assignments,
    getPieces: () => pieces,
    execute: (command) => controller?.execute(command),
  })

  const projectGlasses = $derived(controller?.doc.glasses ?? {})
  const unassignedCount = $derived(pieces.filter((p) => !assignments.glassFor(p)).length)

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
  $effect(() => {
    if (controller) controller.onBeforeSave = normalizeAssignments
  })

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

  let calibrationOpen = $state(false)
</script>

<div class="shell">
  <TopBar title={panel.name} {controller} onZoomFit={() => viewport.zoomToFit(bounds)} />
  <Toolbar {tools} {paint} />
  {#if glassLibrary}
    <GlassDock
      {glassLibrary}
      {assignments}
      {paint}
      glasses={projectGlasses}
      execute={controller ? (command) => controller.execute(command) : undefined}
    />
  {/if}
  <Canvas
    {viewport}
    segments={shownSegments}
    {bounds}
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
  />
  <Inspector
    {panel}
    unit={viewport.unit}
    {edit}
    {selection}
    {paint}
    {assignments}
    doc={controller?.doc}
    {pieces}
    execute={controller ? (command) => controller.execute(command) : undefined}
  />
  <StatusBar
    {viewport}
    {snap}
    {unassignedCount}
    onfit={() => viewport.zoomToFit(bounds)}
    oncalibrate={() => (calibrationOpen = true)}
    onClearGuides={controller ? () => controller.clearGuides() : undefined}
  />
</div>

<CalibrationDialog
  bind:open={calibrationOpen}
  {viewport}
  onClose={() => (calibrationOpen = false)}
/>

<style>
  .shell {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      'menu menu menu menu'
      'tools dock canvas inspector'
      'status status status status';
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }
</style>
