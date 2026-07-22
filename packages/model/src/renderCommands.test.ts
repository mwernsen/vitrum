import { describe, expect, it } from 'vitest'

import { setPieceTextureTransforms, updateRenderSettings } from './commands'
import { deserialize, serialize } from './serialize'
import { DocumentStore } from './store'
import {
  defaultRenderSettings,
  identityTextureTransform,
  type PieceTextureTransform,
} from './types'

/** Realistic-render backlight command (F-053 FR-1): a shallow patch, each edit one undo entry. */
describe('updateRenderSettings', () => {
  it('starts from the shipped defaults', () => {
    const store = new DocumentStore()
    expect(store.document.render).toEqual(defaultRenderSettings())
    expect(store.document.render).toEqual({
      backlightIntensity: 1,
      backlightWarmth: 0,
      textureTransforms: {},
    })
  })

  it('patches only the given backlight fields and is one undo entry', () => {
    const store = new DocumentStore()
    store.execute(updateRenderSettings({ backlightIntensity: 1.6 }))
    expect(store.document.render.backlightIntensity).toBe(1.6)
    expect(store.document.render.backlightWarmth).toBe(0)

    store.undo()
    expect(store.document.render.backlightIntensity).toBe(1)
    store.redo()
    expect(store.document.render.backlightIntensity).toBe(1.6)
  })

  it('never disturbs per-piece texture transforms', () => {
    const store = new DocumentStore()
    const t: PieceTextureTransform = { rotationDeg: 30, offsetXmm: 2, offsetYmm: -1, scale: 1.2 }
    store.execute(setPieceTextureTransforms({ 'p-abc': t }))
    store.execute(updateRenderSettings({ backlightWarmth: 0.5 }))
    expect(store.document.render.textureTransforms['p-abc']).toEqual(t)
  })

  it('round-trips through serialize/deserialize', () => {
    const store = new DocumentStore()
    store.execute(updateRenderSettings({ backlightIntensity: 0.75, backlightWarmth: -0.3 }))
    const back = deserialize(serialize(store.document))
    expect(back.render.backlightIntensity).toBe(0.75)
    expect(back.render.backlightWarmth).toBe(-0.3)
  })
})

/** Per-piece texture placement command (F-053): content-id-keyed set/clear, one undo entry. */
describe('setPieceTextureTransforms', () => {
  const t1: PieceTextureTransform = { rotationDeg: 45, offsetXmm: 5, offsetYmm: 0, scale: 1 }
  const t2: PieceTextureTransform = { rotationDeg: 0, offsetXmm: 0, offsetYmm: 3, scale: 2 }

  it('sets, clears (null), and is self-inverting', () => {
    const store = new DocumentStore()
    store.execute(setPieceTextureTransforms({ 'p-1': t1, 'p-2': t2 }))
    expect(store.document.render.textureTransforms).toEqual({ 'p-1': t1, 'p-2': t2 })

    // Clearing one is one undo step and restores it on undo.
    store.execute(setPieceTextureTransforms({ 'p-1': null }))
    expect(store.document.render.textureTransforms['p-1']).toBeUndefined()
    expect(store.document.render.textureTransforms['p-2']).toEqual(t2)
    store.undo()
    expect(store.document.render.textureTransforms['p-1']).toEqual(t1)
  })

  it('undo restores the exact prior value of every touched key', () => {
    const store = new DocumentStore()
    store.execute(setPieceTextureTransforms({ 'p-1': t1 }))
    store.execute(setPieceTextureTransforms({ 'p-1': t2, 'p-2': t2 }))
    expect(store.document.render.textureTransforms['p-1']).toEqual(t2)
    store.undo()
    expect(store.document.render.textureTransforms['p-1']).toEqual(t1)
    expect(store.document.render.textureTransforms['p-2']).toBeUndefined()
  })

  it('round-trips content-id-keyed placements through serialize/deserialize (reload-safe)', () => {
    const store = new DocumentStore()
    store.execute(setPieceTextureTransforms({ 'p-xyz': identityTextureTransform() }))
    const back = deserialize(serialize(store.document))
    expect(back.render.textureTransforms['p-xyz']).toEqual(identityTextureTransform())
  })
})
