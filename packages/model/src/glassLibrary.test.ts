import { describe, expect, it } from 'vitest'

import { STARTER_GLASSES } from './glass'
import {
  createStarterLibrary,
  deserializeLibrary,
  duplicateGlassInLibrary,
  emptyLibrary,
  GLASS_LIBRARY_VERSION,
  GlassLibraryVersionError,
  libraryGlasses,
  mergeLibrary,
  removeGlassFromLibrary,
  serializeLibrary,
  upsertGlassInLibrary,
} from './glassLibrary'
import type { Glass } from './types'

const g = (over: Partial<Glass> & { id: string }): Glass => ({
  name: 'Test',
  color: '#3a7bd5',
  transparency: 'transparent',
  texture: 'smooth',
  thicknessMm: 3,
  ...over,
})

describe('starter library (FR-2)', () => {
  it('seeds from the starter catalog with fresh objects', () => {
    const lib = createStarterLibrary()
    expect(libraryGlasses(lib)).toHaveLength(STARTER_GLASSES.length)
    expect(lib.version).toBe(GLASS_LIBRARY_VERSION)
    // Editing the library never touches the shipped constant (copy-on-write).
    const first = STARTER_GLASSES[0]!
    const edited = upsertGlassInLibrary(lib, { ...first, name: 'Renamed' })
    expect(edited.glasses[first.id]!.name).toBe('Renamed')
    expect(STARTER_GLASSES[0]!.name).not.toBe('Renamed')
    expect(Object.isFrozen(STARTER_GLASSES[0])).toBe(true)
  })

  it('produces independent libraries each call', () => {
    const a = createStarterLibrary()
    const b = createStarterLibrary()
    const id = STARTER_GLASSES[0]!.id
    expect(a.glasses[id]).not.toBe(b.glasses[id])
  })
})

describe('pure library operations', () => {
  it('upsert adds and replaces by id, returning a new value', () => {
    const lib = emptyLibrary()
    const added = upsertGlassInLibrary(lib, g({ id: 'a', name: 'A' }))
    expect(libraryGlasses(added).map((x) => x.id)).toEqual(['a'])
    expect(added).not.toBe(lib)
    const replaced = upsertGlassInLibrary(added, g({ id: 'a', name: 'A2' }))
    expect(replaced.glasses['a']!.name).toBe('A2')
    expect(added.glasses['a']!.name).toBe('A') // original untouched
  })

  it('upsert stores a copy so later external mutation cannot leak in', () => {
    const source = g({ id: 'a', name: 'A' })
    const lib = upsertGlassInLibrary(emptyLibrary(), source)
    ;(source as { name: string }).name = 'mutated'
    expect(lib.glasses['a']!.name).toBe('A')
  })

  it('remove deletes by id and is a no-op when absent', () => {
    const lib = upsertGlassInLibrary(emptyLibrary(), g({ id: 'a' }))
    expect(libraryGlasses(removeGlassFromLibrary(lib, 'a'))).toHaveLength(0)
    expect(removeGlassFromLibrary(lib, 'missing')).toBe(lib)
  })

  it('duplicate mints a new id and appends " copy"', () => {
    const lib = upsertGlassInLibrary(emptyLibrary(), g({ id: 'a', name: 'Ruby' }))
    const result = duplicateGlassInLibrary(lib, 'a', 'a-2')!
    expect(result.glass.id).toBe('a-2')
    expect(result.glass.name).toBe('Ruby copy')
    expect(libraryGlasses(result.library).map((x) => x.id)).toEqual(['a', 'a-2'])
    expect(duplicateGlassInLibrary(lib, 'missing', 'x')).toBeNull()
  })
})

describe('serialize / import round-trip (FR-4)', () => {
  it('round-trips a library losslessly', () => {
    let lib = createStarterLibrary()
    lib = upsertGlassInLibrary(
      lib,
      g({
        id: 'custom',
        name: 'My glass',
        manufacturer: 'Home',
        sku: 'H-1',
        pricePerM2: 42,
        sheetSizes: [{ widthMm: 300, heightMm: 300, label: 'sample' }],
        swatch: 'data:image/png;base64,AAAA',
      }),
    )
    const reloaded = deserializeLibrary(serializeLibrary(lib))
    expect(reloaded).toEqual(lib)
  })

  it('rejects a newer library version', () => {
    const future = JSON.stringify({ version: GLASS_LIBRARY_VERSION + 1, glasses: {} })
    expect(() => deserializeLibrary(future)).toThrow(GlassLibraryVersionError)
  })

  it('drops malformed entries but keeps valid ones', () => {
    const text = JSON.stringify({
      version: 1,
      glasses: {
        good: g({ id: 'good', name: 'Good' }),
        bad: { name: 'no id' },
      },
    })
    const lib = deserializeLibrary(text)
    expect(libraryGlasses(lib).map((x) => x.id)).toEqual(['good'])
  })

  it('fills defaults for missing optional-but-required fields on import', () => {
    const text = JSON.stringify({
      version: 1,
      glasses: [{ id: 'x', name: 'Minimal' }],
    })
    const lib = deserializeLibrary(text)
    expect(lib.glasses['x']).toMatchObject({
      id: 'x',
      name: 'Minimal',
      color: expect.any(String),
      transparency: 'transparent',
      texture: 'smooth',
      thicknessMm: 3,
    })
  })

  it('throws on invalid JSON', () => {
    expect(() => deserializeLibrary('not json {')).toThrow(/not valid JSON/)
  })

  it('merges an imported library (incoming wins by id)', () => {
    const base = upsertGlassInLibrary(emptyLibrary(), g({ id: 'a', name: 'Base A' }))
    const incoming = upsertGlassInLibrary(
      upsertGlassInLibrary(emptyLibrary(), g({ id: 'a', name: 'New A' })),
      g({ id: 'b', name: 'B' }),
    )
    const merged = mergeLibrary(base, incoming)
    expect(merged.glasses['a']!.name).toBe('New A')
    expect(
      libraryGlasses(merged)
        .map((x) => x.id)
        .sort(),
    ).toEqual(['a', 'b'])
  })
})
