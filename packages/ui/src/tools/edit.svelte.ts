import {
  buildPickScene,
  marqueeMode,
  marqueeSelect,
  pickNode,
  pickSegments,
  screenToWorld,
  worldToScreen,
  type MarqueeMode,
  type NodeTarget,
  type PickScene,
} from '@vitrum/core'
import {
  bboxOf,
  bboxUnion,
  compose,
  distance,
  rotation,
  scaling,
  translation,
  vec2,
  type BBox,
  type CubicBezier,
  type Transform2D,
  type Vec2,
} from '@vitrum/geometry'
import {
  addSegments,
  moveNode,
  removeSegments,
  splitSegmentAtNode,
  transformSegments,
  updateSegmentsGeometry,
  newNodeId,
  newSegmentId,
  type Command,
  type ExecuteOptions,
  type Project,
  type Segment,
} from '@vitrum/model'

import type { ViewportController } from '../canvas/viewport.svelte'

import type { SelectionController } from './selection.svelte'
import type { SnapController } from './snap.svelte'

/** Screen-pixel tolerances (zoom-independent; converted to world mm via the viewport scale). */
const HIT_PX = 8
const NODE_PX = 6
const HANDLE_PX = 6
const ROTATE_OFFSET_PX = 24
const MOVE_THRESHOLD_PX = 3

/** What the edit layer needs from its surroundings. */
export interface EditHost {
  readonly viewport: ViewportController
  readonly selection: SelectionController
  readonly snap: SnapController
  /** The current document (a reactive read, so derived render state recomputes). */
  getDoc(): Project
  execute(command: Command, options?: ExecuteOptions): void
}

/** A transform handle around the selection bounding box. */
export type HandleId = 'nw' | 'ne' | 'se' | 'sw' | 'rotate'

interface Handle {
  readonly id: HandleId
  readonly world: Vec2
}

type Drag =
  | { readonly kind: 'none' }
  | { readonly kind: 'marquee'; from: Vec2; to: Vec2 }
  | {
      readonly kind: 'pending'
      start: Vec2
      /** Candidates under the cursor, nearest first. */
      readonly candidates: readonly string[]
      readonly additive: boolean
      /**
       * True when the press landed on something already selected, so the selection change was
       * held back — the drag moves the whole group, and a click without a drag resolves on up.
       */
      readonly deferred: boolean
    }
  | { readonly kind: 'move'; start: Vec2; ids: string[] }
  | {
      readonly kind: 'node'
      nodeId: string
      key: string
      resolve: (world: Vec2) => Vec2
    }
  | {
      readonly kind: 'handle'
      segId: string
      which: 'p1' | 'p2'
      key: string
      resolve: (world: Vec2) => Vec2
    }
  | {
      readonly kind: 'transform'
      handle: HandleId
      center: Vec2
      anchor: Vec2
      origin: Vec2
      ids: string[]
    }

/**
 * The edit controller (F-013): everything the inert `select` tool does — click/cycle and marquee
 * selection, node dragging (welded junctions move together), bézier-handle editing, double-click
 * split, delete, arrow-nudge, duplicate, and whole-selection transforms (move/rotate/scale/mirror)
 * with interactive handles plus numeric variants. Pointer positions arrive in screen px from the
 * `Canvas`; every document mutation goes through one command (a merged command for a drag, FR-4).
 * Selection lives outside the document (F-013) in {@link SelectionController}.
 */
export class EditController {
  readonly #host: EditHost
  #drag: Drag = { kind: 'none' }
  #dragSeq = 0

  /** The live marquee rectangle (world mm) + its mode, or null. Read by the overlay. */
  marquee = $state<{ from: Vec2; to: Vec2; mode: MarqueeMode } | null>(null)
  /** A live transform preview applied to the selected segments (drawn, not committed). */
  preview = $state<{ transform: Transform2D; ids: readonly string[] } | null>(null)

  constructor(host: EditHost) {
    this.#host = host
  }

  private get vp(): ViewportController {
    return this.#host.viewport
  }
  private get sel(): SelectionController {
    return this.#host.selection
  }

  private tolMm(px: number): number {
    return px / this.vp.transform.scale
  }

  /** Output (selectable) segments — everything but construction guides. */
  private selectableSegments(): Segment[] {
    return Object.values(this.#host.getDoc().segments).filter((s) => s.role !== 'construction')
  }

  private pickScene(): PickScene {
    return buildPickScene(
      this.selectableSegments().map((s) => ({ id: s.id, geometry: s.geometry })),
    )
  }

  // --- Reactive render state -------------------------------------------------

  /** The world-space bounding box of the current selection, or null. */
  selectionBBox = $derived.by<BBox | null>(() => {
    const doc = this.#host.getDoc()
    let box: BBox | null = null
    for (const id of this.sel.selected) {
      const seg = doc.segments[id]
      if (!seg) continue
      const b = bboxOf(seg.geometry)
      box = box ? bboxUnion(box, b) : b
    }
    return box
  })

  /** Endpoint node markers for the selection (world positions). */
  nodeMarkers = $derived.by<Vec2[]>(() => {
    const doc = this.#host.getDoc()
    const seen: Record<string, true> = {}
    const out: Vec2[] = []
    for (const id of this.sel.selected) {
      const seg = doc.segments[id]
      if (!seg) continue
      for (const nid of seg.endpoints) {
        if (seen[nid]) continue
        seen[nid] = true
        const node = doc.nodes[nid]
        if (node) out.push(node.pos)
      }
    }
    return out
  })

  /** Bézier handle lines for a single selected cubic ([anchor, control] pairs). */
  bezierHandles = $derived.by<{ anchor: Vec2; control: Vec2 }[]>(() => {
    const id = this.sel.single
    if (!id) return []
    const seg = this.#host.getDoc().segments[id]
    if (!seg || seg.geometry.kind !== 'cubic') return []
    const c = seg.geometry
    return [
      { anchor: c.p0, control: c.p1 },
      { anchor: c.p3, control: c.p2 },
    ]
  })

  /** Transform handles around the selection bbox (world positions), or empty. */
  handles = $derived.by<Handle[]>(() => {
    const box = this.selectionBBox
    if (!box) return []
    const { min, max } = box
    const cx = (min.x + max.x) / 2
    const rotateWorld = vec2(cx, min.y - ROTATE_OFFSET_PX / this.vp.transform.scale)
    return [
      { id: 'nw', world: vec2(min.x, min.y) },
      { id: 'ne', world: vec2(max.x, min.y) },
      { id: 'se', world: vec2(max.x, max.y) },
      { id: 'sw', world: vec2(min.x, max.y) },
      { id: 'rotate', world: rotateWorld },
    ]
  })

  // --- Pointer ---------------------------------------------------------------

  pointerDown(screen: Vec2, mods: { shift: boolean; alt: boolean }): void {
    const world = screenToWorld(this.vp.transform, screen)

    // 1. Transform handles (screen-space hit, fixed px).
    const handle = this.#hitHandle(screen)
    if (handle && !this.sel.isEmpty) {
      this.#beginTransform(handle, world)
      return
    }
    // 2. Bézier handle of a single selected cubic.
    const bez = this.#hitBezierHandle(screen)
    if (bez) {
      this.#beginHandleDrag(bez.segId, bez.which)
      return
    }
    // 3. A node of a selected segment.
    const node = this.#hitSelectedNode(world)
    if (node) {
      this.#beginNodeDrag(node.id)
      return
    }
    // 4. A segment under the cursor.
    const hits = pickSegments(this.pickScene(), world, this.tolMm(HIT_PX))
    if (hits.length > 0) {
      const candidates = hits.map((h) => h.id)
      // Pressing on part of the current selection keeps that selection, so the drag moves the
      // whole group (all three sides of a triangle, not just the side under the cursor). The
      // click itself is resolved on pointer up, where a press without a drag still narrows to
      // one segment (and shift still toggles it out).
      const deferred = candidates.some((id) => this.sel.has(id))
      if (!deferred) this.sel.click(candidates, mods.shift)
      this.#drag = {
        kind: 'pending',
        start: world,
        candidates,
        additive: mods.shift,
        deferred,
      }
      return
    }
    // 5. Empty space → start a marquee (or clear).
    if (!mods.shift) this.sel.clear()
    this.#drag = { kind: 'marquee', from: world, to: world }
    this.marquee = { from: world, to: world, mode: 'window' }
  }

  pointerMove(screen: Vec2, _mods: { shift: boolean; alt: boolean }): void {
    const world = screenToWorld(this.vp.transform, screen)
    const drag = this.#drag
    switch (drag.kind) {
      case 'marquee': {
        drag.to = world
        this.marquee = { from: drag.from, to: world, mode: marqueeMode(drag.from, world) }
        break
      }
      case 'pending': {
        const startScreen = worldToScreen(this.vp.transform, drag.start)
        if (distance(startScreen, screen) >= MOVE_THRESHOLD_PX) {
          // The whole selection moves, not just the segment under the cursor.
          const ids = [...this.sel.selected]
          this.#drag = { kind: 'move', start: drag.start, ids }
          this.preview = {
            transform: translation(world.x - drag.start.x, world.y - drag.start.y),
            ids,
          }
        }
        break
      }
      case 'move': {
        const delta = vec2(world.x - drag.start.x, world.y - drag.start.y)
        this.preview = { transform: translation(delta.x, delta.y), ids: drag.ids }
        break
      }
      case 'node': {
        const snapped = drag.resolve(world)
        this.#host.execute(moveNode(drag.nodeId, snapped), { coalesceKey: drag.key })
        break
      }
      case 'handle': {
        this.#dragHandle(drag, world)
        break
      }
      case 'transform': {
        this.preview = { transform: this.#transformFor(drag, world, _mods.shift), ids: drag.ids }
        break
      }
    }
  }

  pointerUp(screen: Vec2, mods: { shift: boolean; alt: boolean }): void {
    const world = screenToWorld(this.vp.transform, screen)
    const drag = this.#drag
    this.#drag = { kind: 'none' }
    switch (drag.kind) {
      case 'marquee': {
        const mode = marqueeMode(drag.from, world)
        const rect = normalizeRect(drag.from, world)
        if (rect) {
          const ids = marqueeSelect(
            this.selectableSegments().map((s) => ({ id: s.id, geometry: s.geometry })),
            rect,
            mode,
          )
          if (mods.shift) this.sel.add(ids)
          else this.sel.replace(ids)
        }
        this.marquee = null
        break
      }
      case 'pending': {
        // A press on the existing selection that never became a drag: resolve it now.
        if (drag.deferred) this.sel.click(drag.candidates, drag.additive)
        break
      }
      case 'move':
      case 'transform': {
        if (this.preview) {
          const { transform, ids } = this.preview
          if (!isIdentity(transform) && ids.length > 0) {
            this.#host.execute(transformSegments([...ids], transform))
          }
        }
        this.preview = null
        this.#host.snap.clear()
        break
      }
      case 'node':
      case 'handle':
        this.#host.snap.clear()
        break
    }
  }

  /** Double-click a segment to insert a node there (split via F-010). */
  doubleClick(screen: Vec2): void {
    const world = screenToWorld(this.vp.transform, screen)
    const hit = pickSegments(this.pickScene(), world, this.tolMm(HIT_PX))[0]
    if (!hit) return
    this.#host.execute(splitSegmentAtNode(hit.id, hit.t, newSegmentId(), newNodeId()))
  }

  // --- Keyboard --------------------------------------------------------------

  /** Handle a key for the select tool. Returns true when consumed. */
  handleKeyDown(event: KeyboardEvent): boolean {
    const doc = this.#host.getDoc()
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      this.sel.selectAll(this.selectableSegments().map((s) => s.id))
      return true
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      this.duplicate()
      return true
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return false

    switch (event.key) {
      case 'Escape':
        if (!this.sel.isEmpty) {
          this.sel.clear()
          return true
        }
        return false
      case 'Delete':
      case 'Backspace':
        return this.deleteSelection()
      case 'ArrowLeft':
        return this.nudge(-this.#step(), 0)
      case 'ArrowRight':
        return this.nudge(this.#step(), 0)
      case 'ArrowUp':
        return this.nudge(0, -this.#step())
      case 'ArrowDown':
        return this.nudge(0, this.#step())
    }
    void doc
    return false
  }

  // --- Actions (also called from the inspector) ------------------------------

  deleteSelection(): boolean {
    if (this.sel.isEmpty) return false
    this.#host.execute(removeSegments([...this.sel.selected]))
    this.sel.clear()
    return true
  }

  nudge(dx: number, dy: number): boolean {
    if (this.sel.isEmpty) return false
    this.#host.execute(transformSegments([...this.sel.selected], translation(dx, dy)))
    return true
  }

  /** Duplicate the selection with an offset; the copies (with independent nodes) become selected. */
  duplicate(): void {
    if (this.sel.isEmpty) return
    const doc = this.#host.getDoc()
    const off = this.#step()
    const nodeRemap: Record<string, string> = {}
    const copies: Segment[] = []
    for (const id of this.sel.selected) {
      const seg = doc.segments[id]
      if (!seg) continue
      const remap = (nid: string): string => {
        const next = nodeRemap[nid] ?? newNodeId()
        nodeRemap[nid] = next
        return next
      }
      copies.push({
        id: newSegmentId(),
        role: seg.role,
        geometry: shiftGeometry(seg.geometry, off, off),
        endpoints: [remap(seg.endpoints[0]), remap(seg.endpoints[1])],
      })
    }
    if (copies.length === 0) return
    this.#host.execute(addSegments(copies))
    this.sel.replace(copies.map((c) => c.id))
  }

  moveBy(dx: number, dy: number): void {
    this.nudge(dx, dy)
  }

  rotateBy(deg: number): void {
    const box = this.selectionBBox
    if (!box || this.sel.isEmpty) return
    const center = vec2((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2)
    this.#host.execute(
      transformSegments([...this.sel.selected], rotation((deg * Math.PI) / 180, center)),
    )
  }

  scaleBy(factor: number): void {
    const box = this.selectionBBox
    if (!box || this.sel.isEmpty || factor === 0) return
    const center = vec2((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2)
    this.#host.execute(
      transformSegments(
        [...this.sel.selected],
        compose(
          translation(center.x, center.y),
          scaling(factor),
          translation(-center.x, -center.y),
        ),
      ),
    )
  }

  mirror(axis: 'horizontal' | 'vertical'): void {
    const box = this.selectionBBox
    if (!box || this.sel.isEmpty) return
    const center = vec2((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2)
    // "Horizontal" mirror flips left↔right (reflect across the vertical axis through the centre).
    const t =
      axis === 'horizontal'
        ? compose(translation(2 * center.x, 0), scaling(-1, 1))
        : compose(translation(0, 2 * center.y), scaling(1, -1))
    this.#host.execute(transformSegments([...this.sel.selected], t))
  }

  /** Set a selected segment's endpoint to exact world coordinates (inspector, FR-5). */
  setEndpoint(segId: string, which: 0 | 1, world: Vec2): void {
    const seg = this.#host.getDoc().segments[segId]
    if (!seg) return
    this.#host.execute(moveNode(seg.endpoints[which], world))
  }

  // --- internals -------------------------------------------------------------

  #step(): number {
    return this.vp.grid.minor
  }

  #beginNodeDrag(nodeId: string): void {
    const doc = this.#host.getDoc()
    // Exclude the segments incident to this node so it never snaps to its own moving endpoints.
    const exclude = Object.values(doc.segments)
      .filter((seg) => seg.endpoints[0] === nodeId || seg.endpoints[1] === nodeId)
      .map((seg) => seg.id)
    const resolve = this.#host.snap.buildEditResolver(exclude)
    this.#drag = {
      kind: 'node',
      nodeId,
      key: `edit-node-${nodeId}-${this.#dragSeq++}`,
      resolve: (w) => resolve(w).world,
    }
  }

  #beginHandleDrag(segId: string, which: 'p1' | 'p2'): void {
    const resolve = this.#host.snap.buildEditResolver([segId])
    this.#drag = {
      kind: 'handle',
      segId,
      which,
      key: `edit-handle-${segId}-${which}-${this.#dragSeq++}`,
      resolve: (w) => resolve(w).world,
    }
  }

  #beginTransform(handle: HandleId, world: Vec2): void {
    const box = this.selectionBBox
    if (!box) return
    const center = vec2((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2)
    const corners: Record<Exclude<HandleId, 'rotate'>, Vec2> = {
      nw: vec2(box.min.x, box.min.y),
      ne: vec2(box.max.x, box.min.y),
      se: vec2(box.max.x, box.max.y),
      sw: vec2(box.min.x, box.max.y),
    }
    const opposite: Record<Exclude<HandleId, 'rotate'>, Exclude<HandleId, 'rotate'>> = {
      nw: 'se',
      ne: 'sw',
      se: 'nw',
      sw: 'ne',
    }
    const origin =
      handle === 'rotate' ? this.handles.find((h) => h.id === 'rotate')!.world : corners[handle]
    const anchor = handle === 'rotate' ? center : corners[opposite[handle]]
    this.#drag = { kind: 'transform', handle, center, anchor, origin, ids: [...this.sel.selected] }
    void world
  }

  #transformFor(
    drag: Extract<Drag, { kind: 'transform' }>,
    world: Vec2,
    shift: boolean,
  ): Transform2D {
    if (drag.handle === 'rotate') {
      const a0 = Math.atan2(drag.origin.y - drag.center.y, drag.origin.x - drag.center.x)
      const a1 = Math.atan2(world.y - drag.center.y, world.x - drag.center.x)
      let da = a1 - a0
      if (shift) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12) // 15° steps
      return rotation(da, drag.center)
    }
    const spanX = drag.origin.x - drag.anchor.x
    const spanY = drag.origin.y - drag.anchor.y
    let sx = spanX !== 0 ? (world.x - drag.anchor.x) / spanX : 1
    let sy = spanY !== 0 ? (world.y - drag.anchor.y) / spanY : 1
    if (shift) {
      const s = Math.max(Math.abs(sx), Math.abs(sy))
      sx = Math.sign(sx || 1) * s
      sy = Math.sign(sy || 1) * s
    }
    return compose(
      translation(drag.anchor.x, drag.anchor.y),
      scaling(sx, sy),
      translation(-drag.anchor.x, -drag.anchor.y),
    )
  }

  #dragHandle(drag: Extract<Drag, { kind: 'handle' }>, world: Vec2): void {
    const doc = this.#host.getDoc()
    const seg = doc.segments[drag.segId]
    if (!seg || seg.geometry.kind !== 'cubic') return
    const control = drag.resolve(world)
    const c = seg.geometry
    const updated: CubicBezier =
      drag.which === 'p1'
        ? { kind: 'cubic', p0: c.p0, p1: control, p2: c.p2, p3: c.p3 }
        : { kind: 'cubic', p0: c.p0, p1: c.p1, p2: control, p3: c.p3 }
    this.#host.execute(updateSegmentsGeometry([{ id: drag.segId, geometry: updated }]), {
      coalesceKey: drag.key,
    })
  }

  #hitHandle(screen: Vec2): HandleId | null {
    for (const h of this.handles) {
      const s = worldToScreen(this.vp.transform, h.world)
      if (distance(s, screen) <= HANDLE_PX + 2) return h.id
    }
    return null
  }

  #hitSelectedNode(world: Vec2): NodeTarget | null {
    const doc = this.#host.getDoc()
    const nodes: NodeTarget[] = []
    const seen: Record<string, true> = {}
    for (const id of this.sel.selected) {
      const seg = doc.segments[id]
      if (!seg) continue
      for (const nid of seg.endpoints) {
        if (seen[nid]) continue
        seen[nid] = true
        const node = doc.nodes[nid]
        if (node) nodes.push({ id: nid, pos: node.pos })
      }
    }
    return pickNode(nodes, world, this.tolMm(NODE_PX))
  }

  #hitBezierHandle(screen: Vec2): { segId: string; which: 'p1' | 'p2' } | null {
    const id = this.sel.single
    if (!id) return null
    const seg = this.#host.getDoc().segments[id]
    if (!seg || seg.geometry.kind !== 'cubic') return null
    const c = seg.geometry
    const p1 = worldToScreen(this.vp.transform, c.p1)
    const p2 = worldToScreen(this.vp.transform, c.p2)
    if (distance(p1, screen) <= HANDLE_PX + 2) return { segId: id, which: 'p1' }
    if (distance(p2, screen) <= HANDLE_PX + 2) return { segId: id, which: 'p2' }
    return null
  }
}

function normalizeRect(a: Vec2, b: Vec2): BBox | null {
  if (a.x === b.x || a.y === b.y) return null
  return {
    min: vec2(Math.min(a.x, b.x), Math.min(a.y, b.y)),
    max: vec2(Math.max(a.x, b.x), Math.max(a.y, b.y)),
  }
}

function isIdentity(t: Transform2D): boolean {
  return t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0
}

/** Translate any segment geometry by (dx, dy) — a similarity, so arcs stay arcs. */
function shiftGeometry(geometry: Segment['geometry'], dx: number, dy: number): Segment['geometry'] {
  switch (geometry.kind) {
    case 'line':
      return {
        kind: 'line',
        a: vec2(geometry.a.x + dx, geometry.a.y + dy),
        b: vec2(geometry.b.x + dx, geometry.b.y + dy),
      }
    case 'cubic':
      return {
        kind: 'cubic',
        p0: vec2(geometry.p0.x + dx, geometry.p0.y + dy),
        p1: vec2(geometry.p1.x + dx, geometry.p1.y + dy),
        p2: vec2(geometry.p2.x + dx, geometry.p2.y + dy),
        p3: vec2(geometry.p3.x + dx, geometry.p3.y + dy),
      }
    case 'arc':
      return { ...geometry, center: vec2(geometry.center.x + dx, geometry.center.y + dy) }
  }
}
