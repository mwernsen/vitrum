import { makeViewport } from '@vitrum/core'
import { distance, vec2, type Line, type Vec2 } from '@vitrum/geometry'
import { createEmptyProject, type Command, type Project } from '@vitrum/model'
import { afterEach, describe, expect, it } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'

import { ToolController } from './controller.svelte'
import { SnapController } from './snap.svelte'

afterEach(() => localStorage.clear())

/** A controller whose viewport uses an identity transform, so screen px == world mm. */
function setup() {
  const viewport = new ViewportController()
  viewport.transform = makeViewport(1, vec2(0, 0))
  const commands: Command[] = []
  // The live document is the fold of every executed command — this is what the border
  // tool reads through getSegments to enforce a single contour.
  const project = (): Project => commands.reduce((doc, c) => c.apply(doc), createEmptyProject())
  const tools = new ToolController({
    viewport,
    execute: (c) => commands.push(c),
    getSegments: () => Object.values(project().segments),
    getNodes: () => project().nodes,
  })
  return { tools, viewport, commands, project }
}

const key = (k: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: k, ...init })

describe('ToolController activation', () => {
  it('activates the line tool with its single-key shortcut', () => {
    const { tools } = setup()
    expect(tools.activeId).toBe('select')
    expect(tools.handleKeyDown(key('l'))).toBe(true)
    expect(tools.activeId).toBe('line')
  })

  it('ignores single-key shortcuts held with a modifier', () => {
    const { tools } = setup()
    expect(tools.handleKeyDown(key('l', { metaKey: true }))).toBe(false)
    expect(tools.activeId).toBe('select')
  })

  it('deactivates back to select and cancels the gesture', () => {
    const { tools } = setup()
    tools.activate('line')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    expect(tools.active).toBe(true)
    tools.deactivate()
    expect(tools.activeId).toBe('select')
    expect(tools.active).toBe(false)
  })
})

describe('ToolController drawing', () => {
  it('a polyline gesture emits exactly one command with welded spans', () => {
    const { tools, commands, project } = setup()
    tools.activate('line')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerDown(vec2(100, 0), { shift: false, alt: false })
    tools.pointerDown(vec2(100, 80), { shift: false, alt: false })
    tools.handleKeyDown(key('Enter'))

    expect(commands).toHaveLength(1) // one gesture ⇒ one undo entry (FR-1)
    const segs = Object.values(project().segments)
    expect(segs).toHaveLength(2)
    const [a, b] = segs.map((s) => s.geometry as Line)
    expect(a!.b).toEqual(b!.a) // coincident shared node (auto-weld)
    expect(tools.active).toBe(false)
  })

  it('shift locks a span parallel to the document line it starts from', () => {
    const { tools, project } = setup()
    // An existing line at 20°, drawn first so it is in the document.
    const end = vec2(Math.cos(0.349) * 100, Math.sin(0.349) * 100)
    tools.activate('line')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerDown(end, { shift: false, alt: false })
    tools.handleKeyDown(key('Enter'))

    // A second span starting at that line's far endpoint, shift-held at ~22° — off every 45° ray.
    const raw = vec2(end.x + Math.cos(0.384) * 100, end.y + Math.sin(0.384) * 100)
    tools.pointerDown(end, { shift: false, alt: false })
    tools.pointerDown(raw, { shift: true, alt: false })
    tools.handleKeyDown(key('Enter'))

    const spans = Object.values(project().segments).map((s) => s.geometry as Line)
    expect(spans).toHaveLength(2)
    const second = spans.find((s) => s.a.x === end.x && s.a.y === end.y)!
    const bearing = Math.atan2(second.b.y - second.a.y, second.b.x - second.a.x)
    expect(bearing).toBeCloseTo(0.349, 6) // parallel to the first line, not on a 45° ray
    expect(distance(second.a, second.b)).toBeCloseTo(100, 6)
  })

  it('a line drawn onto the frame joins it: the border splits, no dangling end', () => {
    const { tools, viewport, commands, project } = setup()
    // A 250 × 250 frame, as the border tool leaves it.
    const snap = new SnapController(viewport)
    snap.master = true
    tools.resolver = snap.resolver
    tools.activate('border')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerDown(vec2(250, 250), { shift: false, alt: false })
    snap.updateScene(Object.values(project().segments))
    expect(Object.values(project().segments).filter((s) => s.role === 'border')).toHaveLength(4)

    // Draw a line from inside the panel to a click 0.387 mm *past* the top border — the
    // sub-pixel overshoot a real click produces. Snapping pulls it onto the border.
    tools.activate('line')
    tools.pointerDown(vec2(87.38, 44.534), { shift: false, alt: false })
    tools.pointerMove(vec2(89.535, -0.387), { shift: false, alt: false })
    tools.pointerDown(vec2(89.535, -0.387), { shift: false, alt: false })
    tools.handleKeyDown(key('Enter'))

    const doc = project()
    const nodeAt = (x: number, y: number) =>
      Object.entries(doc.nodes).find(([, n]) => n.pos.x === x && n.pos.y === y)?.[0]
    const junction = nodeAt(89.535, 0)
    expect(junction).toBeDefined() // the end landed exactly on the border, not past it
    const meeting = Object.values(doc.segments).filter((s) => s.endpoints.includes(junction!))
    expect(meeting).toHaveLength(3) // two border halves + the drawn line — a real T-junction
    expect(Object.values(doc.segments).filter((s) => s.role === 'border')).toHaveLength(5)
    // Still one undo entry per gesture: the frame, then the welded line.
    expect(commands).toHaveLength(2)
  })

  it('shift-drawing onto a line keeps the exact angle and still lands on the line', () => {
    const { tools, viewport, project } = setup()
    const snap = new SnapController(viewport)
    // Only on-curve snapping, so the assertion is about the constraint, not the grid.
    snap.toggles = {
      endpoint: false,
      intersection: false,
      midpoint: false,
      'on-curve': true,
      grid: false,
      angle: false,
    }
    tools.resolver = snap.resolver
    tools.activate('border')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerDown(vec2(250, 250), { shift: false, alt: false })
    snap.updateScene(Object.values(project().segments))

    // Aim at the top border on a deliberately non-45° bearing, with Shift held. Snapping alone
    // would land on the border off-angle; the constraint alone would rotate it off the border.
    tools.activate('line')
    const from = vec2(87.38, 44.534)
    const to = vec2(89.535, -0.387)
    tools.pointerDown(from, { shift: false, alt: false })
    tools.pointerMove(to, { shift: true, alt: false })
    tools.pointerDown(to, { shift: true, alt: false })
    tools.handleKeyDown(key('Enter'))

    const doc = project()
    const drawn = Object.values(doc.segments).find((s) => s.role === 'lead')!
    const geo = drawn.geometry as Line
    // Exactly vertical (the constrained ray) …
    expect(Math.atan2(geo.b.y - geo.a.y, geo.b.x - geo.a.x)).toBeCloseTo(-Math.PI / 2, 9)
    // … and exactly on the border, welded into it as a T-junction.
    expect(geo.b.y).toBe(0)
    expect(
      Object.values(doc.segments).filter((s) => s.endpoints.includes(drawn.endpoints[1])),
    ).toHaveLength(3)
    expect(Object.values(doc.segments).filter((s) => s.role === 'border')).toHaveLength(5)
  })

  it('shift locked parallel to the start line still lands on the line it ends at', () => {
    const { tools, viewport, project } = setup()
    const snap = new SnapController(viewport)
    snap.toggles = { ...snap.toggles, grid: false, angle: false, midpoint: false }
    tools.resolver = snap.resolver
    const refresh = () => snap.updateScene(Object.values(project().segments))
    const drawTo = (from: Vec2, to: Vec2, shift: boolean) => {
      tools.activate('line')
      tools.pointerDown(from, { shift: false, alt: false })
      tools.pointerMove(to, { shift, alt: false })
      tools.pointerDown(to, { shift, alt: false })
      tools.handleKeyDown(key('Enter'))
      refresh()
    }

    // Line A at 20°, then a vertical line further right to end on.
    const a0 = vec2(20, 60)
    const a1 = vec2(20 + Math.cos(0.349) * 60, 60 + Math.sin(0.349) * 60)
    drawTo(a0, a1, false)
    drawTo(vec2(140, 10), vec2(140, 200), false)

    // From A's far end, Shift held: parallel to A is on the ladder. Aim a fraction past the
    // vertical line. Snapping alone lands off-angle; the constraint alone lands off the line.
    const aim = vec2(140.4, a1.y + Math.tan(0.349) * (140.4 - a1.x) + 0.3)
    drawTo(a1, aim, true)

    const doc = project()
    const drawn = Object.values(doc.segments).find(
      (s) => s.geometry.kind === 'line' && s.geometry.a.x === a1.x && s.geometry.a.y === a1.y,
    )!
    const geo = drawn.geometry as Line
    // Exactly parallel to line A …
    expect(Math.atan2(geo.b.y - geo.a.y, geo.b.x - geo.a.x)).toBeCloseTo(0.349, 9)
    // … and exactly on the vertical line, welded into it as a T-junction.
    expect(geo.b.x).toBe(140)
    expect(
      Object.values(doc.segments).filter((s) => s.endpoints.includes(drawn.endpoints[1])),
    ).toHaveLength(3)
  })

  it('a joint off the constrained ray still wins: the end welds rather than dangling', () => {
    const { tools, viewport, project } = setup()
    const snap = new SnapController(viewport)
    snap.toggles = { ...snap.toggles, grid: false, angle: false }
    tools.resolver = snap.resolver
    const drawTo = (from: Vec2, to: Vec2, shift: boolean) => {
      tools.activate('line')
      tools.pointerDown(from, { shift: false, alt: false })
      tools.pointerMove(to, { shift, alt: false })
      tools.pointerDown(to, { shift, alt: false })
      tools.handleKeyDown(key('Enter'))
      snap.updateScene(Object.values(project().segments))
    }
    const a0 = vec2(20, 60)
    const a1 = vec2(20 + Math.cos(0.349) * 60, 60 + Math.sin(0.349) * 60)
    drawTo(a0, a1, false)
    // An endpoint clearly off every ladder ray from a1.
    const joint = vec2(120, 130)
    drawTo(vec2(180, 200), joint, false)
    drawTo(a1, vec2(joint.x + 0.2, joint.y + 0.2), true)

    const doc = project()
    const jointNode = Object.entries(doc.nodes).find(
      ([, n]) => n.pos.x === joint.x && n.pos.y === joint.y,
    )?.[0]
    expect(jointNode).toBeDefined()
    // Both lines now meet at that node — landing on a joint beats keeping a round angle.
    expect(
      Object.values(doc.segments).filter((s) => s.endpoints.includes(jointNode!)),
    ).toHaveLength(2)
  })

  it('escape discards an in-progress gesture without a command', () => {
    const { tools, commands } = setup()
    tools.activate('line')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerDown(vec2(50, 0), { shift: false, alt: false })
    expect(tools.handleKeyDown(key('Escape'))).toBe(true)
    expect(commands).toHaveLength(0)
    expect(tools.active).toBe(false)
  })
})

describe('ToolController numeric entry', () => {
  it('builds a buffer from digit keys and commits an exact length (FR-2/FR-3)', () => {
    const { tools, project } = setup()
    tools.activate('line')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerMove(vec2(10, 0), { shift: false, alt: false })
    for (const d of '100') expect(tools.handleKeyDown(key(d))).toBe(true)
    expect(tools.numericBuffer).toBe('100')
    tools.handleKeyDown(key('Enter')) // applies the numeric length
    tools.handleKeyDown(key('Enter')) // finishes the chain

    const seg = Object.values(project().segments)[0]!
    const geo = seg.geometry as Line
    expect(distance(geo.a, geo.b)).toBeCloseTo(100, 9)
  })

  it('interprets a numeric length in the display unit', () => {
    const { tools, viewport, project } = setup()
    viewport.setUnit('in')
    tools.activate('line')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerMove(vec2(10, 0), { shift: false, alt: false })
    for (const d of '2') tools.handleKeyDown(key(d))
    tools.handleKeyDown(key('Enter'))
    tools.handleKeyDown(key('Enter'))

    const geo = Object.values(project().segments)[0]!.geometry as Line
    expect(distance(geo.a, geo.b)).toBeCloseTo(50.8, 6) // 2 inch = 50.8 mm
  })

  it('does not capture digits when no gesture is in progress', () => {
    const { tools } = setup()
    tools.activate('line')
    expect(tools.handleKeyDown(key('1'))).toBe(false)
    expect(tools.numericBuffer).toBe('')
  })
})

describe('ToolController mode cycling', () => {
  it('re-pressing the active tool key cycles its mode instead of restarting', () => {
    const { tools } = setup()
    tools.activate('arc')
    expect(tools.hint).toBe('arc: 3-point')
    tools.handleKeyDown(key('a')) // same tool, no gesture ⇒ cycle
    expect(tools.hint).toBe('arc: centre')
  })

  it('re-pressing a different tool key switches tools', () => {
    const { tools } = setup()
    tools.activate('arc')
    tools.handleKeyDown(key('l'))
    expect(tools.activeId).toBe('line')
  })
})

describe('ToolController border contour', () => {
  it('replaces the existing border with a new one (one contour, v1)', () => {
    const { tools, project } = setup()
    tools.activate('border')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerDown(vec2(300, 400), { shift: false, alt: false })
    let borders = Object.values(project().segments).filter((s) => s.role === 'border')
    expect(borders).toHaveLength(4)
    const firstIds = borders.map((s) => s.id).sort()

    // Draw a second border; the first is removed, not accumulated.
    tools.pointerDown(vec2(10, 10), { shift: false, alt: false })
    tools.pointerDown(vec2(200, 260), { shift: false, alt: false })
    borders = Object.values(project().segments).filter((s) => s.role === 'border')
    expect(borders).toHaveLength(4)
    const secondIds = borders.map((s) => s.id).sort()
    expect(secondIds).not.toEqual(firstIds)
  })
})

describe('ToolController command sink', () => {
  it('routes commits through the host execute so undo sees one gesture', () => {
    // Sanity: the command the controller builds is a real, applicable document command.
    const { tools, commands } = setup()
    tools.activate('line')
    tools.pointerDown(vec2(0, 0), { shift: false, alt: false })
    tools.pointerDown(vec2(10, 0), { shift: false, alt: false })
    tools.handleKeyDown(key('Enter'))
    const doc = commands[0]!.apply(createEmptyProject())
    expect(Object.keys(doc.segments)).toHaveLength(1)
    // The inverse restores the empty document.
    const restored = commands[0]!.invert(createEmptyProject()).apply(doc)
    expect(restored).toEqual(createEmptyProject())
  })
})
