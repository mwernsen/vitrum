import { describe, expect, it } from 'vitest'

import { updateBomSettings } from './commands'
import { serialize, deserialize } from './serialize'
import { DocumentStore } from './store'
import { defaultBomSettings } from './types'

/** BOM estimation-factor command (F-042 FR-5): a shallow patch, each edit one reversible undo entry. */
describe('updateBomSettings', () => {
  it('starts from the shipped defaults', () => {
    const store = new DocumentStore()
    expect(store.document.bom).toEqual({
      glassWaste: 0.3,
      leadWaste: 0.1,
      solderGramsPerMetre: 20,
      foilRollLengthMm: 33_000,
    })
    expect(store.document.bom).toEqual(defaultBomSettings())
  })

  it('patches only the given fields and is one undo entry', () => {
    const store = new DocumentStore()
    store.execute(updateBomSettings({ glassWaste: 0.5 }))
    expect(store.document.bom.glassWaste).toBe(0.5)
    // Untouched fields keep their defaults.
    expect(store.document.bom.leadWaste).toBe(0.1)
    expect(store.document.bom.foilRollLengthMm).toBe(33_000)

    store.undo()
    expect(store.document.bom.glassWaste).toBe(0.3)
    store.redo()
    expect(store.document.bom.glassWaste).toBe(0.5)
  })

  it('restores exactly the fields a multi-field patch touched on undo', () => {
    const store = new DocumentStore()
    store.execute(updateBomSettings({ solderGramsPerMetre: 25, foilRollLengthMm: 30_000 }))
    expect(store.document.bom.solderGramsPerMetre).toBe(25)
    expect(store.document.bom.foilRollLengthMm).toBe(30_000)
    store.undo()
    expect(store.document.bom.solderGramsPerMetre).toBe(20)
    expect(store.document.bom.foilRollLengthMm).toBe(33_000)
  })

  it('round-trips through serialize/deserialize', () => {
    const store = new DocumentStore()
    store.execute(updateBomSettings({ glassWaste: 0.42, leadWaste: 0.12 }))
    const back = deserialize(serialize(store.document))
    expect(back.bom.glassWaste).toBe(0.42)
    expect(back.bom.leadWaste).toBe(0.12)
  })
})
