import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'

import Inspector from './Inspector.svelte'

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

function makeDoc(): DocumentController {
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  return ctrl
}

// Cockpit v2 moved the backlight out of the old Layers dock into the inspector, beside the render
// view it belongs to. The undo semantics are unchanged: one entry per slider release.
describe('Inspector — realistic-render backlight (F-053)', () => {
  it('hides the backlight controls unless the render view is active', () => {
    const ctrl = makeDoc()
    render(Inspector, {
      unit: 'mm',
      viewMode: 'design',
      doc: ctrl.doc,
      execute: (c) => ctrl.execute(c),
    })
    expect(screen.queryByLabelText('Backlight intensity')).not.toBeInTheDocument()
  })

  it('adjusts backlight intensity and warmth, each one undo entry (FR-1)', async () => {
    const ctrl = makeDoc()
    render(Inspector, {
      unit: 'mm',
      viewMode: 'render',
      doc: ctrl.doc,
      execute: (c) => ctrl.execute(c),
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

describe('Inspector — per-view context with nothing selected (Cockpit v2)', () => {
  it('names what the active view is showing', () => {
    const ctrl = makeDoc()
    const view = render(Inspector, {
      unit: 'mm',
      viewMode: 'design',
      doc: ctrl.doc,
      panelStats: [{ label: 'Pieces', value: '4' }],
    })
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toHaveTextContent('Panel')
    expect(screen.getByText('Click a piece on the panel to inspect it.')).toBeInTheDocument()

    void view.rerender({ unit: 'mm', viewMode: 'cartoon', doc: ctrl.doc })
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toHaveTextContent(
      'Cartoon sheet',
    )
  })

  it('shows the headline panel numbers as tiles', () => {
    render(Inspector, {
      unit: 'mm',
      viewMode: 'design',
      panelStats: [
        { label: 'Pieces', value: '4' },
        { label: 'Glass area', value: '0.140 m²' },
      ],
    })
    expect(screen.getByText('0.140 m²')).toBeInTheDocument()
  })
})
