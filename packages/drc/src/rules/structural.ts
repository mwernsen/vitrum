import { pieceKey, type TechniqueKind } from '@vitrum/core'
import {
  bboxHeight,
  bboxOfPoints,
  bboxWidth,
  clamp,
  curveLength,
  distance,
  dot,
  normalize,
  pointAt,
  splitAt,
  sub,
  type BBox,
  type Curve,
  type Vec2,
} from '@vitrum/geometry'
import type { NodeId, Project, ReinforcementBar, Segment } from '@vitrum/model'

import { resolveThreshold } from '../thresholds'
import type { DrcInput, RawViolation, Rule, ThresholdSpec } from '../types'

import { panelWeight } from './weight'

/**
 * The structural-integrity rule pack (F-032): will the *assembled* panel survive building,
 * transport and years of hanging? Five rules — hinge lines, crowded solder joints, panels that need
 * a reinforcement bar, total weight, and tiny edge contacts — each a pure function of {@link
 * DrcInput}, plugging into F-030's registry with no engine change. Completes milestone M3.
 *
 * Thresholds are craft numbers declared as {@link ThresholdSpec} data (some differ by technique —
 * a soldered foil panel is stiffer than a leaded one, so its hinge tolerances relax), so a workshop
 * can retune them and the settings UI can explain them (FR-4). Messages teach the failure mode
 * (FR-5): the row states what was measured; the rule's `explain` says why it matters and how to fix
 * it.
 */

const DEG = Math.PI / 180

/** Format a millimetre measurement for a message. */
function mm(value: number): string {
  return value.toFixed(0)
}

/** A threshold with the same default for lead and foil. */
function fixed(
  key: string,
  label: string,
  unit: string,
  value: number,
  rationale: string,
): ThresholdSpec {
  return { key, label, unit, rationale, defaultFor: () => value }
}

/** A threshold whose default differs by technique. */
function perTechnique(
  key: string,
  label: string,
  unit: string,
  lead: number,
  foil: number,
  rationale: string,
): ThresholdSpec {
  return {
    key,
    label,
    unit,
    rationale,
    defaultFor: (kind: TechniqueKind) => (kind === 'foil' ? foil : lead),
  }
}

/* -------------------------------------------------------------------------- */
/* Shared geometry helpers                                                     */
/* -------------------------------------------------------------------------- */

/** The finished-panel segments (lead + border, never construction guides). */
function outputSegments(project: Project): Segment[] {
  return Object.values(project.segments).filter((s) => s.role !== 'construction')
}

function nodePos(project: Project, id: NodeId): Vec2 | undefined {
  return project.nodes[id]?.pos
}

interface PanelMetrics {
  readonly bbox: BBox
  readonly widthMm: number
  readonly heightMm: number
  /** Glass area in mm² (sum of piece areas; bbox area as a fallback when nothing is detected). */
  readonly areaMm2: number
  readonly center: Vec2
}

/**
 * The panel's overall extent, derived from the drawn network (border + lead endpoints), with the
 * detected pieces' bboxes folded in so a piece bulging past its endpoints still counts. Returns
 * undefined for an empty document (no rule fires on nothing).
 */
function panelMetrics(input: DrcInput): PanelMetrics | undefined {
  const pts: Vec2[] = []
  for (const seg of outputSegments(input.project)) {
    for (const nid of seg.endpoints) {
      const p = nodePos(input.project, nid)
      if (p) pts.push(p)
    }
  }
  for (const piece of input.pieces) {
    pts.push(piece.bbox.min, piece.bbox.max)
  }
  if (pts.length === 0) return undefined
  const bbox = bboxOfPoints(pts)
  const widthMm = bboxWidth(bbox)
  const heightMm = bboxHeight(bbox)
  const glassArea = input.pieces.reduce((sum, p) => sum + p.area, 0)
  const areaMm2 = glassArea > 0 ? glassArea : widthMm * heightMm
  return {
    bbox,
    widthMm,
    heightMm,
    areaMm2,
    center: { x: (bbox.min.x + bbox.max.x) / 2, y: (bbox.min.y + bbox.max.y) / 2 },
  }
}

/** The true length (mm) of a sub-range `[tStart,tEnd]` of a segment's source curve. */
function spanLength(segment: Segment, tStart: number, tEnd: number): number {
  const lo = Math.min(tStart, tEnd)
  const hi = Math.max(tStart, tEnd)
  let curve: Curve = segment.geometry
  if (lo > 1e-9) curve = splitAt(curve, lo)[1]
  if (hi < 1 - 1e-9) {
    const local = lo > 1e-9 ? (hi - lo) / (1 - lo) : hi
    curve = splitAt(curve, local)[0]
  }
  return curveLength(curve)
}

/* -------------------------------------------------------------------------- */
/* hinge-line — a straight run edge-to-edge that the panel folds along          */
/* -------------------------------------------------------------------------- */

const HINGE_ANGLE = perTechnique(
  'angleToleranceDeg',
  'Collinearity tolerance',
  '°',
  12,
  8,
  'Lead lines whose direction changes by less than this at a joint count as one continuous run. A ' +
    'soldered copper-foil panel is stiffer than a leaded one, so its tolerance is tighter (a foil ' +
    'run has to be straighter before it reads as a fold axis).',
)

const HINGE_SPAN = perTechnique(
  'spanPercent',
  'Edge-to-edge span',
  '%',
  85,
  92,
  'A near-straight run reaching this fraction of the panel across its long axis is a hinge: the ' +
    'panel flexes and creases along it. Foil work tolerates a longer run before it matters, so its ' +
    'threshold is higher.',
)

const hingeLine: Rule = {
  id: 'hinge-line',
  title: 'Hinge line',
  defaultSeverity: 'warning',
  explain:
    'These lead lines form one near-straight run covering most of the panel across this axis, so ' +
    'the panel will flex and crease along it over time and can fold there in transit. Stagger the ' +
    'joints so no single run covers the whole span (like brickwork), or tie a reinforcement bar ' +
    'across it.',
  thresholds: [HINGE_ANGLE, HINGE_SPAN],
  check: (input) => {
    const metrics = panelMetrics(input)
    if (!metrics) return []
    const angleTol = resolveThreshold(input, 'hinge-line', HINGE_ANGLE) * DEG
    const spanFraction = resolveThreshold(input, 'hinge-line', HINGE_SPAN) / 100
    const chains = traceCollinearChains(input.project, angleTol)
    const out: RawViolation[] = []
    for (const chain of chains) {
      const spanVec = sub(chain.end, chain.start)
      const spanLen = Math.hypot(spanVec.x, spanVec.y)
      // The relevant panel dimension is the one along the run's dominant axis; the test is on the
      // *span*, so a run can trip it without either end touching a border — the message says which.
      const horizontal = Math.abs(spanVec.x) >= Math.abs(spanVec.y)
      const panelDim = horizontal ? metrics.widthMm : metrics.heightMm
      if (panelDim <= 0 || spanLen < spanFraction * panelDim) continue
      const perfectlyStraight = chain.maxTurn <= 1 * DEG
      out.push({
        at: { x: (chain.start.x + chain.end.x) / 2, y: (chain.start.y + chain.end.y) / 2 },
        message: hingeMessage(chain, spanLen, panelDim, horizontal, metrics),
        identity: [...chain.segmentIds].sort(),
        segmentIds: [...chain.segmentIds],
        ...(perfectlyStraight ? { severity: 'error' as const } : {}),
      })
    }
    return out
  },
}

/** How close (mm) a run's end must be to the panel's edge to be described as reaching it. */
const HINGE_EDGE_TOL = 1

/** Distance from `p` to the nearest side of the panel's bounding box. */
function distanceToPanelEdge(p: Vec2, metrics: PanelMetrics): number {
  return Math.min(
    p.x - metrics.bbox.min.x,
    metrics.bbox.max.x - p.x,
    p.y - metrics.bbox.min.y,
    metrics.bbox.max.y - p.y,
  )
}

/**
 * Say what was actually found: how many lines were merged into the run, the span as a share of the
 * panel dimension it is measured against, and — since the test is on span, not edge contact —
 * whether the run really does reach the panel's edges. A run that stops short is still a weakness,
 * but a workshop reading "hinge" needs to know it is not literally edge to edge.
 */
function hingeMessage(
  chain: Chain,
  spanLen: number,
  panelDim: number,
  horizontal: boolean,
  metrics: PanelMetrics,
): string {
  const share = Math.round((spanLen / panelDim) * 100)
  const axis = horizontal ? 'width' : 'height'
  const lines = chain.segmentIds.length
  const run = lines === 1 ? 'line' : `run of ${lines} lines`
  const gaps = [chain.start, chain.end]
    .map((p) => distanceToPanelEdge(p, metrics))
    .filter((d) => d > HINGE_EDGE_TOL)
  const reach =
    gaps.length === 0
      ? 'edge to edge'
      : gaps.length === 1
        ? `stops ${mm(gaps[0]!)} mm short of the edge at one end`
        : `stops short of the edge at both ends (${gaps.map((g) => `${mm(g)} mm`).join(', ')})`
  return `near-straight ${run}, ${mm(spanLen)} mm — ${share}% of the panel's ${mm(panelDim)} mm ${axis}; ${reach}`
}

interface Chain {
  readonly segmentIds: string[]
  readonly start: Vec2
  readonly end: Vec2
  /** The largest direction change (radians) anywhere along the run — 0 ⇒ perfectly straight. */
  readonly maxTurn: number
}

interface HalfEdge {
  readonly segId: string
  readonly from: NodeId
  readonly to: NodeId
  /** Unit chord direction from → to. */
  readonly dir: Vec2
}

/**
 * Trace maximal near-collinear chains of lead lines through the network. Only straight-ish lead
 * segments participate (a curved segment whose midpoint bows far off its chord cannot be part of a
 * straight fold axis). At each joint the chain continues along the incident segment that best keeps
 * the current direction, provided the turn is within tolerance — so crossing lines at a node do not
 * extend it. Deterministic: segments are visited in sorted-id order and each is used once.
 */
function traceCollinearChains(project: Project, angleTol: number): Chain[] {
  const segs = outputSegments(project)
    .filter((s) => s.role === 'lead')
    .filter((s) => isNearStraight(project, s))
    .sort((a, b) => (a.id < b.id ? -1 : 1))

  const adjacency = new Map<NodeId, HalfEdge[]>()
  for (const seg of segs) {
    const [a, b] = seg.endpoints
    const pa = nodePos(project, a)
    const pb = nodePos(project, b)
    if (!pa || !pb || distance(pa, pb) < 1e-6) continue
    const dir = normalize(sub(pb, pa))
    push(adjacency, a, { segId: seg.id, from: a, to: b, dir })
    push(adjacency, b, { segId: seg.id, from: b, to: a, dir: { x: -dir.x, y: -dir.y } })
  }

  const used = new Set<string>()
  const chains: Chain[] = []
  for (const seg of segs) {
    if (used.has(seg.id)) continue
    used.add(seg.id)
    const [a, b] = seg.endpoints
    const pa = nodePos(project, a)!
    const pb = nodePos(project, b)!
    const dir = normalize(sub(pb, pa))
    const ids = [seg.id]
    // Extend past `b` following `dir`, then past `a` following the reverse.
    const fwd = extend(adjacency, b, dir, used, ids)
    const bwd = extend(adjacency, a, { x: -dir.x, y: -dir.y }, used, ids)
    const maxTurn = Math.max(fwd.maxTurn, bwd.maxTurn)
    chains.push({
      segmentIds: ids,
      start: bwd.end ? nodePos(project, bwd.end)! : pa,
      end: fwd.end ? nodePos(project, fwd.end)! : pb,
      maxTurn,
    })

    function extend(
      adj: Map<NodeId, HalfEdge[]>,
      node: NodeId,
      heading: Vec2,
      seen: Set<string>,
      collected: string[],
    ): { end: NodeId | null; maxTurn: number } {
      let current = node
      let dir2 = heading
      let turnMax = 0
      // Guard against cycles: at most one pass per segment (all are marked used).
      for (let guard = 0; guard < segs.length; guard++) {
        const candidates = (adj.get(current) ?? []).filter((h) => !seen.has(h.segId))
        let best: HalfEdge | undefined
        let bestTurn = Infinity
        for (const h of candidates) {
          const turn = Math.acos(clamp(dot(dir2, h.dir), -1, 1))
          if (turn < bestTurn) {
            bestTurn = turn
            best = h
          }
        }
        if (!best || bestTurn > angleTol) return { end: current, maxTurn: turnMax }
        seen.add(best.segId)
        collected.push(best.segId)
        turnMax = Math.max(turnMax, bestTurn)
        dir2 = best.dir
        current = best.to
      }
      return { end: current, maxTurn: turnMax }
    }
  }
  return chains
}

/** A lead segment is straight enough for a hinge if its midpoint barely bows off its chord. */
function isNearStraight(project: Project, seg: Segment): boolean {
  const pa = nodePos(project, seg.endpoints[0])
  const pb = nodePos(project, seg.endpoints[1])
  if (!pa || !pb) return false
  const chord = distance(pa, pb)
  if (chord < 1e-6) return false
  const mid = pointAt(seg.geometry, 0.5)
  const chordMid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
  // Bow ≤ 2 % of chord (and ≤ 3 mm) reads as straight for folding purposes.
  return distance(mid, chordMid) <= Math.min(3, 0.02 * chord)
}

function push(map: Map<NodeId, HalfEdge[]>, key: NodeId, value: HalfEdge): void {
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

/* -------------------------------------------------------------------------- */
/* crowded-joint — too many came ends meeting at one solder joint               */
/* -------------------------------------------------------------------------- */

const CROWD_WARN = fixed(
  'warnEnds',
  'Crowded joint (warn)',
  'ends',
  5,
  'A solder joint where this many came ends meet is bulky and hard to solder cleanly, and ' +
    'concentrates stress. Offset the crossings so fewer lines meet at one point.',
)

const CROWD_ERROR = fixed(
  'errorEnds',
  'Crowded joint (error)',
  'ends',
  6,
  'At or above this many came ends the joint is a genuine weak point — reported as an error.',
)

const crowdedJoint: Rule = {
  id: 'crowded-joint',
  title: 'Crowded joint',
  defaultSeverity: 'warning',
  explain:
    'Many lead lines meet at this single point, making a thick, weak solder joint and a stress ' +
    'concentrator. Offset one of the crossings by a few millimetres so the lines meet at two ' +
    'staggered joints instead of one.',
  thresholds: [CROWD_WARN, CROWD_ERROR],
  check: (input) => {
    const warn = resolveThreshold(input, 'crowded-joint', CROWD_WARN)
    const error = resolveThreshold(input, 'crowded-joint', CROWD_ERROR)
    const degree = new Map<NodeId, number>()
    for (const seg of outputSegments(input.project)) {
      for (const node of seg.endpoints) degree.set(node, (degree.get(node) ?? 0) + 1)
    }
    const out: RawViolation[] = []
    for (const [node, count] of degree) {
      if (count < warn) continue
      const pos = nodePos(input.project, node)
      if (!pos) continue
      out.push({
        at: pos,
        message: `${count} came ends meet here (limit ${warn})`,
        identity: [node],
        ...(count >= error ? { severity: 'error' as const } : {}),
      })
    }
    return out
  },
}

/* -------------------------------------------------------------------------- */
/* panel-needs-reinforcement — too big / long a span without a bar              */
/* -------------------------------------------------------------------------- */

const REINFORCE_AREA = perTechnique(
  'maxAreaM2',
  'Maximum unbraced area',
  'm²',
  0.5,
  0.75,
  'A leaded panel beyond roughly half a square metre sags under its own weight without a bar; a ' +
    'soldered foil panel is stiffer and tolerates more. Add a reinforcement bar tied across the ' +
    'panel.',
)

const REINFORCE_SPAN = fixed(
  'maxSpanMm',
  'Maximum unbraced span',
  'mm',
  600,
  'Any unsupported run longer than this bows over time regardless of area. A bar spanning the long ' +
    'dimension divides it into two shorter, stiffer spans.',
)

/** The fraction of a dimension a bar must cover to count as spanning (and so bracing) it. */
const BAR_SPAN_FRACTION = 0.8

const panelNeedsReinforcement: Rule = {
  id: 'panel-needs-reinforcement',
  title: 'Needs reinforcement',
  defaultSeverity: 'warning',
  explain:
    'This panel is large or long enough that it will bow or sag when hung unless it is braced. Add ' +
    'a reinforcement bar (a rigid saddle/rebar tied to the lead lines) spanning the long dimension, ' +
    'or use zinc/steel-cored perimeter came.',
  thresholds: [REINFORCE_AREA, REINFORCE_SPAN],
  check: (input) => {
    const metrics = panelMetrics(input)
    if (!metrics) return []
    const maxAreaMm2 = resolveThreshold(input, 'panel-needs-reinforcement', REINFORCE_AREA) * 1e6
    const maxSpanMm = resolveThreshold(input, 'panel-needs-reinforcement', REINFORCE_SPAN)

    const longAxis: 'x' | 'y' = metrics.widthMm >= metrics.heightMm ? 'x' : 'y'
    const longDim = longAxis === 'x' ? metrics.widthMm : metrics.heightMm
    const spanExceeded = longDim > maxSpanMm
    const areaExceeded = metrics.areaMm2 > maxAreaMm2
    if (!spanExceeded && !areaExceeded) return []

    // A bar clears the violation only if it spans the offending (long) dimension (seam C).
    const braced = input.project.reinforcements.some((bar) =>
      barSpansAxis(bar, metrics.bbox, longAxis, BAR_SPAN_FRACTION),
    )
    if (braced) return []

    const reasons: string[] = []
    if (areaExceeded) reasons.push(`area ${(metrics.areaMm2 / 1e6).toFixed(2)} m²`)
    if (spanExceeded) reasons.push(`span ${mm(longDim)} mm`)
    return [
      {
        at: metrics.center,
        message: `${reasons.join(' and ')} with no reinforcement bar across it`,
        identity: ['panel'],
      },
    ]
  },
}

/** True when `bar` runs across ≥ `frac` of the panel along `axis`, with its midpoint inside it. */
function barSpansAxis(bar: ReinforcementBar, bbox: BBox, axis: 'x' | 'y', frac: number): boolean {
  const extent = axis === 'x' ? Math.abs(bar.b.x - bar.a.x) : Math.abs(bar.b.y - bar.a.y)
  const dim = axis === 'x' ? bboxWidth(bbox) : bboxHeight(bbox)
  if (dim <= 0) return false
  const mid = { x: (bar.a.x + bar.b.x) / 2, y: (bar.a.y + bar.b.y) / 2 }
  const inside =
    mid.x >= bbox.min.x - 1 &&
    mid.x <= bbox.max.x + 1 &&
    mid.y >= bbox.min.y - 1 &&
    mid.y <= bbox.max.y + 1
  return inside && extent >= frac * dim
}

/* -------------------------------------------------------------------------- */
/* panel-weight — an always-on weight readout, warning when heavy               */
/* -------------------------------------------------------------------------- */

const WEIGHT_LIMIT = fixed(
  'hangingWeightKg',
  'Hanging-weight warning',
  'kg',
  15,
  'Above this weight the hanging hardware and the top came bear a serious load; check that the ' +
    'chain, hooks and fixings are rated for it. Reported as information below the limit and as a ' +
    'warning above it.',
)

const panelWeightRule: Rule = {
  id: 'panel-weight',
  title: 'Panel weight',
  defaultSeverity: 'info',
  explain:
    'The estimated assembled weight of the finished panel — glass plus lead or solder. Use it to ' +
    'size the hanging hardware and to sanity-check transport. Heavy panels also need reinforcement.',
  thresholds: [WEIGHT_LIMIT],
  check: (input) => {
    const metrics = panelMetrics(input)
    if (!metrics || input.pieces.length === 0) return []
    const limitKg = resolveThreshold(input, 'panel-weight', WEIGHT_LIMIT)
    const weight = panelWeight(input)
    const kg = weight.grams / 1000
    const over = kg > limitKg
    return [
      {
        at: metrics.center,
        message: over
          ? `panel weighs ${kg.toFixed(1)} kg (over ${limitKg} kg — check hanging hardware)`
          : `panel weighs ${kg.toFixed(1)} kg`,
        identity: ['panel'],
        ...(over ? { severity: 'warning' as const } : {}),
      },
    ]
  },
}

/* -------------------------------------------------------------------------- */
/* tiny-edge-contact — a piece barely touching the panel border                 */
/* -------------------------------------------------------------------------- */

const MIN_CONTACT = fixed(
  'minContactMm',
  'Minimum border contact',
  'mm',
  10,
  'A piece that meets the panel edge along only a few millimetres is hard to cement and secure — ' +
    'it can work loose at the border. Extend the piece along the edge or absorb the sliver of ' +
    'contact into a neighbour.',
)

const tinyEdgeContact: Rule = {
  id: 'tiny-edge-contact',
  title: 'Tiny edge contact',
  defaultSeverity: 'warning',
  explain:
    'This piece touches the panel border along a very short edge. There is too little perimeter ' +
    'came to grip it, so it can loosen at the edge. Redraw the border joint so the piece meets the ' +
    'edge along a longer run.',
  thresholds: [MIN_CONTACT],
  check: (input) => {
    const limit = resolveThreshold(input, 'tiny-edge-contact', MIN_CONTACT)
    const out: RawViolation[] = []
    for (const piece of input.pieces) {
      let contact = 0
      let at: Vec2 | undefined
      for (const span of piece.boundary) {
        const seg = input.project.segments[span.segmentId]
        if (!seg || seg.role !== 'border') continue
        contact += spanLength(seg, span.tStart, span.tEnd)
        if (!at) at = pointAt(seg.geometry, (span.tStart + span.tEnd) / 2)
      }
      if (contact <= 0 || contact >= limit || !at) continue
      out.push({
        at,
        message: `piece meets the border along only ${contact.toFixed(1)} mm (minimum ${mm(limit)} mm)`,
        identity: [pieceKey(piece)],
        pieceIds: [piece.id],
      })
    }
    return out
  },
}

/** The structural rule pack, in a stable display order (Scope). */
export const STRUCTURAL_RULES: readonly Rule[] = [
  hingeLine,
  crowdedJoint,
  panelNeedsReinforcement,
  panelWeightRule,
  tinyEdgeContact,
]
