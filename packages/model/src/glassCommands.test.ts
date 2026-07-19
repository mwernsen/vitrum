import { describe, expect, it } from 'vitest'

import { removeGlass, upsertGlass } from './commands'
import { serialize, deserialize } from './serialize'
import { DocumentStore } from './store'
import { createEmptyProject } from './types'
import type { Glass } from './types'

const glass = (over: Partial<Glass> & { id: string }): Glass => ({
  name: 'Ruby cathedral',
  color: '#9b1b26',
  transparency: 'transparent',
  texture: 'smooth',
  thicknessMm: 3,
  ...over,
})

describe('project glass commands (F-022 FR-1)', () => {
  it('upserts a glass into the project catalog', () => {
    const store = new DocumentStore()
    store.execute(upsertGlass(glass({ id: 'a' })))
    expect(store.document.glasses['a']!.name).toBe('Ruby cathedral')
  })

  it('undo/redo of upsert is exact', () => {
    const store = new DocumentStore()
    store.execute(upsertGlass(glass({ id: 'a' })))
    store.undo()
    expect(store.document.glasses['a']).toBeUndefined()
    store.redo()
    expect(store.document.glasses['a']!.name).toBe('Ruby cathedral')
  })

  it('upsert replaces an existing glass and undo restores the prior value', () => {
    const store = new DocumentStore()
    store.execute(upsertGlass(glass({ id: 'a', name: 'First' })))
    store.execute(upsertGlass(glass({ id: 'a', name: 'Second' })))
    expect(store.document.glasses['a']!.name).toBe('Second')
    store.undo()
    expect(store.document.glasses['a']!.name).toBe('First')
  })

  it('removes a glass and undo re-adds it', () => {
    const store = new DocumentStore()
    store.execute(upsertGlass(glass({ id: 'a' })))
    store.execute(removeGlass('a'))
    expect(store.document.glasses['a']).toBeUndefined()
    store.undo()
    expect(store.document.glasses['a']!.name).toBe('Ruby cathedral')
  })

  it('removing an absent glass throws', () => {
    const store = new DocumentStore()
    expect(() => store.execute(removeGlass('missing'))).toThrow(/does not exist/)
  })

  it('consumes glasses by value into a self-contained file (FR-1)', () => {
    const store = new DocumentStore()
    store.execute(
      upsertGlass(glass({ id: 'a', manufacturer: 'Aurora Glass', sku: 'AG-1101', pricePerM2: 96 })),
    )
    // The project serializes its own copy — no reference to any external library.
    const reloaded = deserialize(serialize(store.document))
    expect(reloaded.glasses['a']).toEqual(store.document.glasses['a'])
  })
})

describe('empty project has no glasses', () => {
  it('starts with an empty catalog', () => {
    expect(createEmptyProject().glasses).toEqual({})
  })
})
