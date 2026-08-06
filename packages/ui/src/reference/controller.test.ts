import { packDocument, unpackDocument, DocumentStore, type ReferenceAsset } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import type { OpenedImage } from '../document/host'

import { ReferenceController } from './controller.svelte'

/** A controller backed by a real store, with image decode/prepare stubbed (no browser needed). */
function setup() {
  const store = new DocumentStore()
  const controller = new ReferenceController({
    getDoc: () => store.document,
    execute: (command, options) => store.execute(command, options),
    prepare: async (bytes, mime) => ({ bytes, mime, width: 1000, height: 500 }),
    decode: async () => ({}) as TexImageSource,
  })
  return { store, controller }
}

const image = (bytes: number[]): OpenedImage => ({
  path: 'window.png',
  mime: 'image/png',
  bytes: new Uint8Array(bytes),
})

async function addLayer(controller: ReferenceController, bytes = [1, 2, 3, 4]) {
  await controller.importImage(async () => image(bytes))
  return controller.selected!
}

describe('ReferenceController — import', () => {
  it('imports an image, embeds the asset and adds a selected layer (FR-3/FR-4)', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    expect(controller.layers).toHaveLength(1)
    expect(controller.selectedId).toBe(layer.id)
    expect(layer.name).toBe('window')
    expect(layer.naturalWidthPx).toBe(1000)
    expect(controller.assets.get(layer.assetId)).toBeTruthy()
    // A fresh layer is un-rectified: srcQuad is the whole image.
    expect(layer.srcQuad).toEqual([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 },
    ])
  })
})

describe('ReferenceController — layer ops (undoable)', () => {
  it('toggles opacity, desaturate, visibility and lock', async () => {
    const { store, controller } = setup()
    const layer = await addLayer(controller)
    controller.setOpacity(layer.id, 0.25)
    controller.toggleDesaturate(layer.id)
    controller.toggleVisible(layer.id)
    controller.toggleLock(layer.id)
    const l = controller.layers[0]!
    expect(l.opacity).toBe(0.25)
    expect(l.desaturate).toBe(true)
    expect(l.visible).toBe(false)
    expect(l.locked).toBe(true)
    // Each op is one undo entry; undoing the lock leaves the rest.
    store.undo()
    expect(controller.layers[0]!.locked).toBe(false)
    expect(controller.layers[0]!.visible).toBe(false)
  })

  it('a locked layer ignores transform edits', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    controller.toggleLock(layer.id)
    const before = controller.layers[0]!.dstQuad
    controller.translate(layer.id, 50, 50)
    expect(controller.layers[0]!.dstQuad).toEqual(before)
  })

  it('a corner drag resizes the layer about the opposite corner, keeping the aspect ratio', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    const [tl, tr, br] = layer.dstQuad
    const w0 = tr.x - tl.x
    const h0 = br.y - tr.y

    // Drag the bottom-right corner (index 2) out along the diagonal to double the size.
    controller.scaleFromCorner(layer.id, 2, { x: tl.x + w0 * 2, y: tl.y + h0 * 2 })
    const q = controller.layers[0]!.dstQuad
    expect(q[0]).toEqual(tl) // the opposite corner is pinned
    expect(q[1].x - q[0].x).toBeCloseTo(w0 * 2, 6)
    expect(q[2].y - q[1].y).toBeCloseTo(h0 * 2, 6)
    // Aspect preserved, so a pointer off the diagonal cannot stretch one axis.
    controller.scaleFromCorner(layer.id, 2, { x: tl.x + w0 * 2, y: tl.y + h0 * 8 })
    const q2 = controller.layers[0]!.dstQuad
    expect((q2[1].x - q2[0].x) / (q2[2].y - q2[1].y)).toBeCloseTo(w0 / h0, 6)
  })

  it('a corner drag past the anchor clamps instead of inverting the layer', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    const tl = layer.dstQuad[0]
    controller.scaleFromCorner(layer.id, 2, { x: tl.x - 5000, y: tl.y - 5000 })
    const q = controller.layers[0]!.dstQuad
    expect(q[1].x - q[0].x).toBeGreaterThan(0)
    expect(q[2].y - q[1].y).toBeGreaterThan(0)
  })

  it('a locked layer ignores a corner resize', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    controller.toggleLock(layer.id)
    const before = controller.layers[0]!.dstQuad
    controller.scaleFromCorner(layer.id, 2, { x: 9999, y: 9999 })
    expect(controller.layers[0]!.dstQuad).toEqual(before)
  })

  it('reorders the stack', async () => {
    const { controller } = setup()
    const a = await addLayer(controller, [1])
    const b = await addLayer(controller, [2])
    expect(controller.layers.map((l) => l.id)).toEqual([a.id, b.id])
    controller.reorder(a.id, 'up')
    expect(controller.layers.map((l) => l.id)).toEqual([b.id, a.id])
  })
})

describe('ReferenceController — calibration (FR-1)', () => {
  it('rescales the layer so the marked span equals the real distance', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    const width0 = layer.dstQuad[1].x - layer.dstQuad[0].x
    controller.select(layer.id)
    controller.setMode('calibrate')
    // Two points 100 mm apart in world.
    controller.addCalibrationPoint({ x: 0, y: 0 })
    controller.addCalibrationPoint({ x: 100, y: 0 })
    controller.applyCalibration(200) // that span should really be 200 mm → scale ×2
    const width1 = controller.layers[0]!.dstQuad[1].x - controller.layers[0]!.dstQuad[0].x
    expect(width1).toBeCloseTo(width0 * 2, 6)
    expect(controller.mode).toBe('place')
  })
})

describe('ReferenceController — perspective (FR-2)', () => {
  it('rectifies to an axis-aligned real rectangle and marks the layer rectified', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    controller.select(layer.id)
    controller.setMode('rectify')
    // Leave the four markers on the layer's own corners (identity mapping): srcQuad stays the whole
    // image, dstQuad becomes the given real rectangle.
    controller.applyRectify(1200, 800)
    const l = controller.layers[0]!
    expect(l.rectified).toBe(true)
    const w = l.dstQuad[1].x - l.dstQuad[0].x
    const h = l.dstQuad[2].y - l.dstQuad[1].y
    expect(w).toBeCloseTo(1200, 6)
    expect(h).toBeCloseTo(800, 6)
    // The window corners map back to (near) the whole image, since the markers were the corners.
    expect(l.srcQuad[0].x).toBeCloseTo(0, 3)
    expect(l.srcQuad[2].x).toBeCloseTo(1000, 3)
  })

  it('reset restores the whole un-rectified image', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    controller.select(layer.id)
    controller.setMode('rectify')
    controller.applyRectify(1200, 800)
    controller.resetRectify(layer.id)
    const l = controller.layers[0]!
    expect(l.rectified).toBe(false)
    expect(l.srcQuad).toEqual([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 },
    ])
  })
})

describe('ReferenceController — asset lifecycle (FR-3)', () => {
  it('collects only referenced assets and round-trips through the container', async () => {
    const { store, controller } = setup()
    const layer = await addLayer(controller, [9, 8, 7, 6])
    const assets = controller.collectAssets()
    expect(assets.size).toBe(1)

    const bytes = packDocument(store.document, assets)
    const restored = unpackDocument(bytes)
    expect(restored.project.layers).toHaveLength(1)
    const asset = restored.assets.get(layer.assetId) as ReferenceAsset
    expect([...asset.bytes]).toEqual([9, 8, 7, 6])
  })

  it('drops orphaned assets when a layer is removed', async () => {
    const { controller } = setup()
    const layer = await addLayer(controller)
    controller.remove(layer.id)
    expect(controller.layers).toHaveLength(0)
    expect(controller.collectAssets().size).toBe(0)
    expect(controller.selectedId).toBeNull()
  })

  it('loads assets from a freshly-opened file', async () => {
    const { controller } = setup()
    const loaded = new Map<string, ReferenceAsset>([
      ['img-abc', { mime: 'image/png', bytes: new Uint8Array([5, 5, 5]) }],
    ])
    controller.loadAssets(loaded)
    expect(controller.assets.get('img-abc')).toBeTruthy()
  })
})
