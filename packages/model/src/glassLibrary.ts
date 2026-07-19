import { cloneGlass, starterGlasses } from './glass'
import type { Glass, GlassId } from './types'

/**
 * The global glass library (F-022): the user's cross-project catalog, persisted outside any
 * document in the app-data directory (see {@link GlassLibraryPort}). It is deliberately *not*
 * part of the undo/command model — it is app-level state, edited through the pure operations
 * below and mirrored into runes by the UI's `GlassLibraryController`. Projects consume glasses
 * from it *by value* (a full copy into `Project.glasses`), so a shared `.vitrum` file needs no
 * access to the author's library (FR-1).
 *
 * On first run the library seeds from a fresh copy of the shipped starter catalog; the shipped
 * data is frozen and never mutated (FR-2, copy-on-write). Every operation returns a new library
 * value with structural sharing, so callers can diff and persist cheaply.
 */
export const GLASS_LIBRARY_VERSION = 1

/** The persisted, deeply-readonly library. Keyed by glass id, like `Project.glasses`. */
export interface GlassLibrary {
  readonly version: number
  readonly glasses: Readonly<Record<GlassId, Glass>>
}

/** A fresh library seeded from the starter catalog (FR-2). New glass objects, nothing shared. */
export function createStarterLibrary(): GlassLibrary {
  const glasses: Record<GlassId, Glass> = {}
  for (const g of starterGlasses()) glasses[g.id] = g
  return { version: GLASS_LIBRARY_VERSION, glasses }
}

/** An empty library (no starter glasses) — used when a user clears their catalog. */
export function emptyLibrary(): GlassLibrary {
  return { version: GLASS_LIBRARY_VERSION, glasses: {} }
}

/** The library's glasses as an array, in insertion order. */
export function libraryGlasses(library: GlassLibrary): Glass[] {
  return Object.values(library.glasses)
}

/** Add a glass, or replace an existing one with the same id. Returns a new library. */
export function upsertGlassInLibrary(library: GlassLibrary, glass: Glass): GlassLibrary {
  return { ...library, glasses: { ...library.glasses, [glass.id]: cloneGlass(glass) } }
}

/** Remove a glass by id. A no-op (fresh value) if it is absent. */
export function removeGlassFromLibrary(library: GlassLibrary, id: GlassId): GlassLibrary {
  if (!(id in library.glasses)) return library
  const glasses = { ...library.glasses }
  delete glasses[id]
  return { ...library, glasses }
}

/**
 * Duplicate a glass under a fresh id (minted by the caller so this stays pure), appending
 * " copy" to its name. Returns the new library and the created glass, or null if the source is
 * absent.
 */
export function duplicateGlassInLibrary(
  library: GlassLibrary,
  id: GlassId,
  newId: GlassId,
): { library: GlassLibrary; glass: Glass } | null {
  const source = library.glasses[id]
  if (!source) return null
  const copy: Glass = { ...cloneGlass(source), id: newId, name: `${source.name} copy` }
  return { library: { ...library, glasses: { ...library.glasses, [newId]: copy } }, glass: copy }
}

/**
 * Merge an imported library into a base one: incoming glasses overwrite same-id entries and add
 * new ones (last-writer-wins by id). Used by library import (FR-4). Returns a new library at the
 * current version.
 */
export function mergeLibrary(base: GlassLibrary, incoming: GlassLibrary): GlassLibrary {
  const glasses: Record<GlassId, Glass> = { ...base.glasses }
  for (const g of Object.values(incoming.glasses)) glasses[g.id] = cloneGlass(g)
  return { version: GLASS_LIBRARY_VERSION, glasses }
}

/* -------------------------------------------------------------------------- */
/* Serialization (FR-4)                                                         */
/* -------------------------------------------------------------------------- */

/** Thrown when a library file was written by a newer Vitrum than this build understands. */
export class GlassLibraryVersionError extends Error {
  constructor(readonly fileVersion: number) {
    super(
      `This glass library uses version ${fileVersion}, but this build understands up to ` +
        `${GLASS_LIBRARY_VERSION}. Update Vitrum to import it.`,
    )
    this.name = 'GlassLibraryVersionError'
  }
}

/** Serialize a library to a stable, pretty JSON string for persistence and export. */
export function serializeLibrary(library: GlassLibrary): string {
  return JSON.stringify({ version: library.version, glasses: library.glasses }, null, 2)
}

/**
 * Parse a library JSON string, validating each glass and rejecting a newer version (FR-4). Unknown
 * or malformed glass entries are dropped rather than corrupting the catalog; the import→export
 * round-trip of a well-formed library is lossless.
 */
export function deserializeLibrary(text: string): GlassLibrary {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error('Not a valid glass library: the contents are not valid JSON.', { cause })
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Not a valid glass library: expected an object.')
  }
  const record = parsed as { version?: unknown; glasses?: unknown }
  const version = typeof record.version === 'number' ? record.version : GLASS_LIBRARY_VERSION
  if (version > GLASS_LIBRARY_VERSION) throw new GlassLibraryVersionError(version)

  const rawGlasses = record.glasses
  const source: unknown[] = Array.isArray(rawGlasses)
    ? rawGlasses
    : typeof rawGlasses === 'object' && rawGlasses !== null
      ? Object.values(rawGlasses)
      : []

  const glasses: Record<GlassId, Glass> = {}
  for (const candidate of source) {
    const glass = normalizeGlass(candidate)
    if (glass) glasses[glass.id] = glass
  }
  return { version: GLASS_LIBRARY_VERSION, glasses }
}

const VALID_TRANSPARENCY = new Set(['transparent', 'translucent', 'opalescent', 'opaque'])
const VALID_TEXTURE = new Set(['smooth', 'hammered', 'seedy', 'streaky', 'ripple', 'granite'])

/** Validate/coerce a parsed value into a `Glass`, or null if it is unusable (missing id/name). */
function normalizeGlass(value: unknown): Glass | null {
  if (typeof value !== 'object' || value === null) return null
  const g = value as Record<string, unknown>
  if (typeof g['id'] !== 'string' || typeof g['name'] !== 'string') return null
  const color = typeof g['color'] === 'string' ? g['color'] : '#cccccc'
  const transparency = VALID_TRANSPARENCY.has(g['transparency'] as string)
    ? (g['transparency'] as Glass['transparency'])
    : 'transparent'
  const texture = VALID_TEXTURE.has(g['texture'] as string)
    ? (g['texture'] as Glass['texture'])
    : 'smooth'
  const thicknessMm = typeof g['thicknessMm'] === 'number' ? g['thicknessMm'] : 3
  const glass: Glass = {
    id: g['id'],
    name: g['name'],
    color,
    transparency,
    texture,
    thicknessMm,
    ...(typeof g['manufacturer'] === 'string' ? { manufacturer: g['manufacturer'] } : {}),
    ...(typeof g['sku'] === 'string' ? { sku: g['sku'] } : {}),
    ...(typeof g['pricePerM2'] === 'number' ? { pricePerM2: g['pricePerM2'] } : {}),
    ...(Array.isArray(g['sheetSizes']) ? { sheetSizes: normalizeSheets(g['sheetSizes']) } : {}),
    ...(typeof g['swatch'] === 'string' ? { swatch: g['swatch'] } : {}),
  }
  return glass
}

function normalizeSheets(value: unknown[]): Glass['sheetSizes'] {
  const sheets = value
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .filter((s) => typeof s['widthMm'] === 'number' && typeof s['heightMm'] === 'number')
    .map((s) => ({
      widthMm: s['widthMm'] as number,
      heightMm: s['heightMm'] as number,
      ...(typeof s['label'] === 'string' ? { label: s['label'] } : {}),
    }))
  return sheets
}

/* -------------------------------------------------------------------------- */
/* Persistence port                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How the global library reaches persistent storage and JSON files. On the desktop it is backed by
 * a file in the Electron app-data directory (`userData`) plus native import/export dialogs; in a
 * plain browser (`pnpm dev:ui`) and in tests it is stubbed (localStorage / in-memory). Keeping it
 * behind this interface is what lets `packages/ui` stay Electron-free — the same split F-002 uses
 * for `StoragePort`.
 */
export interface GlassLibraryPort {
  /** Read the persisted library JSON, or null if none has been saved yet (first run). */
  load(): Promise<string | null>
  /** Persist the library JSON (called after every edit). */
  save(contents: string): Promise<void>
  /** Show a save dialog and export the library JSON. Resolves to the path, or null if cancelled. */
  exportLibrary(suggestedName: string, contents: string): Promise<string | null>
  /** Show an open dialog and read a library JSON file. Resolves to null if cancelled. */
  importLibrary(): Promise<string | null>
}
