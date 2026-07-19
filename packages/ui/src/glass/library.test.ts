import {
  createStarterLibrary,
  serializeLibrary,
  STARTER_GLASSES,
  upsertGlassInLibrary,
  type Glass,
} from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { createFakeHost } from '../document/fakeHost'

import { GlassLibraryController } from './library.svelte'

const glass = (over: Partial<Glass> & { id: string }): Glass => ({
  name: 'Test',
  color: '#3a7bd5',
  transparency: 'transparent',
  texture: 'smooth',
  thicknessMm: 3,
  ...over,
})

describe('GlassLibraryController (F-022)', () => {
  it('seeds and persists the starter catalog on first run (FR-2)', async () => {
    const host = createFakeHost()
    const ctrl = new GlassLibraryController(host.glassLibrary)
    await ctrl.init()
    expect(ctrl.loaded).toBe(true)
    expect(ctrl.glasses).toHaveLength(STARTER_GLASSES.length)
    // Persisted so the next launch reloads it rather than re-seeding.
    expect(host.glassLibraryStore).not.toBeNull()
  })

  it('loads a previously persisted library instead of re-seeding', async () => {
    const host = createFakeHost()
    const saved = upsertGlassInLibrary(createStarterLibrary(), glass({ id: 'mine', name: 'Mine' }))
    host.glassLibraryStore = serializeLibrary(saved)
    const ctrl = new GlassLibraryController(host.glassLibrary)
    await ctrl.init()
    expect(ctrl.glasses.some((g) => g.id === 'mine')).toBe(true)
  })

  it('falls back to the starter catalog on a corrupt persisted library', async () => {
    const host = createFakeHost()
    host.glassLibraryStore = 'not json {'
    const ctrl = new GlassLibraryController(host.glassLibrary)
    await ctrl.init()
    expect(ctrl.glasses).toHaveLength(STARTER_GLASSES.length)
  })

  it('upsert / remove / duplicate mutate and persist', async () => {
    const host = createFakeHost()
    const ctrl = new GlassLibraryController(host.glassLibrary)
    await ctrl.init()

    await ctrl.upsert(glass({ id: 'a', name: 'Alpha' }))
    expect(ctrl.glasses.find((g) => g.id === 'a')?.name).toBe('Alpha')

    const dup = await ctrl.duplicate('a')
    expect(dup?.name).toBe('Alpha copy')
    expect(ctrl.glasses.filter((g) => g.name.startsWith('Alpha'))).toHaveLength(2)

    await ctrl.remove('a')
    expect(ctrl.glasses.find((g) => g.id === 'a')).toBeUndefined()

    // The last persisted snapshot reflects the removal.
    expect(host.glassLibraryStore).toContain('Alpha copy')
    expect(host.glassLibraryStore).not.toContain('"id": "a"')
  })

  it('exports the library through the port', async () => {
    const host = createFakeHost()
    const ctrl = new GlassLibraryController(host.glassLibrary)
    await ctrl.init()
    await ctrl.exportLibrary()
    expect(host.lastExportedLibrary).not.toBeNull()
    expect(host.lastExportedLibrary).toContain('glasses')
  })

  it('imports a library file and merges it (FR-4)', async () => {
    const host = createFakeHost()
    const ctrl = new GlassLibraryController(host.glassLibrary)
    await ctrl.init()
    const incoming = upsertGlassInLibrary(
      { version: 1, glasses: {} },
      glass({ id: 'imported', name: 'Imported' }),
    )
    host.nextImportLibrary = serializeLibrary(incoming)
    const count = await ctrl.importLibrary()
    expect(count).toBe(1)
    expect(ctrl.glasses.some((g) => g.id === 'imported')).toBe(true)
  })

  it('works without a port (in-memory session library)', async () => {
    const ctrl = new GlassLibraryController(undefined)
    await ctrl.init()
    expect(ctrl.glasses).toHaveLength(STARTER_GLASSES.length)
    await ctrl.upsert(glass({ id: 'x', name: 'X' }))
    expect(ctrl.glasses.some((g) => g.id === 'x')).toBe(true)
  })
})
