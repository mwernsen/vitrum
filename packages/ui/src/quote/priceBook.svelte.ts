import {
  defaultPriceBook,
  deserializePriceBook,
  serializePriceBook,
  type PriceBook,
  type PriceBookPort,
} from '@vitrum/model'

/**
 * The reactive bridge to the global workshop price book (F-056). Like the glass library (F-022) it is
 * app-level state, not part of the document/undo model: a project carries its own price book by value
 * in `Project.quote.priceBook`, and this controller lets the user (a) seed a project from their saved
 * workshop default and (b) save the current project's price book as that default. Persisted through a
 * {@link PriceBookPort} (a `userData` file on the desktop, `localStorage` in the browser, in-memory in
 * tests). Without a port the shipped default is used for the session only.
 */
export class PriceBookController {
  readonly #port: PriceBookPort | undefined

  /** The saved workshop-default price book (or the shipped default until one is loaded). */
  defaultBook = $state<PriceBook>(defaultPriceBook())
  /** True once the persisted default has been loaded (or the shipped default adopted). */
  loaded = $state(false)

  constructor(port?: PriceBookPort) {
    this.#port = port
  }

  /** Load the persisted workshop default, or adopt the shipped default on first run. */
  init = async (): Promise<void> => {
    if (!this.#port) {
      this.loaded = true
      return
    }
    const raw = await this.#port.load()
    if (raw) {
      try {
        this.defaultBook = deserializePriceBook(raw)
      } catch {
        this.defaultBook = defaultPriceBook()
      }
    }
    this.loaded = true
  }

  /** Save a price book as the workshop default, then persist. */
  saveDefault = async (book: PriceBook): Promise<void> => {
    this.defaultBook = book
    await this.#port?.save(serializePriceBook(book))
  }
}
