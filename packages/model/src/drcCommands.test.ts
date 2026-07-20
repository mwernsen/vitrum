import { describe, expect, it } from 'vitest'

import { setDrcExclusion, setDrcRuleOverride } from './commands'
import { DocumentStore } from './store'

describe('setDrcExclusion (waive a violation, F-030 FR-3)', () => {
  it('adds a waiver keyed by violation identity, and undo removes it', () => {
    const store = new DocumentStore()
    expect(store.document.drc.exclusions).toEqual({})

    store.execute(setDrcExclusion('near-miss-joint#s1|s2', { note: 'joined by foil, fine' }))
    expect(store.document.drc.exclusions['near-miss-joint#s1|s2']).toEqual({
      note: 'joined by foil, fine',
    })

    store.undo()
    expect(store.document.drc.exclusions).toEqual({})
  })

  it('removes a waiver with a null record, reversibly', () => {
    const store = new DocumentStore()
    store.execute(setDrcExclusion('dangling-line#s7', {}))
    store.execute(setDrcExclusion('dangling-line#s7', null))
    expect(store.document.drc.exclusions['dangling-line#s7']).toBeUndefined()

    store.undo()
    expect(store.document.drc.exclusions['dangling-line#s7']).toEqual({})
  })

  it('leaves the rest of the document untouched', () => {
    const store = new DocumentStore()
    const before = store.document
    store.execute(setDrcExclusion('open-border#n1', { note: 'intentional gap' }))
    expect(store.document.segments).toBe(before.segments)
    expect(store.document.assignments).toBe(before.assignments)
  })
})

describe('setDrcRuleOverride (per-project rule config, F-030 FR-4)', () => {
  it('sets a severity/enabled override, and undo restores the default', () => {
    const store = new DocumentStore()
    store.execute(setDrcRuleOverride('orphan-region', { severity: 'warning', enabled: false }))
    expect(store.document.drc.rules['orphan-region']).toEqual({
      severity: 'warning',
      enabled: false,
    })

    store.undo()
    expect(store.document.drc.rules).toEqual({})
  })

  it('replaces an existing override and inverts to the previous value', () => {
    const store = new DocumentStore()
    store.execute(setDrcRuleOverride('near-miss-joint', { severity: 'warning' }))
    store.execute(setDrcRuleOverride('near-miss-joint', { enabled: false }))
    expect(store.document.drc.rules['near-miss-joint']).toEqual({ enabled: false })

    store.undo()
    expect(store.document.drc.rules['near-miss-joint']).toEqual({ severity: 'warning' })
  })

  it('clears an override with null', () => {
    const store = new DocumentStore()
    store.execute(setDrcRuleOverride('unassigned-glass', { severity: 'error' }))
    store.execute(setDrcRuleOverride('unassigned-glass', null))
    expect(store.document.drc.rules['unassigned-glass']).toBeUndefined()
  })

  it('persists per-rule thresholds (F-031) and undo restores the prior value', () => {
    const store = new DocumentStore()
    store.execute(setDrcRuleOverride('min-piece-size', { thresholds: { minDimensionMm: 12 } }))
    expect(store.document.drc.rules['min-piece-size']).toEqual({
      thresholds: { minDimensionMm: 12 },
    })

    // Overrides replace wholesale, so severity + thresholds together is one record.
    store.execute(
      setDrcRuleOverride('min-piece-size', {
        severity: 'error',
        thresholds: { minDimensionMm: 14 },
      }),
    )
    expect(store.document.drc.rules['min-piece-size']).toEqual({
      severity: 'error',
      thresholds: { minDimensionMm: 14 },
    })

    store.undo()
    expect(store.document.drc.rules['min-piece-size']).toEqual({
      thresholds: { minDimensionMm: 12 },
    })
  })
})
