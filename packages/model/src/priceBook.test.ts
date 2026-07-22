import { describe, expect, it } from 'vitest'

import {
  deserializePriceBook,
  normalizePriceBook,
  PRICE_BOOK_VERSION,
  PriceBookVersionError,
  serializePriceBook,
} from './priceBook'
import { defaultPriceBook } from './types'

/** Global workshop price book serialization (F-056), mirroring the glass-library helpers (F-022). */
describe('price book serialization', () => {
  it('round-trips a well-formed book losslessly', () => {
    const book = {
      ...defaultPriceBook(),
      leadPerMetre: 4.2,
      consumables: [{ id: 'con-1', name: 'Flux & patina', cost: 6 }],
    }
    const back = deserializePriceBook(serializePriceBook(book))
    expect(back).toEqual(book)
  })

  it('embeds the current version in the serialized envelope', () => {
    const parsed = JSON.parse(serializePriceBook(defaultPriceBook())) as { version: number }
    expect(parsed.version).toBe(PRICE_BOOK_VERSION)
  })

  it('defaults missing / invalid numeric fields rather than corrupting the book', () => {
    const book = normalizePriceBook({ leadPerMetre: 'nope', foilPerMetre: 2 })
    expect(book.leadPerMetre).toBe(defaultPriceBook().leadPerMetre)
    expect(book.foilPerMetre).toBe(2)
    expect(book.consumables).toEqual([])
  })

  it('drops malformed consumable entries', () => {
    const book = normalizePriceBook({
      consumables: [
        { id: 'con-1', name: 'Ok', cost: 3 },
        { id: 'con-2' }, // missing name → dropped
        { name: 'no id' }, // missing id → dropped
      ],
    })
    expect(book.consumables).toEqual([{ id: 'con-1', name: 'Ok', cost: 3 }])
  })

  it('rejects a newer file version', () => {
    const text = JSON.stringify({ version: PRICE_BOOK_VERSION + 1, priceBook: defaultPriceBook() })
    expect(() => deserializePriceBook(text)).toThrow(PriceBookVersionError)
  })

  it('throws a clear error on non-JSON', () => {
    expect(() => deserializePriceBook('{ not json')).toThrow(/not valid JSON/)
  })
})
