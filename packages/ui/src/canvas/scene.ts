import type { Project, Segment, SegmentGeometry } from '@vitrum/model'
import { createEmptyProject, createSegment } from '@vitrum/model'
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
 * The world-space bounding box of everything drawable in a project: its segments and,
 * if set, the panel rectangle. `null` when there is nothing to frame (used by
 * zoom-to-fit to fall back to a default view).
 */
export function documentBounds(project: Project): BBox | null {
  let box: BBox | null = null
  for (const segment of Object.values(project.segments)) {
    const b = bboxOf(segment.geometry)
    box = box ? bboxUnion(box, b) : b
  }
  const panel = project.settings.panelSize
  if (panel) {
    const b: BBox = { min: vec2(0, 0), max: vec2(panel.width, panel.height) }
    box = box ? bboxUnion(box, b) : b
  }
  return box
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

  return { ...createEmptyProject({ name: 'Stress test' }), segments }
}
