import { describe, expect, it } from 'vitest'

import { updateLightSettings } from './commands'
import { deserialize, serialize } from './serialize'
import { DocumentStore } from './store'
import { defaultLightSettings } from './types'

/** Sunlight-simulation settings command (F-054 FR-4/FR-7): a shallow patch, each edit one undo entry. */
describe('updateLightSettings', () => {
  it('starts from the shipped defaults', () => {
    const store = new DocumentStore()
    expect(store.document.light).toEqual(defaultLightSettings())
  })

  it('patches only the given fields and is one undo entry', () => {
    const store = new DocumentStore()
    store.execute(updateLightSettings({ mode: 'manual', temperatureK: 3200 }))
    expect(store.document.light.mode).toBe('manual')
    expect(store.document.light.temperatureK).toBe(3200)
    // Untouched fields are preserved.
    expect(store.document.light.facadeAzimuthDeg).toBe(defaultLightSettings().facadeAzimuthDeg)

    store.undo()
    expect(store.document.light.mode).toBe('astronomical')
    expect(store.document.light.temperatureK).toBe(defaultLightSettings().temperatureK)
    store.redo()
    expect(store.document.light.mode).toBe('manual')
  })

  it('undo restores the exact prior value of every touched field', () => {
    const store = new DocumentStore()
    store.execute(updateLightSettings({ dayOfYear: 172, timeMinutes: 600 }))
    store.execute(updateLightSettings({ dayOfYear: 355, timeMinutes: 900 }))
    expect(store.document.light.dayOfYear).toBe(355)
    store.undo()
    expect(store.document.light.dayOfYear).toBe(172)
    expect(store.document.light.timeMinutes).toBe(600)
  })

  it('round-trips through serialize/deserialize (reload-safe)', () => {
    const store = new DocumentStore()
    store.execute(
      updateLightSettings({
        mode: 'astronomical',
        latitudeDeg: 40.7,
        longitudeDeg: -74,
        facadeAzimuthDeg: 90,
        overcast: true,
        photoGrain: true,
        showTextures: false,
      }),
    )
    const back = deserialize(serialize(store.document))
    expect(back.light.latitudeDeg).toBe(40.7)
    expect(back.light.longitudeDeg).toBe(-74)
    expect(back.light.facadeAzimuthDeg).toBe(90)
    expect(back.light.overcast).toBe(true)
    expect(back.light.photoGrain).toBe(true)
    expect(back.light.showTextures).toBe(false)
  })
})
