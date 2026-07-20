import { describe, expect, it } from 'vitest'

import { addReinforcement, removeReinforcement, updateReinforcement } from './commands'
import { DocumentStore } from './store'
import type { ReinforcementBar } from './types'

/** Reinforcement-bar commands (F-032): add / move / delete, each a single reversible undo entry. */
const bar = (over: Partial<ReinforcementBar> = {}): ReinforcementBar => ({
  id: 'r1',
  a: { x: 0, y: 0 },
  b: { x: 400, y: 0 },
  widthMm: 6,
  material: 'zinc',
  ...over,
})

describe('addReinforcement', () => {
  it('adds a bar and is one undo entry', () => {
    const store = new DocumentStore()
    store.execute(addReinforcement(bar()))
    expect(store.document.reinforcements).toHaveLength(1)
    expect(store.document.reinforcements[0]!.material).toBe('zinc')

    store.undo()
    expect(store.document.reinforcements).toHaveLength(0)
    store.redo()
    expect(store.document.reinforcements).toHaveLength(1)
  })

  it('rejects a duplicate id', () => {
    const store = new DocumentStore()
    store.execute(addReinforcement(bar()))
    expect(() => store.execute(addReinforcement(bar()))).toThrow(/already exists/)
  })
})

describe('updateReinforcement', () => {
  it('replaces a bar and restores the prior on undo', () => {
    const store = new DocumentStore()
    store.execute(addReinforcement(bar()))
    store.execute(updateReinforcement(bar({ b: { x: 300, y: 120 }, widthMm: 9 })))
    expect(store.document.reinforcements[0]!.b).toEqual({ x: 300, y: 120 })
    expect(store.document.reinforcements[0]!.widthMm).toBe(9)

    store.undo()
    expect(store.document.reinforcements[0]!.b).toEqual({ x: 400, y: 0 })
    expect(store.document.reinforcements[0]!.widthMm).toBe(6)
  })

  it('coalesces a drag of the same bar into one undo entry (merge)', () => {
    const store = new DocumentStore()
    store.execute(addReinforcement(bar()))
    // Simulate a live endpoint drag: many updates, same id, one interaction.
    for (let x = 100; x <= 300; x += 100) {
      store.execute(updateReinforcement(bar({ b: { x, y: 200 } })), { coalesceKey: 'drag-r1' })
    }
    expect(store.document.reinforcements[0]!.b).toEqual({ x: 300, y: 200 })
    // One undo returns to the bar as first added, not to an intermediate drag position.
    store.undo()
    expect(store.document.reinforcements[0]!.b).toEqual({ x: 400, y: 0 })
  })

  it('throws when the bar does not exist', () => {
    const store = new DocumentStore()
    expect(() => store.execute(updateReinforcement(bar()))).toThrow(/does not exist/)
  })
})

describe('removeReinforcement', () => {
  it('removes a bar and re-adds it exactly on undo', () => {
    const store = new DocumentStore()
    store.execute(addReinforcement(bar({ material: 'steel' })))
    store.execute(removeReinforcement('r1'))
    expect(store.document.reinforcements).toHaveLength(0)

    store.undo()
    expect(store.document.reinforcements).toHaveLength(1)
    expect(store.document.reinforcements[0]!.material).toBe('steel')
  })
})
