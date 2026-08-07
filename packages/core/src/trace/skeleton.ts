import type { Vec2 } from '@vitrum/geometry'

import { LINK_DX, LINK_DY, neighbourCounts, neighbourLinks } from './thin'
import type { InkMask } from './types'

/**
 * Walking a thinned skeleton into polylines (F-059 FR-2).
 *
 * The skeleton is a pixel graph; what we want is its *edges*. Pixels with one neighbour are endpoints,
 * with two are interior, with three or more are junctions — so a drawn T or X becomes branches that
 * **break at the junction** rather than two lines running through each other. That matters more than
 * it sounds: piece detection needs the branches to meet at one shared point, and a run-through pair
 * would leave four dangling ends at every crossing.
 *
 * "Neighbour" here means a *non-redundant* neighbour (see `neighbourLinks`), which is what makes a
 * diagonal staircase read as a line rather than a chain of junctions.
 *
 * Thinning leaves junctions as small *clusters* of high-degree pixels (a Y meeting is rarely one
 * pixel), so each connected cluster collapses to a single node at its centroid and every branch
 * leaving the cluster starts exactly there. Closed loops — a traced circle has no endpoint and no
 * junction anywhere — are picked up in a second sweep and emitted with their first point repeated
 * last, so downstream code can see they are closed.
 *
 * Deterministic by construction: the sweep is in row-major pixel order and neighbours are always
 * examined in the same fixed order (FR-6).
 */

/** One traced skeleton run, in pixel coordinates (pixel *centres*). */
export interface SkeletonRun {
  readonly points: readonly Vec2[]
  /** True when the run returns to its start (a closed loop with no junction or endpoint). */
  readonly closed: boolean
  /** Whether each end sits at a junction (3+ branches) rather than a free end. */
  readonly startsAtJunction: boolean
  readonly endsAtJunction: boolean
}

/** Centre of pixel `(x, y)`. */
function centre(x: number, y: number): Vec2 {
  return { x: x + 0.5, y: y + 0.5 }
}

/**
 * Walk the skeleton. `mergePx` collapses junction nodes joined by a chain no longer than that into
 * one node, which is not an optional nicety: thinning a drawn **X** of any real stroke width gives two
 * Y-junctions joined by a stub roughly one stroke wide, not a single 4-way crossing. Left alone, one
 * drawn cross yields five segments and a spurious tiny piece. Pass the estimated stroke width.
 */
export function walkSkeleton(mask: InkMask, mergePx = 0): SkeletonRun[] {
  const { width: w, height: h, data } = mask
  const links = neighbourLinks(mask)
  const deg = neighbourCounts(mask)

  /** Neighbour pixel index in direction `k`, or -1 when there is no link that way. */
  const linkAt = (i: number, k: number): number => {
    if ((links[i]! & (1 << k)) === 0) return -1
    const x = i % w
    const y = (i - x) / w
    return (y + LINK_DY[k]!) * w + (x + LINK_DX[k]!)
  }

  // --- Nodes: endpoints (degree 1) and junction clusters (degree ≥ 3) --------------------------
  // `nodeOf[i]` is the node id of pixel `i`, or -1. Cluster members all share one id, so a branch
  // leaving a fat junction starts at the cluster's centroid rather than at whichever pixel it left.
  const nodeOf = new Int32Array(w * h).fill(-1)
  const nodePos: Vec2[] = []
  const nodeDegree: number[] = []

  const stack: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 1 || nodeOf[i] !== -1) continue
    if (deg[i] === 1) {
      nodeOf[i] = nodePos.length
      nodePos.push(centre(i % w, (i - (i % w)) / w))
      nodeDegree.push(1)
      continue
    }
    if (deg[i]! < 3) continue
    // Flood the cluster of linked junction pixels.
    const id = nodePos.length
    const members: number[] = []
    stack.length = 0
    stack.push(i)
    nodeOf[i] = id
    while (stack.length > 0) {
      const p = stack.pop()!
      members.push(p)
      for (let k = 0; k < 8; k++) {
        const j = linkAt(p, k)
        if (j >= 0 && deg[j]! >= 3 && nodeOf[j] === -1) {
          nodeOf[j] = id
          stack.push(j)
        }
      }
    }
    let sx = 0
    let sy = 0
    for (const p of members) {
      const px = p % w
      sx += px + 0.5
      sy += (p - px) / w + 0.5
    }
    nodePos.push({ x: sx / members.length, y: sy / members.length })
    nodeDegree.push(3)
  }

  // --- Branches: walk out of every node along every departing link -----------------------------
  // Collected first, then emitted, because the interior chains are what tell us which junction nodes
  // are really the same crossing (see `mergePx`).
  interface Branch {
    readonly from: number
    /** -1 for a chain that dead-ends without reaching a node. */
    readonly to: number
    /** Interior pixel centres, excluding both node positions. */
    readonly interior: Vec2[]
  }
  const branches: Branch[] = []
  const walked = new Uint8Array(w * h) // interior pixels already consumed by a branch
  const directEdges = new Set<string>() // node-to-node adjacency with no interior pixel

  for (let i = 0; i < data.length; i++) {
    const from = nodeOf[i]!
    if (from === -1) continue
    for (let k = 0; k < 8; k++) {
      const start = linkAt(i, k)
      if (start < 0) continue
      if (nodeOf[start] === from) continue // same junction cluster

      if (nodeOf[start] !== -1) {
        // Two nodes touching directly: a one-step branch. Record once, in id order.
        const to = nodeOf[start]!
        const key = from < to ? `${from}-${to}` : `${to}-${from}`
        if (directEdges.has(key)) continue
        directEdges.add(key)
        branches.push({ from, to, interior: [] })
        continue
      }

      if (walked[start] === 1) continue
      // Follow the chain of degree-2 pixels until another node (or a dead end) is reached.
      const interior: Vec2[] = []
      let prev = i
      let cur = start
      let to = -1
      for (;;) {
        walked[cur] = 1
        interior.push(centre(cur % w, (cur - (cur % w)) / w))
        let next = -1
        for (let m = 0; m < 8; m++) {
          const j = linkAt(cur, m)
          if (j < 0 || j === prev || j === cur) continue
          if (nodeOf[j] !== -1) {
            next = j
            break
          }
          if (walked[j] === 1) continue
          next = j
          break
        }
        if (next === -1) break
        if (nodeOf[next] !== -1) {
          to = nodeOf[next]!
          break
        }
        prev = cur
        cur = next
      }
      branches.push({ from, to, interior })
    }
  }

  // --- Merge junctions that are one stroke width apart -----------------------------------------
  const parent = Array.from({ length: nodePos.length }, (_, i) => i)
  const find = (a: number): number => {
    let root = a
    while (parent[root] !== root) root = parent[root]!
    let cur = a
    while (parent[cur] !== cur) {
      const next = parent[cur]!
      parent[cur] = root
      cur = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  if (mergePx > 0) {
    for (const branch of branches) {
      if (branch.to < 0) continue
      if (nodeDegree[branch.from]! < 3 || nodeDegree[branch.to]! < 3) continue
      const span = runLength([nodePos[branch.from]!, ...branch.interior, nodePos[branch.to]!])
      if (span <= mergePx) union(branch.from, branch.to)
    }
  }
  // A merged node sits at the mean of the nodes it swallowed, so all its branches meet exactly there.
  const groupSum = new Map<number, { x: number; y: number; n: number }>()
  for (let n = 0; n < nodePos.length; n++) {
    const root = find(n)
    const acc = groupSum.get(root) ?? { x: 0, y: 0, n: 0 }
    acc.x += nodePos[n]!.x
    acc.y += nodePos[n]!.y
    acc.n += 1
    groupSum.set(root, acc)
  }
  const mergedPos = (n: number): Vec2 => {
    const acc = groupSum.get(find(n))!
    return { x: acc.x / acc.n, y: acc.y / acc.n }
  }

  const runs: SkeletonRun[] = []
  for (const branch of branches) {
    if (branch.to >= 0 && find(branch.from) === find(branch.to)) continue // swallowed by a merge
    const points: Vec2[] = [mergedPos(branch.from), ...branch.interior]
    if (branch.to >= 0) points.push(mergedPos(branch.to))
    runs.push({
      points,
      closed: false,
      startsAtJunction: nodeDegree[branch.from]! >= 3,
      endsAtJunction: branch.to < 0 ? false : nodeDegree[branch.to]! >= 3,
    })
  }

  // --- Closed loops: components with no endpoint and no junction anywhere ----------------------
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 1 || deg[i] !== 2 || walked[i] === 1 || nodeOf[i] !== -1) continue
    const points: Vec2[] = []
    let prev = -1
    let cur = i
    for (;;) {
      walked[cur] = 1
      points.push(centre(cur % w, (cur - (cur % w)) / w))
      let next = -1
      for (let m = 0; m < 8; m++) {
        const j = linkAt(cur, m)
        if (j < 0 || j === prev || j === cur || walked[j] === 1) continue
        next = j
        break
      }
      if (next === -1) break
      prev = cur
      cur = next
    }
    if (points.length < 4) continue
    // Repeat the first point so the run reads as closed downstream (and fits as a closed curve).
    runs.push({
      points: [...points, points[0]!],
      closed: true,
      startsAtJunction: false,
      endsAtJunction: false,
    })
  }

  return runs
}

/**
 * Drop the short dangling stubs thinning leaves behind. Eroding a stroke to its medial axis forks at
 * a blunt end and at every junction, so a clean drawing still produces a scatter of 1–4 px spurs.
 * Only runs with a **free end** (not a junction at both ends) and shorter than `maxSpurPx` go; a
 * genuinely short drawn line between two junctions is never a spur.
 *
 * Runs twice, because removing one spur can expose the stub behind it.
 */
export function pruneSpurs(runs: readonly SkeletonRun[], maxSpurPx: number): SkeletonRun[] {
  let current = [...runs]
  for (let pass = 0; pass < 2; pass++) {
    const kept = current.filter((run) => {
      if (run.closed) return true
      if (run.startsAtJunction && run.endsAtJunction) return true
      return runLength(run.points) > maxSpurPx
    })
    if (kept.length === current.length) break
    current = kept
  }
  return current
}

/** Polyline length in pixels. */
export function runLength(points: readonly Vec2[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  }
  return total
}
