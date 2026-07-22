import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'
import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'

import LayersPanel from './LayersPanel.svelte'

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

function makeDoc(): DocumentController {
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  return ctrl
}

describe('LayersPanel — realistic-render backlight (F-053)', () => {
  it('hides the backlight controls unless the render view is active', () => {
    const ctrl = makeDoc()
    render(LayersPanel, {
      viewport: new ViewportController(),
      doc: ctrl.doc,
      execute: (c) => ctrl.execute(c),
      renderActive: false,
    })
    expect(screen.queryByLabelText('Backlight intensity')).not.toBeInTheDocument()
  })

  it('adjusts backlight intensity and warmth, each one undo entry (FR-1)', async () => {
    const ctrl = makeDoc()
    render(LayersPanel, {
      viewport: new ViewportController(),
      doc: ctrl.doc,
      execute: (c) => ctrl.execute(c),
      renderActive: true,
    })

    const intensity = screen.getByLabelText('Backlight intensity') as HTMLInputElement
    expect(intensity.value).toBe('1')
    await fireEvent.change(intensity, { target: { value: '1.5' } })
    expect(ctrl.doc.render.backlightIntensity).toBe(1.5)

    const warmth = screen.getByLabelText('Backlight warmth') as HTMLInputElement
    await fireEvent.change(warmth, { target: { value: '-0.4' } })
    expect(ctrl.doc.render.backlightWarmth).toBe(-0.4)

    // Two independent edits → two undo steps.
    ctrl.undo()
    expect(ctrl.doc.render.backlightWarmth).toBe(0)
    expect(ctrl.doc.render.backlightIntensity).toBe(1.5)
    ctrl.undo()
    expect(ctrl.doc.render.backlightIntensity).toBe(1)
  })
})
