import { applyHomography, homographyFromQuadToQuad, type Quad, type Vec2 } from '@vitrum/geometry'
import {
  addReferenceLayer,
  assetIdFor,
  newLayerId,
  removeReferenceLayer,
  reorderReferenceLayers,
  updateReferenceLayer,
  type Command,
  type ExecuteOptions,
  type AssetId,
  type LayerId,
  type Project,
  type ReferenceAsset,
  type ReferenceLayer,
} from '@vitrum/model'
import { SvelteMap } from 'svelte/reactivity'

import type { OpenedImage } from '../document/host'

import type { RenderLayer } from './gl'
import { prepareReferenceImage } from './prepare'

/** Interaction mode for the selected reference layer (F-051). */
export type ReferenceMode = 'place' | 'calibrate' | 'rectify'

/** What the reference-image feature needs from its surroundings. */
export interface ReferenceHost {
  getDoc(): Project
  execute(command: Command, options?: ExecuteOptions): void
  /** Decode image bytes into a GPU-uploadable source (browser only; omitted in tests). */
  prepare?: (
    bytes: Uint8Array,
    mime: string,
  ) => Promise<{
    bytes: Uint8Array
    mime: string
    width: number
    height: number
  }>
  /** Decode a stored asset into a texture source (browser only; omitted in tests). */
  decode?: (asset: ReferenceAsset) => Promise<TexImageSource>
}

/** Longest edge of a freshly-placed layer, in mm, before the user calibrates. */
const DEFAULT_LONGEST_MM = 300

/** Floor for a corner resize, so dragging past the anchor cannot collapse or invert the layer. */
const MIN_SCALE = 0.02

/**
 * The reference-image underlay controller (F-051). Owns the runtime image blobs (the bytes embedded
 * in the `.vitrum` zip), the decoded GPU sources, the current selection and interaction mode, and
 * every layer edit — each routed through one document command so undo/redo and persistence come for
 * free. Placement, calibration and perspective rectification are all expressed as edits to a layer's
 * two quads (`dstQuad` in world mm, `srcQuad` in image px), so the renderer and the maths stay
 * uniform. The controller holds no document state of its own beyond the transient drag/calibration
 * scratch; layers live on the document.
 */
export class ReferenceController {
  readonly #host: ReferenceHost

  /** Embedded image blobs by content id. Reactive so the panel reflects imports/removals. */
  readonly assets = new SvelteMap<AssetId, ReferenceAsset>()
  /** Decoded texture sources by asset id (non-reactive; the renderer reads through `resolveSource`). */
  readonly #sources: Record<AssetId, TexImageSource> = {}
  /** Bumped when a new source finishes decoding, to nudge the underlay to redraw. */
  sourcesVersion = $state(0)

  selectedId = $state<LayerId | null>(null)
  mode = $state<ReferenceMode>('place')
  busy = $state(false)
  error = $state<string | null>(null)

  /** Calibration scratch: up to two world-space points the user clicked (FR-1). */
  calibrationPoints = $state<readonly Vec2[]>([])
  /** Rectification scratch: four world-space markers over the window's corners (FR-2). */
  rectifyMarkers = $state<Quad | null>(null)

  constructor(host: ReferenceHost) {
    this.#host = host
  }

  get layers(): readonly ReferenceLayer[] {
    return this.#host.getDoc().layers
  }

  get selected(): ReferenceLayer | null {
    return this.layers.find((l) => l.id === this.selectedId) ?? null
  }

  /** Layers shaped for the WebGL renderer (bottom-to-top draw order = document order). */
  get renderLayers(): readonly RenderLayer[] {
    void this.sourcesVersion // re-derive when a source decodes
    return this.layers.map((l) => ({
      assetId: l.assetId,
      naturalWidthPx: l.naturalWidthPx,
      naturalHeightPx: l.naturalHeightPx,
      srcQuad: l.srcQuad,
      dstQuad: l.dstQuad,
      opacity: l.opacity,
      desaturate: l.desaturate,
      visible: l.visible,
    }))
  }

  resolveSource = (assetId: AssetId): TexImageSource | undefined => this.#sources[assetId]

  select(id: LayerId | null): void {
    this.selectedId = id
    this.mode = 'place'
    this.calibrationPoints = []
    this.rectifyMarkers = null
  }

  setMode(mode: ReferenceMode): void {
    this.mode = mode
    this.calibrationPoints = []
    this.rectifyMarkers =
      mode === 'rectify' && this.selected ? cloneQuad(this.selected.dstQuad) : null
  }

  /** Import a raster image through the host, downscale/embed it and add a layer (FR-3, FR-4). */
  async importImage(open: () => Promise<OpenedImage | null>): Promise<void> {
    this.busy = true
    this.error = null
    try {
      const chosen = await open()
      if (!chosen) return
      const prepare = this.#host.prepare ?? prepareReferenceImage
      const prepared = await prepare(chosen.bytes, chosen.mime)
      const assetId = assetIdFor(prepared.bytes)
      const asset: ReferenceAsset = { mime: prepared.mime, bytes: prepared.bytes }
      this.assets.set(assetId, asset)
      void this.#ensureSource(assetId)
      const layer = defaultLayer(assetId, prepared.width, prepared.height, baseName(chosen.path))
      this.#host.execute(addReferenceLayer(layer))
      this.select(layer.id)
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.busy = false
    }
  }

  setOpacity(id: LayerId, opacity: number): void {
    this.#patch(id, { opacity: clamp01(opacity) }, `ref-opacity-${id}`)
  }

  toggleDesaturate(id: LayerId): void {
    const layer = this.#layer(id)
    if (layer) this.#patch(id, { desaturate: !layer.desaturate })
  }

  toggleVisible(id: LayerId): void {
    const layer = this.#layer(id)
    if (layer) this.#patch(id, { visible: !layer.visible })
  }

  toggleLock(id: LayerId): void {
    const layer = this.#layer(id)
    if (layer) this.#patch(id, { locked: !layer.locked })
  }

  rename(id: LayerId, name: string): void {
    this.#patch(id, { name })
  }

  remove(id: LayerId): void {
    this.#host.execute(removeReferenceLayer(id))
    if (this.selectedId === id) this.select(null)
  }

  /** Move a layer up (towards the top of the stack) or down, by one place. */
  reorder(id: LayerId, direction: 'up' | 'down'): void {
    const ids = this.layers.map((l) => l.id)
    const i = ids.indexOf(id)
    const j = direction === 'up' ? i + 1 : i - 1
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    this.#host.execute(reorderReferenceLayers(ids))
  }

  /**
   * Resize the layer by dragging one corner: the whole destination quad scales uniformly about
   * the opposite corner, so the image keeps its aspect ratio (the "scale" op of the F-051 scope).
   * The pointer is projected onto the anchor→corner diagonal, which keeps the handle under the
   * cursor without ever shearing the quad. {@link dragCorner} is the free-corner variant.
   */
  scaleFromCorner(id: LayerId, corner: number, world: Vec2): void {
    const layer = this.#layer(id)
    if (!layer || layer.locked) return
    const anchor = layer.dstQuad[(corner + 2) % 4]!
    const grabbed = layer.dstQuad[corner]!
    const dx = grabbed.x - anchor.x
    const dy = grabbed.y - anchor.y
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return
    const projected = ((world.x - anchor.x) * dx + (world.y - anchor.y) * dy) / lenSq
    const scale = Math.max(projected, MIN_SCALE)
    const dstQuad = layer.dstQuad.map((p) => ({
      x: anchor.x + (p.x - anchor.x) * scale,
      y: anchor.y + (p.y - anchor.y) * scale,
    })) as unknown as Quad
    this.#patch(id, { dstQuad }, `ref-scale-${id}`)
  }

  /** Drag one destination-quad corner to `world` (free transform / perspective placement). */
  dragCorner(id: LayerId, corner: number, world: Vec2): void {
    const layer = this.#layer(id)
    if (!layer || layer.locked) return
    const dstQuad = cloneQuad(layer.dstQuad)
    dstQuad[corner] = world
    this.#patch(id, { dstQuad }, `ref-drag-${id}`)
  }

  /** Translate the whole layer by a world-space delta (body drag). */
  translate(id: LayerId, dx: number, dy: number): void {
    const layer = this.#layer(id)
    if (!layer || layer.locked) return
    const dstQuad = layer.dstQuad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as unknown as Quad
    this.#patch(id, { dstQuad }, `ref-move-${id}`)
  }

  /** Record a calibration point; the third click restarts a fresh pair. */
  addCalibrationPoint(world: Vec2): void {
    const points = this.calibrationPoints.length >= 2 ? [] : [...this.calibrationPoints]
    points.push(world)
    this.calibrationPoints = points
  }

  /** Rescale the selected layer so the two calibration points span `realMm` in world units (FR-1). */
  applyCalibration(realMm: number): void {
    const layer = this.selected
    const [a, b] = this.calibrationPoints
    if (!layer || !a || !b || realMm <= 0) return
    const measured = Math.hypot(b.x - a.x, b.y - a.y)
    if (measured <= 0) return
    const s = realMm / measured
    const c = centroid(layer.dstQuad)
    const dstQuad = layer.dstQuad.map((p) => ({
      x: c.x + (p.x - c.x) * s,
      y: c.y + (p.y - c.y) * s,
    })) as unknown as Quad
    // Measured, not guessed: the layer's millimetres now mean something, so autotrace will run on
    // it (F-059 FR-3).
    this.#patch(layer.id, { dstQuad, calibrated: true })
    this.calibrationPoints = []
    this.mode = 'place'
  }

  /** Move a rectification marker (over a window corner). */
  setRectifyMarker(corner: number, world: Vec2): void {
    if (!this.rectifyMarkers) return
    const markers = cloneQuad(this.rectifyMarkers)
    markers[corner] = world
    this.rectifyMarkers = markers
  }

  /**
   * Rectify the selected layer: the four markers (over the window's corners in the displayed image)
   * become the image-space `srcQuad`, and the destination becomes an axis-aligned `realWmm × realHmm`
   * rectangle at the layer's current top-left (FR-2).
   */
  applyRectify(realWmm: number, realHmm: number): void {
    const layer = this.selected
    const markers = this.rectifyMarkers
    if (!layer || !markers || realWmm <= 0 || realHmm <= 0) return
    // Map each world marker back into image-pixel space through the layer's current mapping.
    const worldToImage = homographyFromQuadToQuad(layer.dstQuad, layer.srcQuad)
    const srcQuad = markers.map((m) => applyHomography(worldToImage, m)) as unknown as Quad
    const tl = layer.dstQuad[0]
    const dstQuad: Quad = [
      { x: tl.x, y: tl.y },
      { x: tl.x + realWmm, y: tl.y },
      { x: tl.x + realWmm, y: tl.y + realHmm },
      { x: tl.x, y: tl.y + realHmm },
    ]
    // Rectifying asks for the window's real width and height, so it calibrates too (F-059 FR-3).
    this.#patch(layer.id, { srcQuad, dstQuad, rectified: true, calibrated: true })
    this.rectifyMarkers = null
    this.mode = 'place'
  }

  /** Reset the selected layer's perspective back to the whole un-rectified image. */
  resetRectify(id: LayerId): void {
    const layer = this.#layer(id)
    if (!layer) return
    const srcQuad: Quad = [
      { x: 0, y: 0 },
      { x: layer.naturalWidthPx, y: 0 },
      { x: layer.naturalWidthPx, y: layer.naturalHeightPx },
      { x: 0, y: layer.naturalHeightPx },
    ]
    this.#patch(id, { srcQuad, rectified: false })
  }

  /** Assets still referenced by a layer — what the container should embed on save (drops orphans). */
  collectAssets(): ReadonlyMap<AssetId, ReferenceAsset> {
    const used = new SvelteMap<AssetId, ReferenceAsset>()
    for (const layer of this.layers) {
      const asset = this.assets.get(layer.assetId)
      if (asset) used.set(layer.assetId, asset)
    }
    return used
  }

  /** Replace the runtime asset store from a freshly-opened file, and decode the sources. */
  loadAssets(assets: ReadonlyMap<AssetId, ReferenceAsset>): void {
    this.assets.clear()
    for (const key of Object.keys(this.#sources)) delete this.#sources[key]
    for (const [id, asset] of assets) {
      this.assets.set(id, asset)
      void this.#ensureSource(id)
    }
    this.select(null)
  }

  async #ensureSource(assetId: AssetId): Promise<void> {
    if (this.#sources[assetId]) return
    const asset = this.assets.get(assetId)
    const decode = this.#host.decode ?? defaultDecode
    if (!asset || !decode) return
    try {
      const source = await decode(asset)
      this.#sources[assetId] = source
      this.sourcesVersion++
    } catch {
      // A source that fails to decode simply never draws; the layer metadata still round-trips.
    }
  }

  #patch(id: LayerId, patch: Partial<Omit<ReferenceLayer, 'id'>>, coalesceKey?: string): void {
    this.#host.execute(updateReferenceLayer(id, patch), coalesceKey ? { coalesceKey } : undefined)
  }

  #layer(id: LayerId): ReferenceLayer | undefined {
    return this.layers.find((l) => l.id === id)
  }
}

/** Decode stored bytes into an `ImageBitmap` texture source (browser only). */
async function defaultDecode(asset: ReferenceAsset): Promise<TexImageSource> {
  if (typeof createImageBitmap === 'undefined') {
    throw new Error('No image decoder available.')
  }
  const blob = new Blob([asset.bytes.slice().buffer], { type: asset.mime })
  return createImageBitmap(blob)
}

function defaultLayer(
  assetId: AssetId,
  width: number,
  height: number,
  name: string,
): ReferenceLayer {
  const longest = Math.max(width, height, 1)
  const scale = DEFAULT_LONGEST_MM / longest
  const w = width * scale
  const h = height * scale
  return {
    id: newLayerId(),
    name,
    assetId,
    naturalWidthPx: width,
    naturalHeightPx: height,
    srcQuad: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    dstQuad: [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ],
    opacity: 0.6,
    desaturate: false,
    visible: true,
    locked: false,
    rectified: false,
    // The 300 mm above is arbitrary — enough to see the image, not a measurement.
    calibrated: false,
  }
}

function cloneQuad(q: Quad): [Vec2, Vec2, Vec2, Vec2] {
  return [
    { x: q[0].x, y: q[0].y },
    { x: q[1].x, y: q[1].y },
    { x: q[2].x, y: q[2].y },
    { x: q[3].x, y: q[3].y },
  ]
}

function centroid(q: Quad): Vec2 {
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function baseName(path: string): string {
  const file = path.split(/[/\\]/).pop() ?? path
  return file.replace(/\.[^.]+$/, '') || 'reference image'
}
