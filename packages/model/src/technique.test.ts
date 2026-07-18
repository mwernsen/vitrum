import { line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import {
  removeCameProfile,
  setCameOverride,
  setTechniqueKind,
  updateFoilSettings,
  updateLeadSettings,
  upsertCameProfile,
} from './commands'
import { createSegment } from './factory'
import { DocumentStore } from './store'
import { defaultTechnique, SEED_CAME_PROFILES, seedCameLibrary } from './technique'
import { createEmptyProject } from './types'

describe('default technique (FR-5)', () => {
  it('ships lead H 5 mm / 1.5 mm heart and 7/32" foil defaults', () => {
    const t = createEmptyProject().technique
    expect(t.kind).toBe('lead')
    expect(t.lead.defaultProfileId).toBe('came-h-5')
    expect(t.lead.profiles['came-h-5']).toMatchObject({ flangeMm: 5, heartMm: 1.5, kind: 'H' })
    expect(t.foil.foilWidthMm).toBeCloseTo(5.6) // 7/32"
    expect(t.foil.pieceGapMm).toBeCloseTo(0.8)
  })

  it('seeds a fresh, independent came library each time', () => {
    const a = seedCameLibrary()
    const b = seedCameLibrary()
    expect(Object.keys(a)).toHaveLength(SEED_CAME_PROFILES.length)
    expect(a['came-h-5']).not.toBe(b['came-h-5']) // distinct objects, not shared
  })

  it('every new project owns its own came library instance', () => {
    expect(createEmptyProject().technique.lead.profiles).not.toBe(
      createEmptyProject().technique.lead.profiles,
    )
  })
})

describe('technique commands (undo/redo, FR-4)', () => {
  it('switches lead⇄foil as one undo step, preserving both parameter blocks', () => {
    const store = new DocumentStore()
    const leadBefore = store.document.technique.lead
    store.execute(setTechniqueKind('foil'))
    expect(store.document.technique.kind).toBe('foil')
    expect(store.document.technique.lead).toEqual(leadBefore) // lead params preserved

    store.undo()
    expect(store.document.technique.kind).toBe('lead')
    store.redo()
    expect(store.document.technique.kind).toBe('foil')
  })

  it('sets and clears a per-segment came override reversibly', () => {
    const store = new DocumentStore()
    const seg = createSegment(line(vec2(0, 0), vec2(100, 0)))
    store.load({ ...createEmptyProject(), segments: { [seg.id]: seg }, nodes: {} })

    store.execute(setCameOverride(seg.id, { profileId: 'came-h-9' }))
    expect(store.document.technique.lead.overrides[seg.id]).toEqual({ profileId: 'came-h-9' })

    store.execute(setCameOverride(seg.id, null))
    expect(store.document.technique.lead.overrides[seg.id]).toBeUndefined()

    store.undo() // restores the override
    expect(store.document.technique.lead.overrides[seg.id]).toEqual({ profileId: 'came-h-9' })
    store.undo() // removes it again
    expect(store.document.technique.lead.overrides[seg.id]).toBeUndefined()
  })

  it('treats an empty override as a clear', () => {
    const store = new DocumentStore()
    store.execute(setCameOverride('s0', { profileId: 'x' }))
    store.execute(setCameOverride('s0', {}))
    expect(store.document.technique.lead.overrides['s0']).toBeUndefined()
  })

  it('adds, replaces and removes came profiles', () => {
    const store = new DocumentStore()
    const profile = {
      id: 'came-custom',
      name: 'Custom 3 mm',
      kind: 'H' as const,
      flangeMm: 3,
      heartMm: 1.2,
    }
    store.execute(upsertCameProfile(profile))
    expect(store.document.technique.lead.profiles['came-custom']).toEqual(profile)

    store.execute(removeCameProfile('came-custom'))
    expect(store.document.technique.lead.profiles['came-custom']).toBeUndefined()

    store.undo()
    expect(store.document.technique.lead.profiles['came-custom']).toEqual(profile)
  })

  it('refuses to remove the default profile', () => {
    const store = new DocumentStore()
    expect(() => store.execute(removeCameProfile('came-h-5'))).toThrow(/default profile/)
  })

  it('patches lead and foil parameters reversibly', () => {
    const store = new DocumentStore()
    store.execute(updateLeadSettings({ cuttingToleranceMm: 0.3 }))
    expect(store.document.technique.lead.cuttingToleranceMm).toBe(0.3)
    store.execute(updateFoilSettings({ solderFinish: 'black' }))
    expect(store.document.technique.foil.solderFinish).toBe('black')

    store.undo()
    expect(store.document.technique.foil.solderFinish).toBe('silver')
    store.undo()
    expect(store.document.technique.lead.cuttingToleranceMm).toBe(0)
  })
})

describe('defaultTechnique shape', () => {
  it('always carries both a lead and a foil block', () => {
    const t = defaultTechnique()
    expect(t.lead).toBeDefined()
    expect(t.foil).toBeDefined()
  })
})
