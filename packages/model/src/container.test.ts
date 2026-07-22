import { vec2 } from '@vitrum/geometry'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { addReferenceLayer } from './commands'
import { assetIdFor, packDocument, unpackDocument } from './container'
import { DocumentStore } from './store'
import type { ReferenceAsset, ReferenceLayer } from './types'

const layer = (id: string, assetId: string): ReferenceLayer => ({
  id,
  name: 'window photo',
  assetId,
  naturalWidthPx: 1200,
  naturalHeightPx: 800,
  srcQuad: [vec2(0, 0), vec2(1200, 0), vec2(1200, 800), vec2(0, 800)],
  dstQuad: [vec2(0, 0), vec2(1200, 0), vec2(1200, 800), vec2(0, 800)],
  opacity: 0.7,
  desaturate: false,
  visible: true,
  locked: false,
  rectified: false,
})

const asset = (bytes: number[], mime = 'image/png'): ReferenceAsset => ({
  mime,
  bytes: new Uint8Array(bytes),
})

describe('assetIdFor', () => {
  it('is stable for identical bytes and differs for different bytes', () => {
    const a = assetIdFor(new Uint8Array([1, 2, 3, 4]))
    expect(assetIdFor(new Uint8Array([1, 2, 3, 4]))).toBe(a)
    expect(assetIdFor(new Uint8Array([4, 3, 2, 1]))).not.toBe(a)
  })
})

describe('packDocument / unpackDocument (FR-3)', () => {
  it('round-trips a project with no assets', () => {
    const store = new DocumentStore()
    const bytes = packDocument(store.document, new Map())
    const { project, assets } = unpackDocument(bytes)
    expect(project).toEqual(store.document)
    expect(assets.size).toBe(0)
  })

  it('round-trips embedded image bytes byte-for-byte', () => {
    const store = new DocumentStore()
    const idA = assetIdFor(new Uint8Array([137, 80, 78, 71, 1, 2, 3]))
    const idB = assetIdFor(new Uint8Array([255, 216, 255, 9, 9]))
    store.execute(addReferenceLayer(layer('l1', idA)))
    store.execute(addReferenceLayer(layer('l2', idB)))
    const assets = new Map<string, ReferenceAsset>([
      [idA, asset([137, 80, 78, 71, 1, 2, 3], 'image/png')],
      [idB, asset([255, 216, 255, 9, 9], 'image/jpeg')],
    ])

    const bytes = packDocument(store.document, assets)
    const restored = unpackDocument(bytes)

    expect(restored.project.layers).toHaveLength(2)
    expect(restored.assets.size).toBe(2)
    expect(restored.assets.get(idA)).toEqual(asset([137, 80, 78, 71, 1, 2, 3], 'image/png'))
    expect(restored.assets.get(idB)!.mime).toBe('image/jpeg')
    expect([...restored.assets.get(idB)!.bytes]).toEqual([255, 216, 255, 9, 9])
  })

  it('rejects bytes that are not a valid archive', () => {
    expect(() => unpackDocument(new Uint8Array([0, 1, 2, 3]))).toThrow(/not a valid archive/i)
  })

  it('rejects a valid archive that is missing document.json', () => {
    const stray = zipSync({ 'assets/manifest.json': new Uint8Array([123, 125]) })
    expect(() => unpackDocument(stray)).toThrow(/missing document\.json/i)
  })
})
