import { describe, expect, it } from 'vitest'

import { updateNestingSettings } from './commands'
import { deserialize, serialize } from './serialize'
import { DocumentStore } from './store'
import { defaultNestingSettings, type GlassNestConfig } from './types'

/** Sheet-nesting settings command (F-057): a shallow patch, each edit one undo entry. */
describe('updateNestingSettings', () => {
  it('starts from the shipped defaults', () => {
    const store = new DocumentStore()
    expect(store.document.nesting).toEqual(defaultNestingSettings())
    expect(store.document.nesting).toEqual({ spacingMm: 3, seed: 1, perGlass: {} })
  })

  it('patches only the given fields and is one undo entry', () => {
    const store = new DocumentStore()
    store.execute(updateNestingSettings({ spacingMm: 5 }))
    expect(store.document.nesting.spacingMm).toBe(5)
    expect(store.document.nesting.seed).toBe(1)
    expect(store.document.nesting.perGlass).toEqual({})

    store.undo()
    expect(store.document.nesting.spacingMm).toBe(3)
    store.redo()
    expect(store.document.nesting.spacingMm).toBe(5)
  })

  it('replaces the whole per-glass override map in one step', () => {
    const store = new DocumentStore()
    const perGlass: Record<string, GlassNestConfig> = {
      'gl-1': { sheet: { widthMm: 600, heightMm: 900 }, rotation: 'flip' },
    }
    store.execute(updateNestingSettings({ perGlass }))
    expect(store.document.nesting.perGlass).toEqual(perGlass)
    store.undo()
    expect(store.document.nesting.perGlass).toEqual({})
  })

  it('a reshuffle (seed bump) is its own undo entry and does not disturb spacing', () => {
    const store = new DocumentStore()
    store.execute(updateNestingSettings({ spacingMm: 4 }))
    store.execute(updateNestingSettings({ seed: 2 }))
    expect(store.document.nesting).toEqual({ spacingMm: 4, seed: 2, perGlass: {} })
    store.undo()
    expect(store.document.nesting.seed).toBe(1)
    expect(store.document.nesting.spacingMm).toBe(4)
  })

  it('round-trips through serialize/deserialize', () => {
    const store = new DocumentStore()
    store.execute(
      updateNestingSettings({
        spacingMm: 2.5,
        seed: 7,
        perGlass: { 'gl-x': { rotation: 'fixed' } },
      }),
    )
    const back = deserialize(serialize(store.document))
    expect(back.nesting).toEqual({
      spacingMm: 2.5,
      seed: 7,
      perGlass: { 'gl-x': { rotation: 'fixed' } },
    })
  })
})
