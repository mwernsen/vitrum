import { describe, expect, it } from 'vitest'

import { updateNumbering } from './commands'
import { deserialize, serialize } from './serialize'
import { DocumentStore } from './store'
import { createEmptyProject } from './types'

describe('numbering command (F-040)', () => {
  it('an empty project starts grouped-by-glass with nothing numbered', () => {
    expect(createEmptyProject().numbering).toEqual({
      scheme: 'grouped',
      glassCodes: {},
      auto: {},
      overrides: {},
    })
  })

  it('changes the scheme in one undo step', () => {
    const store = new DocumentStore()
    store.execute(updateNumbering({ scheme: 'sequential' }))
    expect(store.document.numbering.scheme).toBe('sequential')
    store.undo()
    expect(store.document.numbering.scheme).toBe('grouped')
    store.redo()
    expect(store.document.numbering.scheme).toBe('sequential')
  })

  it('a renumber replaces auto + glassCodes and inverts exactly', () => {
    const store = new DocumentStore()
    store.execute(updateNumbering({ auto: { 'p-a': 'A1' }, glassCodes: { g1: 'A' } }))
    store.execute(updateNumbering({ auto: { 'p-a': 'A1', 'p-b': 'A2' }, glassCodes: { g1: 'A' } }))
    expect(store.document.numbering.auto).toEqual({ 'p-a': 'A1', 'p-b': 'A2' })
    store.undo()
    expect(store.document.numbering.auto).toEqual({ 'p-a': 'A1' })
  })

  it('a manual override does not touch auto, and survives its own undo', () => {
    const store = new DocumentStore()
    store.execute(updateNumbering({ auto: { 'p-a': 'A1' } }))
    store.execute(updateNumbering({ overrides: { 'p-a': 'star' } }))
    expect(store.document.numbering.auto).toEqual({ 'p-a': 'A1' })
    expect(store.document.numbering.overrides).toEqual({ 'p-a': 'star' })
    store.undo()
    expect(store.document.numbering.overrides).toEqual({})
    expect(store.document.numbering.auto).toEqual({ 'p-a': 'A1' })
  })

  it('a patch touching several fields inverts each one independently', () => {
    const store = new DocumentStore()
    store.execute(updateNumbering({ scheme: 'sequential', auto: { 'p-a': '1' } }))
    // Renumber + scheme change at once; glassCodes/overrides untouched by this patch.
    store.execute(
      updateNumbering({ scheme: 'grouped', auto: { 'p-a': 'A1' }, glassCodes: { g1: 'A' } }),
    )
    expect(store.document.numbering.scheme).toBe('grouped')
    store.undo()
    expect(store.document.numbering).toEqual({
      scheme: 'sequential',
      glassCodes: {},
      auto: { 'p-a': '1' },
      overrides: {},
    })
  })

  it('numbering is serialized with the project and round-trips', () => {
    const store = new DocumentStore()
    store.execute(
      updateNumbering({
        scheme: 'sequential',
        glassCodes: { g1: 'A' },
        auto: { 'p-a': '1' },
        overrides: { 'p-b': 'custom' },
      }),
    )
    const reloaded = deserialize(serialize(store.document))
    expect(reloaded.numbering).toEqual({
      scheme: 'sequential',
      glassCodes: { g1: 'A' },
      auto: { 'p-a': '1' },
      overrides: { 'p-b': 'custom' },
    })
  })
})
