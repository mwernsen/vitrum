import { describe, expect, it } from 'vitest'

import { setGlassAssignments } from './commands'
import { serialize, deserialize } from './serialize'
import { DocumentStore } from './store'
import { createEmptyProject } from './types'

describe('glass assignment command (F-023 FR-1)', () => {
  it('assigns glass to a piece', () => {
    const store = new DocumentStore()
    store.execute(setGlassAssignments({ 'p-a': 'glass-1' }))
    expect(store.document.assignments['p-a']).toBe('glass-1')
  })

  it('bulk-assigns many pieces in one undo step', () => {
    const store = new DocumentStore()
    store.execute(setGlassAssignments({ 'p-a': 'glass-1', 'p-b': 'glass-1', 'p-c': 'glass-2' }))
    expect(store.document.assignments).toEqual({
      'p-a': 'glass-1',
      'p-b': 'glass-1',
      'p-c': 'glass-2',
    })
    store.undo()
    expect(store.document.assignments).toEqual({})
  })

  it('re-assigning a piece is one undo step and restores the prior glass', () => {
    const store = new DocumentStore()
    store.execute(setGlassAssignments({ 'p-a': 'glass-1' }))
    store.execute(setGlassAssignments({ 'p-a': 'glass-2' }))
    expect(store.document.assignments['p-a']).toBe('glass-2')
    store.undo()
    expect(store.document.assignments['p-a']).toBe('glass-1')
    store.redo()
    expect(store.document.assignments['p-a']).toBe('glass-2')
  })

  it('unassigns via a null patch and undo restores it', () => {
    const store = new DocumentStore()
    store.execute(setGlassAssignments({ 'p-a': 'glass-1', 'p-b': 'glass-2' }))
    store.execute(setGlassAssignments({ 'p-a': null }))
    expect(store.document.assignments).toEqual({ 'p-b': 'glass-2' })
    store.undo()
    expect(store.document.assignments).toEqual({ 'p-a': 'glass-1', 'p-b': 'glass-2' })
  })

  it('a mixed set/clear patch inverts exactly', () => {
    const store = new DocumentStore()
    store.execute(setGlassAssignments({ 'p-a': 'glass-1', 'p-b': 'glass-2' }))
    // Re-key p-a, clear p-b, add p-c — the save-time normalisation shape.
    store.execute(setGlassAssignments({ 'p-a': 'glass-9', 'p-b': null, 'p-c': 'glass-3' }))
    expect(store.document.assignments).toEqual({ 'p-a': 'glass-9', 'p-c': 'glass-3' })
    store.undo()
    expect(store.document.assignments).toEqual({ 'p-a': 'glass-1', 'p-b': 'glass-2' })
  })

  it('assignments are serialized with the project (FR-5)', () => {
    const store = new DocumentStore()
    store.execute(setGlassAssignments({ 'p-a': 'glass-1', 'p-b': 'glass-2' }))
    const reloaded = deserialize(serialize(store.document))
    expect(reloaded.assignments).toEqual({ 'p-a': 'glass-1', 'p-b': 'glass-2' })
  })

  it('an empty project has no assignments', () => {
    expect(createEmptyProject().assignments).toEqual({})
  })
})
