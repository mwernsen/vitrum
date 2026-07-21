import { arcAngleAt, cubicFlatten, vec2, type Arc, type Vec2 } from '@vitrum/geometry'

import type { DxfOptions, ExportScene } from './exportScene'
import { fmt } from './format'

/**
 * DXF export (F-043). Emits an AutoCAD R12 (AC1009) drawing — the most widely importable DXF flavour,
 * needing no object handles — with the network and cut contours split across four layers (`LEAD`,
 * `BORDER`, `CUT`, `REBAR`), so AutoCAD-class tools and waterjet/plotter CAM software can pick them
 * up (Glass Eye Enterprise parity, FR-3). Units are millimetres (`$INSUNITS = 4`, `$MEASUREMENT = 1`).
 *
 * Fidelity (FR-3): straight edges become `LINE`s, circular arcs become DXF `ARC`s (arcs-as-arcs), and
 * cubic Béziers are flattened to polylines at a documented {@link BEZIER_TOLERANCE_MM} tolerance —
 * DXF R12 has no spline entity. Output is deterministic text, byte-identical for the same document
 * (FR-4): entities are ordered by layer then by their source id.
 *
 * DXF's world is y-**up**; the document/canvas is y-**down**. Coordinates are flipped about the
 * content bounds so the panel opens upright in a CAD viewer; arc sweep directions are converted with
 * the flip.
 */

/** Bézier flattening tolerance (mm): each polyline vertex is within this of the true curve. */
export const BEZIER_TOLERANCE_MM = 0.05

type Layer = 'LEAD' | 'BORDER' | 'CUT' | 'REBAR'

/** ACI colour index per layer (1 red, 3 green, 5 blue, 2 yellow) — conventional, viewer-visible. */
const LAYER_COLOR: Record<Layer, number> = { LEAD: 5, BORDER: 5, CUT: 1, REBAR: 3 }
const LAYER_ORDER: readonly Layer[] = ['LEAD', 'BORDER', 'CUT', 'REBAR']

type DxfEntity =
  | {
      readonly kind: 'line'
      readonly layer: Layer
      readonly order: string
      readonly a: Vec2
      readonly b: Vec2
    }
  | {
      readonly kind: 'arc'
      readonly layer: Layer
      readonly order: string
      readonly center: Vec2
      readonly radius: number
      readonly startDeg: number
      readonly endDeg: number
    }
  | {
      readonly kind: 'polyline'
      readonly layer: Layer
      readonly order: string
      readonly points: readonly Vec2[]
      readonly closed: boolean
    }

export function buildDxf(scene: ExportScene, options: DxfOptions): string {
  const flipC = scene.contentBounds.min.y + scene.contentBounds.max.y
  const flip = (p: Vec2): Vec2 => vec2(p.x, flipC - p.y)

  const entities: DxfEntity[] = []

  for (const seg of scene.segments) {
    if (seg.role === 'construction') continue
    const layer: Layer = seg.role === 'border' ? 'BORDER' : 'LEAD'
    const g = seg.geometry
    if (g.kind === 'line') {
      entities.push({ kind: 'line', layer, order: seg.id, a: flip(g.a), b: flip(g.b) })
    } else if (g.kind === 'arc') {
      entities.push(arcEntity(layer, seg.id, g, flipC))
    } else {
      const pts = cubicFlatten(g, BEZIER_TOLERANCE_MM).map(flip)
      entities.push({ kind: 'polyline', layer, order: seg.id, points: pts, closed: false })
    }
  }

  if (options.includeCut) {
    for (const piece of scene.pieces) {
      const outer = piece.cutRing && piece.cutRing.length >= 3 ? piece.cutRing : piece.ring
      const holes =
        piece.cutRing && piece.cutRing.length >= 3 ? (piece.cutHoleRings ?? []) : piece.holeRings
      if (outer.length >= 3) {
        entities.push({
          kind: 'polyline',
          layer: 'CUT',
          order: piece.key,
          points: outer.map(flip),
          closed: true,
        })
      }
      holes.forEach((hole, i) => {
        if (hole.length >= 3)
          entities.push({
            kind: 'polyline',
            layer: 'CUT',
            order: `${piece.key}:hole:${i}`,
            points: hole.map(flip),
            closed: true,
          })
      })
    }
  }

  for (const bar of scene.reinforcements) {
    entities.push({
      kind: 'line',
      layer: 'REBAR',
      order: barKey(bar.a, bar.b),
      a: flip(bar.a),
      b: flip(bar.b),
    })
  }

  // Deterministic order: by layer, then by source id (FR-4).
  entities.sort((x, y) => {
    const li = LAYER_ORDER.indexOf(x.layer) - LAYER_ORDER.indexOf(y.layer)
    if (li !== 0) return li
    return x.order < y.order ? -1 : x.order > y.order ? 1 : 0
  })

  return serialise(entities, options.projectName)
}

/** Convert a world y-down {@link Arc} into an equivalent DXF (y-up, always-CCW) `ARC` entity. */
function arcEntity(layer: Layer, order: string, a: Arc, flipC: number): DxfEntity {
  const wStart = a.startAngle
  const wEnd = arcAngleAt(a, 1)
  // The y-flip negates every angle and reverses the sweep. DXF arcs run CCW from start to end, so a
  // world-CCW arc (now CW after the flip) has its endpoints swapped.
  const [startRad, endRad] = a.ccw ? [-wEnd, -wStart] : [-wStart, -wEnd]
  return {
    kind: 'arc',
    layer,
    order,
    center: vec2(a.center.x, flipC - a.center.y),
    radius: a.radius,
    startDeg: normDeg((startRad * 180) / Math.PI),
    endDeg: normDeg((endRad * 180) / Math.PI),
  }
}

function normDeg(deg: number): number {
  let d = deg % 360
  if (d < 0) d += 360
  return d
}

function barKey(a: Vec2, b: Vec2): string {
  return `${fmt(a.x)},${fmt(a.y)}-${fmt(b.x)},${fmt(b.y)}`
}

// --- Serialisation ----------------------------------------------------------

/** One DXF group code / value pair line (code on its own line, then the value). */
function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`
}

function serialise(entities: readonly DxfEntity[], projectName: string): string {
  const usedLayers = LAYER_ORDER.filter((l) => entities.some((e) => e.layer === l))
  let out = ''

  // HEADER: millimetres, R12.
  out += pair(0, 'SECTION') + pair(2, 'HEADER')
  out += pair(9, '$ACADVER') + pair(1, 'AC1009')
  out += pair(9, '$INSUNITS') + pair(70, 4)
  out += pair(9, '$MEASUREMENT') + pair(70, 1)
  out += pair(0, 'ENDSEC')

  // TABLES: the layer table (name + colour + continuous linetype).
  out += pair(0, 'SECTION') + pair(2, 'TABLES')
  out += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, usedLayers.length)
  for (const layer of usedLayers) {
    out +=
      pair(0, 'LAYER') +
      pair(2, layer) +
      pair(70, 0) +
      pair(62, LAYER_COLOR[layer]) +
      pair(6, 'CONTINUOUS')
  }
  out += pair(0, 'ENDTAB') + pair(0, 'ENDSEC')

  // ENTITIES.
  out += pair(0, 'SECTION') + pair(2, 'ENTITIES')
  for (const e of entities) out += entityText(e)
  out += pair(0, 'ENDSEC')

  out += pair(0, 'EOF')
  // `projectName` is carried in the drawing only implicitly (R12 has no clean title slot); it names
  // the file. Referenced here to keep the signature stable with the SVG/PDF builders.
  void projectName
  return out
}

function entityText(e: DxfEntity): string {
  switch (e.kind) {
    case 'line':
      return (
        pair(0, 'LINE') +
        pair(8, e.layer) +
        pair(10, fmt(e.a.x)) +
        pair(20, fmt(e.a.y)) +
        pair(11, fmt(e.b.x)) +
        pair(21, fmt(e.b.y))
      )
    case 'arc':
      return (
        pair(0, 'ARC') +
        pair(8, e.layer) +
        pair(10, fmt(e.center.x)) +
        pair(20, fmt(e.center.y)) +
        pair(40, fmt(e.radius)) +
        pair(50, fmt(e.startDeg)) +
        pair(51, fmt(e.endDeg))
      )
    case 'polyline': {
      let s = pair(0, 'POLYLINE') + pair(8, e.layer) + pair(66, 1) + pair(70, e.closed ? 1 : 0)
      for (const p of e.points) {
        s += pair(0, 'VERTEX') + pair(8, e.layer) + pair(10, fmt(p.x)) + pair(20, fmt(p.y))
      }
      s += pair(0, 'SEQEND')
      return s
    }
  }
}
