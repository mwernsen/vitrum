import { addSegments, createSegment } from '@vitrum/model'
import { line, vec2 } from '@vitrum/geometry'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'
import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'
import { SymmetryController } from '../tools/symmetry.svelte'

import LayersPanel from './LayersPanel.svelte'

/** A reactive document (via `DocumentController.doc`, a `$state` rune) + a symmetry controller. */
function makeSymmetry() {
  const ctrl = new DocumentController(createFakeHost())
  const controller = new SymmetryController({
    getDoc: () => ctrl.doc,
    execute: (command) => ctrl.execute(command),
    defaultCenter: () => vec2(50, 50),
  })
  toDispose.push(ctrl)
  return { ctrl, controller }
}

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

describe('LayersPanel — live symmetry (F-052)', () => {
  it('shows the placeholder when no symmetry controller is provided', () => {
    render(LayersPanel, { viewport: new ViewportController() })
    expect(screen.getByText('Coming with F-052')).toBeInTheDocument()
  })

  it('switches mode and reveals radial controls', async () => {
    const { ctrl, controller } = makeSymmetry()
    render(LayersPanel, { viewport: new ViewportController(), symmetry: controller })

    const mode = screen.getByLabelText('Mode') as HTMLSelectElement
    await fireEvent.change(mode, { target: { value: 'radial' } })
    expect(ctrl.doc.symmetry.mode).toBe('radial')

    const count = screen.getByLabelText('Radial fold count') as HTMLInputElement
    expect(count.value).toBe('6')
    await fireEvent.input(count, { target: { value: '8' } })
    expect(ctrl.doc.symmetry.count).toBe(8)

    await fireEvent.click(screen.getByRole('switch', { name: /add mirror/i }))
    expect(ctrl.doc.symmetry.mirror).toBe(true)
  })

  it('edits the axis angle in degrees', async () => {
    const { ctrl, controller } = makeSymmetry()
    render(LayersPanel, { viewport: new ViewportController(), symmetry: controller })
    await fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'mirror' } })

    const angle = screen.getByLabelText('Symmetry axis angle in degrees') as HTMLInputElement
    await fireEvent.input(angle, { target: { value: '30' } })
    expect(ctrl.doc.symmetry.angle).toBeCloseTo((30 * Math.PI) / 180, 9)
  })

  it('bakes the derived replicas into stored segments as one command', async () => {
    const { ctrl, controller } = makeSymmetry()
    ctrl.execute(addSegments([createSegment(line(vec2(60, 50), vec2(80, 70)))]))
    render(LayersPanel, { viewport: new ViewportController(), symmetry: controller })

    await fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'radial' } })
    controller.setCount(4)

    expect(Object.keys(ctrl.doc.segments)).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: /bake symmetry/i }))

    // 4-fold radial: source + 3 replicas materialised, mode back to none, one undo entry.
    expect(Object.keys(ctrl.doc.segments)).toHaveLength(4)
    expect(ctrl.doc.symmetry.mode).toBe('none')
    ctrl.undo()
    expect(Object.keys(ctrl.doc.segments)).toHaveLength(1)
    expect(ctrl.doc.symmetry.mode).toBe('radial')
  })
})
