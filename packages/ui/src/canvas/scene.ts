import { perimeterAllowance } from '@vitrum/core'
import type { Project, Segment, SegmentGeometry } from '@vitrum/model'
import { createEmptyProject, createSegment, reconcileProjectNodes } from '@vitrum/model'
import type { BBox, Vec2 } from '@vitrum/geometry'
import { bboxOf, bboxUnion, line, pointAt, vec2 } from '@vitrum/geometry'

/** Points to sample a curved segment at when flattening it for display. */
const CURVE_SAMPLES = 64

/**
 * Flatten a segment's geometry to a world-space polyline for rendering. Straight lines
 * stay two points; arcs and cubics are sampled uniformly in their parameter. This is a
 * display concern only — the model keeps exact geometry, and F-011 will draw with true
 * tessellation once tools exist.
 */
export function segmentToWorldPoints(geometry: SegmentGeometry): Vec2[] {
  if (geometry.kind === 'line') return [geometry.a, geometry.b]
  const points: Vec2[] = []
  for (let i = 0; i <= CURVE_SAMPLES; i++) points.push(pointAt(geometry, i / CURVE_SAMPLES))
  return points
}

/**
 * The panel's world-space rectangle: `(0, 0)` → `(width, height)` in mm, the frame the
 * new-panel dialog's size actually describes (F-058). `null` when the document carries no
 * panel size, in which case nothing frames the drawing.
 *
 * This is the **finished** panel — the outside of the assembled panel, came included (Mathieu,
 * 2026-08-16, F-033). The line the user draws sits {@link panelInsetMm} inside it.
 */
export function panelRect(project: Project): BBox | null {
  const panel = project.settings.panelSize
  if (!panel) return null
  return { min: vec2(0, 0), max: vec2(panel.width, panel.height) }
}

/**
 * How far inside the finished panel the drawn border belongs, in mm: the technique's perimeter
 * allowance (F-021). Zero for copper foil, which adds no width outside the drawn line, and zero
 * whenever the came has no flange to speak of — in both cases the drawn border *is* the panel edge.
 */
export function panelInsetMm(project: Project): number {
  const borderIds = Object.values(project.segments)
    .filter((s) => s.role === 'border')
    .map((s) => s.id)
  return perimeterAllowance(project.technique, borderIds).mm
}

/**
 * The panel frame as **snap targets**: the four edges of the rectangle the user is meant to draw
 * their border on — {@link panelRect} shrunk by {@link panelInsetMm} on every side, which is exactly
 * the dotted rectangle `drawPanelFrame` renders.
 *
 * Chrome alone was not enough (Mathieu, run 2026-08-16-b): with a 5 mm came the target sits 2.5 mm
 * inside the panel, so no grid multiple lands on it and the border could not be placed on it by eye.
 * These are throwaway `Segment`s handed to `SnapController.updateScene`'s `derived` argument — they
 * join the drawing scene, so endpoint / midpoint / on-curve / intersection all catch the frame, but
 * they are never stored, never rendered from here, and never reach the editing scene.
 *
 * Only the drawn-to rectangle is offered, not the finished outline: it is the one the user aims at,
 * and with a zero allowance (copper foil) the two coincide anyway, so this is always the right one.
 * `null` when there is no panel size, or when the allowance would collapse the rectangle.
 */
export function panelSnapSegments(project: Project): readonly Segment[] {
  const rect = panelRect(project)
  if (!rect) return []
  const inset = panelInsetMm(project)
  const min = vec2(rect.min.x + inset, rect.min.y + inset)
  const max = vec2(rect.max.x - inset, rect.max.y - inset)
  if (max.x - min.x <= 0 || max.y - min.y <= 0) return []
  const corners = [min, vec2(max.x, min.y), max, vec2(min.x, max.y)]
  // Stable synthetic ids, not `createSegment`: these are rebuilt on every derive, and minting
  // nanoids here would make the result differ run to run for no benefit — the snap scene reads
  // geometry only. The `~panel` prefix cannot collide with a nanoid.
  return corners.map((a, i) => ({
    id: `~panel-edge-${i}`,
    geometry: line(a, corners[(i + 1) % corners.length]!),
    role: 'border' as const,
    endpoints: [`~panel-node-${i}`, `~panel-node-${(i + 1) % corners.length}`] as const,
  }))
}

/**
 * The world-space bounding box of the segments that become the **finished panel** — lead and
 * border, never `construction`. `null` when nothing is drawn.
 *
 * Construction guides are excluded on purpose, and it is not a nicety: F-012 stores a guide as a
 * segment spanning ±100 m so it reads as an endless line at any zoom. Unioning that into a frame
 * gives a 200 m box, which made the 1:1 template quote 873 252 tiles and the exported design sheet
 * render the panel as a sub-pixel speck on an empty page (Mathieu's `deur001.vitrum`, run
 * 2026-08-16-b). A guide is an aid for drawing, never part of the output — the same distinction
 * F-032's `panelMetrics` and every export already make.
 */
export function contentBounds(project: Project): BBox | null {
  let box: BBox | null = null
  for (const segment of Object.values(project.segments)) {
    if (segment.role === 'construction') continue
    const b = bboxOf(segment.geometry)
    box = box ? bboxUnion(box, b) : b
  }
  return box
}

/**
 * The world-space bounding box everything that frames the design should use: the finished-panel
 * segments ({@link contentBounds}) and, if set, the panel rectangle. `null` when there is nothing to
 * frame, in which case zoom-to-fit falls back to a default view.
 *
 * Feeds zoom-to-fit, the F-041 tile grid and the F-043 export scenes, so all four agree on what
 * "the design" means — and none of them is thrown by a guide (see {@link contentBounds}).
 */
export function documentBounds(project: Project): BBox | null {
  const content = contentBounds(project)
  const panel = panelRect(project)
  if (!panel) return content
  return content ? bboxUnion(content, panel) : panel
}

/**
 * Where a symmetry setup should pivot when it is first switched on (F-052): the panel's
 * centre, so "draw one half" lands replicas inside the glass. Falls back to the centre of
 * whatever is already drawn, then to the world origin for an empty, size-less document.
 *
 * This overturns the original 2026-07-22 default of the world origin, which is the panel's
 * *top-left corner* once a panel is laid out from `(0, 0)` — every axis and spoke anchored
 * off the glass. See `docs/testing/runs/2026-08-16-a/F-052.md` finding 1.
 */
export function defaultSymmetryCenter(project: Project): Vec2 {
  const box = panelRect(project) ?? contentBounds(project)
  if (!box) return vec2(0, 0)
  return vec2((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2)
}

/**
 * Generate a dense scene of straight segments for the FR-4 pan/zoom stress test: a
 * `rows × cols` lattice of short edges filling a ~1 m² region. Dev-only — reachable
 * from the debug palette, never shipped as a document.
 */
export function stressScene(count = 5000): Project {
  const cols = Math.ceil(Math.sqrt(count))
  const spacing = 20 // mm between lattice nodes
  const segments: Record<string, Segment> = {}

  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * spacing
    const y = row * spacing
    // Alternate horizontal and diagonal edges so the scene has varied orientations.
    const geometry: SegmentGeometry =
      i % 2 === 0
        ? line(vec2(x, y), vec2(x + spacing, y))
        : line(vec2(x, y), vec2(x + spacing, y + spacing))
    const segment = createSegment(geometry)
    segments[segment.id] = segment
  }

  return reconcileProjectNodes({ ...createEmptyProject({ name: 'Stress test' }), segments })
}
