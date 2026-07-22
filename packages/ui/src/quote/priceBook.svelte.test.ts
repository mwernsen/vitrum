import { defaultPriceBook, serializePriceBook, type PriceBookPort } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { PriceBookController } from './priceBook.svelte'

function fakePort(initial: string | null = null): PriceBookPort & { store: string | null } {
  return {
    store: initial,
    async load() {
      return this.store
    },
    async save(contents: string) {
      this.store = contents
    },
  }
}

describe('PriceBookController (F-056)', () => {
  it('adopts the shipped default on first run', async () => {
    const port = fakePort(null)
    const ctl = new PriceBookController(port)
    await ctl.init()
    expect(ctl.loaded).toBe(true)
    expect(ctl.defaultBook).toEqual(defaultPriceBook())
  })

  it('loads a persisted workshop default', async () => {
    const book = { ...defaultPriceBook(), leadPerMetre: 9.9 }
    const ctl = new PriceBookController(fakePort(serializePriceBook(book)))
    await ctl.init()
    expect(ctl.defaultBook.leadPerMetre).toBe(9.9)
  })

  it('falls back to the shipped default on a corrupt file', async () => {
    const ctl = new PriceBookController(fakePort('{ not json'))
    await ctl.init()
    expect(ctl.defaultBook).toEqual(defaultPriceBook())
  })

  it('persists when saving a book as the workshop default', async () => {
    const port = fakePort(null)
    const ctl = new PriceBookController(port)
    const book = { ...defaultPriceBook(), foilPerMetre: 2.5 }
    await ctl.saveDefault(book)
    expect(ctl.defaultBook.foilPerMetre).toBe(2.5)
    expect(port.store).toContain('2.5')
  })

  it('works without a port (session-only default)', async () => {
    const ctl = new PriceBookController()
    await ctl.init()
    expect(ctl.loaded).toBe(true)
    expect(ctl.defaultBook).toEqual(defaultPriceBook())
  })
})
