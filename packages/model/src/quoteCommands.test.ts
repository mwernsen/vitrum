import { describe, expect, it } from 'vitest'

import { newQuoteLineId } from './ids'
import { updateQuoteSettings } from './commands'
import { serialize, deserialize } from './serialize'
import { DocumentStore } from './store'
import { defaultQuoteSettings } from './types'

/** Cost-estimation / quoting intent command (F-056 FR-2): a shallow patch, each edit one undo entry. */
describe('updateQuoteSettings', () => {
  it('starts from the shipped defaults', () => {
    const store = new DocumentStore()
    expect(store.document.quote).toEqual(defaultQuoteSettings())
    expect(store.document.quote.currency).toEqual({ code: 'EUR', symbol: '€' })
    expect(store.document.quote.labor.hourlyRate).toBe(45)
  })

  it('patches only the given top-level fields and is one undo entry', () => {
    const store = new DocumentStore()
    store.execute(updateQuoteSettings({ overheadPct: 0.25 }))
    expect(store.document.quote.overheadPct).toBe(0.25)
    // Untouched fields keep their defaults.
    expect(store.document.quote.marginPct).toBe(0.3)
    expect(store.document.quote.labor.hourlyRate).toBe(45)

    store.undo()
    expect(store.document.quote.overheadPct).toBe(0.15)
    store.redo()
    expect(store.document.quote.overheadPct).toBe(0.25)
  })

  it('replaces a whole sub-object (labor) in one reversible edit', () => {
    const store = new DocumentStore()
    const labor = { ...store.document.quote.labor, hourlyRate: 60, foilPieceFactor: 1.8 }
    store.execute(updateQuoteSettings({ labor }))
    expect(store.document.quote.labor.hourlyRate).toBe(60)
    expect(store.document.quote.labor.foilPieceFactor).toBe(1.8)
    // Sibling labor fields carried through the replacement.
    expect(store.document.quote.labor.minutesPerPiece).toBe(12)
    store.undo()
    expect(store.document.quote.labor.hourlyRate).toBe(45)
    expect(store.document.quote.labor.foilPieceFactor).toBe(1.4)
  })

  it('adds and removes manual quote lines through the patch', () => {
    const store = new DocumentStore()
    const line = { id: newQuoteLineId(), description: 'Installation', amount: 150 }
    store.execute(updateQuoteSettings({ manualLines: [line] }))
    expect(store.document.quote.manualLines).toHaveLength(1)
    store.undo()
    expect(store.document.quote.manualLines).toEqual([])
  })

  it('restores exactly the fields a multi-field patch touched on undo', () => {
    const store = new DocumentStore()
    store.execute(updateQuoteSettings({ overheadPct: 0.2, marginPct: 0.4 }))
    store.undo()
    expect(store.document.quote.overheadPct).toBe(0.15)
    expect(store.document.quote.marginPct).toBe(0.3)
  })

  it('round-trips through serialize/deserialize', () => {
    const store = new DocumentStore()
    const priceBook = { ...store.document.quote.priceBook, leadPerMetre: 4.2 }
    store.execute(updateQuoteSettings({ priceBook, marginPct: 0.35 }))
    const back = deserialize(serialize(store.document))
    expect(back.quote.priceBook.leadPerMetre).toBe(4.2)
    expect(back.quote.marginPct).toBe(0.35)
  })
})
