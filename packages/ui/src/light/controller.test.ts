import { afterEach, describe, expect, it } from 'vitest'

import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'

import { LightController } from './controller.svelte'

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

function setup() {
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  const light = new LightController({ getDoc: () => ctrl.doc, execute: (c) => ctrl.execute(c) })
  return { ctrl, light }
}

describe('LightController (F-054)', () => {
  it('resolves the sun from the persisted setup', () => {
    const { light } = setup()
    // Default: south-facing Amsterdam window, midsummer noon → sun up and roughly frontal.
    expect(light.sun.aboveHorizon).toBe(true)
    expect(light.sun.elevationDeg).toBeGreaterThan(40)
  })

  it('scrubs time transiently and commits once on release', () => {
    const { ctrl, light } = setup()
    light.scrubToMinutes(480)
    expect(light.effectiveMinutes).toBe(480)
    expect(ctrl.doc.light.timeMinutes).toBe(12 * 60) // not committed yet
    light.commitMinutes()
    expect(ctrl.doc.light.timeMinutes).toBe(480)
    expect(light.scrubMinutes).toBeNull()
  })

  it('scrubs the manual sun transiently and commits once on release', () => {
    const { ctrl, light } = setup()
    light.patch({ mode: 'manual' })
    light.scrubManualSun(30, 20)
    expect(light.effectiveManualAz).toBe(30)
    expect(light.effectiveManualEl).toBe(20)
    expect(ctrl.doc.light.manualAzimuthDeg).toBe(0) // not committed
    light.commitManualSun()
    expect(ctrl.doc.light.manualAzimuthDeg).toBe(30)
    expect(ctrl.doc.light.manualElevationDeg).toBe(20)
  })

  it('clamps the manual sun to the panel hemisphere', () => {
    const { light } = setup()
    light.scrubManualSun(200, -30)
    expect(light.effectiveManualAz).toBe(90)
    expect(light.effectiveManualEl).toBe(0)
  })

  it('toggles playback and stops cleanly, committing the paused moment', () => {
    const { ctrl, light } = setup()
    light.play()
    expect(light.playing).toBe(true)
    // Force a known transient moment, then stop → it commits once.
    light.scrubMinutes = 615
    light.stop()
    expect(light.playing).toBe(false)
    expect(ctrl.doc.light.timeMinutes).toBe(615)
  })
})
