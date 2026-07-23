import { defaultPriceBook, type ConsumableLine, type PriceBook } from './types'

/**
 * The global workshop price book (F-056): the user's cross-project default came/foil/solder/
 * reinforcement unit prices and consumable lines, persisted outside any document in the app-data
 * directory (see {@link PriceBookPort}). Exactly like the global glass library (F-022), it is *not*
 * part of the undo/command model — a project consumes it *by value* into `Project.quote.priceBook`
 * (via the `updateQuoteSettings` command) so a shared `.vitrum` file quotes self-contained.
 *
 * These are pure serialization + validation helpers; the reactive bridge + persistence lives in the
 * UI's `PriceBookController` on top of a {@link PriceBookPort}.
 */
export const PRICE_BOOK_VERSION = 1

/** Thrown when a price-book file was written by a newer Vitrum than this build understands. */
export class PriceBookVersionError extends Error {
  constructor(readonly fileVersion: number) {
    super(
      `This price book uses version ${fileVersion}, but this build understands up to ` +
        `${PRICE_BOOK_VERSION}. Update Vitrum to import it.`,
    )
    this.name = 'PriceBookVersionError'
  }
}

/** Serialize a price book to a stable, pretty JSON string for persistence and export. */
export function serializePriceBook(book: PriceBook): string {
  return JSON.stringify({ version: PRICE_BOOK_VERSION, priceBook: book }, null, 2)
}

/**
 * Parse a price-book JSON string, validating each field and rejecting a newer version. Malformed or
 * missing numeric fields fall back to the shipped default rather than corrupting the book; the
 * import→export round-trip of a well-formed book is lossless.
 */
export function deserializePriceBook(text: string): PriceBook {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error('Not a valid price book: the contents are not valid JSON.', { cause })
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Not a valid price book: expected an object.')
  }
  const record = parsed as { version?: unknown; priceBook?: unknown }
  const version = typeof record.version === 'number' ? record.version : PRICE_BOOK_VERSION
  if (version > PRICE_BOOK_VERSION) throw new PriceBookVersionError(version)
  return normalizePriceBook(record.priceBook)
}

/** Validate/coerce a parsed value into a `PriceBook`, defaulting every missing/invalid field. */
export function normalizePriceBook(value: unknown): PriceBook {
  const base = defaultPriceBook()
  if (typeof value !== 'object' || value === null) return base
  const b = value as Record<string, unknown>
  const num = (key: string, fallback: number): number =>
    typeof b[key] === 'number' && Number.isFinite(b[key]) ? (b[key] as number) : fallback
  return {
    leadPerMetre: num('leadPerMetre', base.leadPerMetre),
    foilPerMetre: num('foilPerMetre', base.foilPerMetre),
    solderPerKg: num('solderPerKg', base.solderPerKg),
    reinforcementPerMetre: num('reinforcementPerMetre', base.reinforcementPerMetre),
    consumables: Array.isArray(b['consumables']) ? normalizeConsumables(b['consumables']) : [],
  }
}

function normalizeConsumables(value: unknown[]): ConsumableLine[] {
  return value
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .filter((c) => typeof c['id'] === 'string' && typeof c['name'] === 'string')
    .map((c) => ({
      id: c['id'] as string,
      name: c['name'] as string,
      cost: typeof c['cost'] === 'number' && Number.isFinite(c['cost']) ? (c['cost'] as number) : 0,
    }))
}

/**
 * How the global price book reaches persistent storage and JSON files. Backed by a file in the
 * Electron app-data directory (`userData`) on the desktop and stubbed (localStorage / in-memory)
 * elsewhere — the same split as {@link import('./glassLibrary').GlassLibraryPort}, so `packages/ui`
 * stays Electron-free.
 */
export interface PriceBookPort {
  /** Read the persisted price book JSON, or null if none has been saved yet (first run). */
  load(): Promise<string | null>
  /** Persist the price book JSON (called when the user saves the current book as their default). */
  save(contents: string): Promise<void>
}
