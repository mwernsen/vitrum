import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'
import { LightController } from '../light/controller.svelte'

import LightPanel from './LightPanel.svelte'

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

describe('LightPanel (F-054)', () => {
  it('shows both mode tabs and switches mode as one undo entry', async () => {
    const { ctrl, light } = setup()
    render(LightPanel, { light, lightViewActive: true })

    expect(screen.getByRole('tab', { name: 'Manual' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '365 days' })).toBeInTheDocument()

    // Defaults to the astronomical (365 days) mode.
    expect(ctrl.doc.light.mode).toBe('astronomical')
    await fireEvent.click(screen.getByRole('tab', { name: 'Manual' }))
    expect(ctrl.doc.light.mode).toBe('manual')
    ctrl.undo()
    expect(ctrl.doc.light.mode).toBe('astronomical')
  })

  it('the manual tab shows the sun dome and commits an intensity edit as one undo entry', async () => {
    const { ctrl, light } = setup()
    light.patch({ mode: 'manual' })
    render(LightPanel, { light, lightViewActive: true })

    expect(screen.getByLabelText('Sun position')).toBeInTheDocument()
    const intensity = screen.getByLabelText('Light intensity') as HTMLInputElement
    await fireEvent.change(intensity, { target: { value: '0.4' } })
    expect(ctrl.doc.light.intensity).toBeCloseTo(0.4)
    ctrl.undo()
    expect(ctrl.doc.light.intensity).toBe(1)
  })

  it('the 365-days tab scrubs time transiently and commits once on release', async () => {
    const { ctrl, light } = setup()
    render(LightPanel, { light, lightViewActive: true })

    const time = screen.getByLabelText('Time of day') as HTMLInputElement
    // Scrubbing (input) updates the transient value but does not touch the document.
    await fireEvent.input(time, { target: { value: '600' } })
    expect(ctrl.doc.light.timeMinutes).toBe(12 * 60) // unchanged
    expect(light.effectiveMinutes).toBe(600) // transient reflects the scrub
    // Releasing (change) commits one undo entry.
    await fireEvent.change(time, { target: { value: '600' } })
    expect(ctrl.doc.light.timeMinutes).toBe(600)
    ctrl.undo()
    expect(ctrl.doc.light.timeMinutes).toBe(12 * 60)
  })

  it('a season preset jumps the day of year', async () => {
    const { ctrl, light } = setup()
    render(LightPanel, { light, lightViewActive: true })
    await fireEvent.click(screen.getByRole('button', { name: 'Winter solstice' }))
    expect(ctrl.doc.light.dayOfYear).toBe(355)
  })

  it('invites switching to the light view when it is not active', () => {
    const { light } = setup()
    render(LightPanel, { light, lightViewActive: false })
    expect(screen.getByText(/Switch to the light view/i)).toBeInTheDocument()
  })
})
