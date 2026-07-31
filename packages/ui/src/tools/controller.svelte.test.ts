import { makeViewport } from '@vitrum/core'
import { distance, vec2, type Line } from '@vitrum/geometry'
import { createEmptyProject, type Command, type Project } from '@vitrum/model'
import { afterEach, describe, expect, it } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'

import { ToolController } from './controller.svelte'

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
