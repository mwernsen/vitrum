import { fireEvent, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'
import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'
import { SnapController } from '../tools/snap.svelte'
import { ToolController } from '../tools/controller.svelte'

import DrawPanel from './DrawPanel.svelte'

const toDispose: DocumentController[] = []
afterEach(() => {
  localStorage.clear()
  while (toDispose.length) toDispose.pop()!.dispose()
})

function setup() {
  const viewport = new ViewportController()
  const snap = new SnapController(viewport)
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  const tools = new ToolController({
    viewport,
    execute: (c) => ctrl.execute(c),
    getSegments: () => Object.values(ctrl.doc.segments),
    getNodes: () => ctrl.doc.nodes,
  })
  return { viewport, snap, tools, ctrl }
}

describe('DrawPanel — the tool palette (F-011)', () => {
  it('lists the drawing tools with the shortcuts they really have', () => {
    const { viewport, tools } = setup()
    render(DrawPanel, { viewport, tools })

    const palette = screen.getByRole('toolbar', { name: 'Tools' })
    expect(palette).toBeInTheDocument()
    // Shortcut in the accessible name for the tools that have one…
    expect(screen.getByRole('button', { name: 'Line (L)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guide (G)' })).toBeInTheDocument()
    // …and none advertised for the tools that do not.
    expect(screen.getByRole('button', { name: 'Panel border' })).toBeInTheDocument()
  })

  it('activates a tool and shows what its next click does', async () => {
    const user = userEvent.setup()
    const { viewport, tools } = setup()
    render(DrawPanel, { viewport, tools })

    expect(screen.getByTestId('tool-hint')).toHaveTextContent('Drag to marquee-select')

    await user.click(screen.getByRole('button', { name: 'Line (L)' }))
    expect(tools.activeId).toBe('line')
    expect(screen.getByRole('button', { name: 'Line (L)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('tool-hint')).toHaveTextContent('Hold shift for 15° increments')
  })

  it('omits the paint and bar entries when their controllers are absent', () => {
    const { viewport, tools } = setup()
    render(DrawPanel, { viewport, tools })
    expect(screen.queryByRole('button', { name: 'Paint glass' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reinforcement' })).not.toBeInTheDocument()
  })
})

describe('DrawPanel — snapping (F-012)', () => {
  it('lists every snap kind as a chip and toggles one', async () => {
    const user = userEvent.setup()
    const { viewport, snap } = setup()
    render(DrawPanel, { viewport, snap })

    for (const label of ['Endpoint', 'Intersection', 'Midpoint', 'On curve', 'Grid', 'Angle']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }

    expect(snap.toggles.midpoint).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Midpoint' }))
    expect(snap.toggles.midpoint).toBe(false)
  })

  it('disables the kind chips while the master switch is off', async () => {
    const user = userEvent.setup()
    const { viewport, snap } = setup()
    render(DrawPanel, { viewport, snap })

    await user.click(screen.getByRole('switch', { name: 'Snapping' }))
    expect(snap.master).toBe(false)
    expect(screen.getByRole('button', { name: 'Grid' })).toBeDisabled()
  })

  it('reads out the grid spacing the canvas is drawing at', () => {
    const { viewport, snap } = setup()
    render(DrawPanel, { viewport, snap })
    // Derived from the zoom level, so it is a millimetre reading rather than an empty field.
    expect(screen.getByTestId('grid-spacing')).toHaveTextContent('mm')
  })

  it('toggles guide visibility and fires clear-all-guides', async () => {
    const user = userEvent.setup()
    const { viewport, snap } = setup()
    const onClearGuides = vi.fn()
    render(DrawPanel, { viewport, snap, onClearGuides })

    await user.click(screen.getByRole('switch', { name: 'Show guides' }))
    expect(viewport.guidesVisible).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Clear all guides' }))
    expect(onClearGuides).toHaveBeenCalledOnce()
  })

  it('hides the snapping section without a snap controller', () => {
    const { viewport } = setup()
    render(DrawPanel, { viewport })
    expect(screen.queryByRole('switch', { name: 'Snapping' })).not.toBeInTheDocument()
  })
})

describe('DrawPanel — the sections it absorbed', () => {
  it('shows a symmetry placeholder without a controller', () => {
    const { viewport } = setup()
    render(DrawPanel, { viewport })
    expect(screen.getByText('Coming with F-052')).toBeInTheDocument()
  })

  it('shows a tracing placeholder without a reference controller', () => {
    const { viewport } = setup()
    render(DrawPanel, { viewport })
    expect(screen.getByText('Reference underlay · F-051')).toBeInTheDocument()
  })

  it('no longer carries the overlay-visibility rows — those moved to the canvas chip', () => {
    const { viewport } = setup()
    render(DrawPanel, { viewport })
    expect(screen.queryByRole('button', { name: /Glass fills/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Piece regions/ })).not.toBeInTheDocument()
  })

  it('no longer carries the technique control — that moved to the top-bar chip', () => {
    const { viewport } = setup()
    render(DrawPanel, { viewport })
    expect(screen.queryByRole('heading', { name: 'Technique' })).not.toBeInTheDocument()
  })
})

describe('DrawPanel — grid spacing follows the viewport', () => {
  it('reports a coarser spacing as the view zooms out', async () => {
    const { viewport, snap } = setup()
    viewport.resize(800, 600, 1)
    const view = render(DrawPanel, { viewport, snap })
    const before = screen.getByTestId('grid-spacing').textContent

    viewport.zoomOut()
    viewport.zoomOut()
    viewport.zoomOut()
    viewport.zoomOut()
    await view.rerender({ viewport, snap })

    expect(screen.getByTestId('grid-spacing').textContent).not.toBe(before)
  })
})

describe('DrawPanel — live symmetry (F-052)', () => {
  it('switches mode and reveals the radial controls', async () => {
    const { viewport, ctrl } = setup()
    const { SymmetryController } = await import('../tools/symmetry.svelte')
    const { vec2 } = await import('@vitrum/geometry')
    const symmetry = new SymmetryController({
      getDoc: () => ctrl.doc,
      execute: (c) => ctrl.execute(c),
      defaultCenter: () => vec2(50, 50),
    })
    render(DrawPanel, { viewport, symmetry })

    await fireEvent.click(screen.getByRole('button', { name: 'Radial (N-fold)' }))
    expect(ctrl.doc.symmetry.mode).toBe('radial')

    const count = screen.getByLabelText('Radial fold count') as HTMLInputElement
    expect(count.value).toBe('6')
    await fireEvent.input(count, { target: { value: '8' } })
    expect(ctrl.doc.symmetry.count).toBe(8)

    await fireEvent.click(screen.getByRole('switch', { name: /add mirror/i }))
    expect(ctrl.doc.symmetry.mirror).toBe(true)
  })

  it('edits the axis angle in degrees', async () => {
    const { viewport, ctrl } = setup()
    const { SymmetryController } = await import('../tools/symmetry.svelte')
    const { vec2 } = await import('@vitrum/geometry')
    const symmetry = new SymmetryController({
      getDoc: () => ctrl.doc,
      execute: (c) => ctrl.execute(c),
      defaultCenter: () => vec2(50, 50),
    })
    render(DrawPanel, { viewport, symmetry })

    await fireEvent.click(screen.getByRole('button', { name: 'Mirror (1 axis)' }))
    const angle = screen.getByLabelText('Symmetry axis angle in degrees') as HTMLInputElement
    await fireEvent.input(angle, { target: { value: '30' } })
    expect(ctrl.doc.symmetry.angle).toBeCloseTo((30 * Math.PI) / 180, 9)
  })

  it('shows the seeded centre and moves it from the numeric fields', async () => {
    const { viewport, ctrl } = setup()
    const { SymmetryController } = await import('../tools/symmetry.svelte')
    const { vec2 } = await import('@vitrum/geometry')
    const symmetry = new SymmetryController({
      getDoc: () => ctrl.doc,
      execute: (c) => ctrl.execute(c),
      // What the shell now seeds from the panel size: the centre of a 300 × 400 panel.
      defaultCenter: () => vec2(150, 200),
    })
    render(DrawPanel, { viewport, symmetry })

    await fireEvent.click(screen.getByRole('button', { name: 'Mirror (1 axis)' }))

    // The fields read back the seeded panel centre rather than the old (0, 0) corner.
    const x = screen.getByLabelText('Symmetry centre x') as HTMLInputElement
    const y = screen.getByLabelText('Symmetry centre y') as HTMLInputElement
    expect(x.value).toBe('150')
    expect(y.value).toBe('200')

    await fireEvent.input(x, { target: { value: '120' } })
    expect(ctrl.doc.symmetry.center).toEqual(vec2(120, 200))
    await fireEvent.input(y, { target: { value: '90' } })
    expect(ctrl.doc.symmetry.center).toEqual(vec2(120, 90))

    // One undo entry per edit: undoing twice walks back to the seeded centre.
    ctrl.undo()
    expect(ctrl.doc.symmetry.center).toEqual(vec2(120, 200))
    ctrl.undo()
    expect(ctrl.doc.symmetry.center).toEqual(vec2(150, 200))
  })

  it('ignores an unparseable centre instead of moving the axes to NaN', async () => {
    const { viewport, ctrl } = setup()
    const { SymmetryController } = await import('../tools/symmetry.svelte')
    const { vec2 } = await import('@vitrum/geometry')
    const symmetry = new SymmetryController({
      getDoc: () => ctrl.doc,
      execute: (c) => ctrl.execute(c),
      defaultCenter: () => vec2(150, 200),
    })
    render(DrawPanel, { viewport, symmetry })

    await fireEvent.click(screen.getByRole('button', { name: 'Mirror (1 axis)' }))
    const x = screen.getByLabelText('Symmetry centre x') as HTMLInputElement
    await fireEvent.input(x, { target: { value: 'abc' } })
    expect(ctrl.doc.symmetry.center).toEqual(vec2(150, 200))
  })

  it('states the centre in the document unit', async () => {
    const { viewport, ctrl } = setup()
    const { SymmetryController } = await import('../tools/symmetry.svelte')
    const { vec2 } = await import('@vitrum/geometry')
    const symmetry = new SymmetryController({
      getDoc: () => ctrl.doc,
      execute: (c) => ctrl.execute(c),
      defaultCenter: () => vec2(254, 508),
    })
    viewport.setUnit('in')
    render(DrawPanel, { viewport, symmetry })

    await fireEvent.click(screen.getByRole('button', { name: 'Mirror (1 axis)' }))
    // 254 mm = 10 in, 508 mm = 20 in — and typing inches stores millimetres.
    expect((screen.getByLabelText('Symmetry centre x') as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText('Symmetry centre y') as HTMLInputElement).value).toBe('20')

    await fireEvent.input(screen.getByLabelText('Symmetry centre x'), { target: { value: '4' } })
    expect(ctrl.doc.symmetry.center.x).toBeCloseTo(101.6, 6)
  })

  it('bakes the derived replicas into stored segments as one command', async () => {
    const { viewport, ctrl } = setup()
    const { SymmetryController } = await import('../tools/symmetry.svelte')
    const { vec2, line } = await import('@vitrum/geometry')
    const { addSegments, createSegment } = await import('@vitrum/model')
    const symmetry = new SymmetryController({
      getDoc: () => ctrl.doc,
      execute: (c) => ctrl.execute(c),
      defaultCenter: () => vec2(50, 50),
    })
    ctrl.execute(addSegments([createSegment(line(vec2(60, 50), vec2(80, 70)))]))
    render(DrawPanel, { viewport, symmetry })

    await fireEvent.click(screen.getByRole('button', { name: 'Radial (N-fold)' }))
    symmetry.setCount(4)

    expect(Object.keys(ctrl.doc.segments)).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: /bake symmetry/i }))

    // 4-fold radial: source + 3 replicas materialised, mode back to none, one undo entry.
    expect(Object.keys(ctrl.doc.segments)).toHaveLength(4)
    expect(ctrl.doc.symmetry.mode).toBe('none')
    ctrl.undo()
    expect(Object.keys(ctrl.doc.segments)).toHaveLength(1)
    expect(ctrl.doc.symmetry.mode).toBe('radial')
  })

  // The symmetry setup is document-wide (F-052 Decision §2), so a design with a mirrored border
  // around a rotated centre is built by baking between stages. That worked from day one but read
  // as "unsupported" in user testing (run 2026-08-16-a, F-052 finding 4), so the hint says it.
  it('tells the user how to combine two symmetries', async () => {
    const { viewport, ctrl } = setup()
    const { SymmetryController } = await import('../tools/symmetry.svelte')
    const { vec2 } = await import('@vitrum/geometry')
    const symmetry = new SymmetryController({
      getDoc: () => ctrl.doc,
      execute: (c) => ctrl.execute(c),
      defaultCenter: () => vec2(50, 50),
    })
    render(DrawPanel, { viewport, symmetry })

    expect(screen.getByText(/bake it, then switch mode/i)).toBeInTheDocument()
  })
})
