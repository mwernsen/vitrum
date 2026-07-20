import { makeViewport } from '@vitrum/core'
import { vec2 } from '@vitrum/geometry'
import { DocumentStore, type Command, type ExecuteOptions } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import type { ViewportController } from '../canvas/viewport.svelte'

import { ReinforcementController } from './reinforcement.svelte'

/** A viewport at scale 1, no offset → screen coordinates equal world coordinates. */
function setup() {
  const store = new DocumentStore()
  const viewport = {
    transform: makeViewport(1, vec2(0, 0)),
    zoomFactor: 1,
  } as unknown as ViewportController
  const reinforce = new ReinforcementController({
    viewport,
    getBars: () => store.document.reinforcements,
    execute: (command: Command, options?: ExecuteOptions) => store.execute(command, options),
  })
  return { store, reinforce }
}

describe('ReinforcementController (F-032)', () => {
  it('places a bar with two clicks, in one undo step', () => {
    const { store, reinforce } = setup()
    reinforce.setMode('draw')
    reinforce.pointerDown(vec2(50, 300))
    reinforce.pointerDown(vec2(850, 300))
    expect(store.document.reinforcements).toHaveLength(1)
    const bar = store.document.reinforcements[0]!
    expect(bar.a).toEqual({ x: 50, y: 300 })
    expect(bar.b).toEqual({ x: 850, y: 300 })
    expect(reinforce.selectedId).toBe(bar.id)

    store.undo()
    expect(store.document.reinforcements).toHaveLength(0)
  })

  it('cancels a placement on Escape without creating a bar', () => {
    const { store, reinforce } = setup()
    reinforce.setMode('draw')
    reinforce.pointerDown(vec2(50, 300))
    expect(reinforce.placement).not.toBeNull()
    reinforce.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(reinforce.start).toBeNull()
    expect(store.document.reinforcements).toHaveLength(0)
  })

  it('selects an existing bar by clicking it, and deletes it with Delete', () => {
    const { store, reinforce } = setup()
    reinforce.setMode('draw')
    reinforce.pointerDown(vec2(0, 100))
    reinforce.pointerDown(vec2(400, 100))
    const id = store.document.reinforcements[0]!.id
    reinforce.selectedId = null

    // Click on the bar body selects it (no new placement).
    reinforce.pointerDown(vec2(200, 100))
    expect(reinforce.selectedId).toBe(id)
    expect(reinforce.start).toBeNull()

    reinforce.handleKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }))
    expect(store.document.reinforcements).toHaveLength(0)
    expect(reinforce.selectedId).toBeNull()
  })

  it('drags an endpoint as one coalesced undo entry', () => {
    const { store, reinforce } = setup()
    reinforce.setMode('draw')
    reinforce.pointerDown(vec2(100, 100))
    reinforce.pointerDown(vec2(500, 100))
    const id = store.document.reinforcements[0]!.id

    // Grab endpoint b and drag it in steps.
    reinforce.pointerDown(vec2(500, 100))
    reinforce.pointerMove(vec2(500, 200))
    reinforce.pointerMove(vec2(500, 300))
    reinforce.pointerUp()
    expect(store.document.reinforcements[0]!.b).toEqual({ x: 500, y: 300 })

    // The whole drag is one undo entry: undo returns to the placed position.
    store.undo()
    const bar = store.document.reinforcements.find((r) => r.id === id)
    expect(bar!.b).toEqual({ x: 500, y: 100 })
  })

  it('edits the selected bar’s width and material', () => {
    const { store, reinforce } = setup()
    reinforce.setMode('draw')
    reinforce.pointerDown(vec2(0, 0))
    reinforce.pointerDown(vec2(300, 0))
    reinforce.setWidth(9)
    reinforce.setMaterial('steel')
    const bar = store.document.reinforcements[0]!
    expect(bar.widthMm).toBe(9)
    expect(bar.material).toBe('steel')
  })

  it('is inert when not in draw mode', () => {
    const { store, reinforce } = setup()
    reinforce.pointerDown(vec2(0, 0))
    reinforce.pointerDown(vec2(300, 0))
    expect(store.document.reinforcements).toHaveLength(0)
  })
})
