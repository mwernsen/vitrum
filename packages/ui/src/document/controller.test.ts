import { line, vec2 } from '@vitrum/geometry'
import { addSegment, createEmptyProject, createSegment, packDocument } from '@vitrum/model'
import type { Project } from '@vitrum/model'
import { afterEach, describe, expect, it } from 'vitest'

import { DocumentController } from './controller.svelte'
import { createFakeHost, type FakeHost } from './fakeHost'

/** Pack a project into the `.vitrum` zip bytes the storage port now carries (no assets). */
const pack = (project: Project): Uint8Array => packDocument(project, new Map())

let controller: DocumentController | undefined

afterEach(() => {
  controller?.dispose()
  controller = undefined
})

function setup(host: FakeHost = createFakeHost()) {
  controller = new DocumentController(host)
  return { host, controller }
}

describe('DocumentController', () => {
  it('starts empty and clean', () => {
    const { controller } = setup()
    expect(controller.segmentCount).toBe(0)
    expect(controller.canUndo).toBe(false)
    expect(controller.isDirty).toBe(false)
  })

  it('adds segments and drives undo/redo through the store', () => {
    const { controller } = setup()
    controller.addDebugSegment()
    controller.addDebugSegment()
    expect(controller.segmentCount).toBe(2)
    expect(controller.canUndo).toBe(true)
    expect(controller.isDirty).toBe(true)

    controller.undo()
    expect(controller.segmentCount).toBe(1)
    expect(controller.canRedo).toBe(true)

    controller.redo()
    expect(controller.segmentCount).toBe(2)
  })

  it('derives pieces and diagnostics from the live network (F-020)', () => {
    const { controller } = setup()
    const corners = [vec2(0, 0), vec2(100, 0), vec2(100, 100), vec2(0, 100)]
    for (let i = 0; i < 4; i++) {
      controller.execute(addSegment(createSegment(line(corners[i]!, corners[(i + 1) % 4]!))))
    }
    const result = controller.detect()
    expect(result.pieces).toHaveLength(1)
    expect(result.pieces[0]!.area).toBeCloseTo(10000, 3)
    expect(result.diagnostics).toHaveLength(0)

    // A spur adds a dangling-end diagnostic without changing the detected piece count.
    controller.execute(addSegment(createSegment(line(vec2(100, 100), vec2(150, 150)))))
    const withSpur = controller.detect()
    expect(withSpur.pieces).toHaveLength(1)
    expect(withSpur.diagnostics.some((d) => d.kind === 'dangling-end')).toBe(true)
  })

  it('reports dirty state to the host', () => {
    const { host, controller } = setup()
    expect(host.dirty).toBe(false)
    controller.addDebugSegment()
    expect(host.dirty).toBe(true)
  })

  it('save with no path falls back to save-as, then saves in place', async () => {
    const { host, controller } = setup()
    controller.addDebugSegment()

    await controller.save() // no path yet -> save-as dialog
    expect(controller.currentPath).toBe('/tmp/design.vitrum')
    expect(controller.isDirty).toBe(false)
    expect(host.files.get('/tmp/design.vitrum')).toBeTruthy()
    expect(host.autosave).toBeNull()

    controller.addDebugSegment()
    expect(controller.isDirty).toBe(true)
    await controller.save() // saves in place, no second dialog
    expect(controller.isDirty).toBe(false)
  })

  it('cancelling save-as leaves the document dirty and unsaved', async () => {
    const { host, controller } = setup()
    host.nextSaveAsPath = null
    controller.addDebugSegment()
    await controller.saveAs()
    expect(controller.currentPath).toBeNull()
    expect(controller.isDirty).toBe(true)
  })

  it('opens a file, replacing the document and clearing history', async () => {
    const { host, controller } = setup()
    const project = { ...createEmptyProject({ name: 'Opened' }) }
    host.nextOpen = { path: '/tmp/opened.vitrum', contents: pack(project) }

    controller.addDebugSegment()
    await controller.open()

    expect(controller.doc.settings.name).toBe('Opened')
    expect(controller.currentPath).toBe('/tmp/opened.vitrum')
    expect(controller.canUndo).toBe(false)
    expect(controller.isDirty).toBe(false)
  })

  it('respects a declined discard prompt when opening', async () => {
    const { host, controller } = setup()
    host.discardAnswer = false
    host.nextOpen = { path: '/x', contents: pack(createEmptyProject({ name: 'Nope' })) }
    controller.addDebugSegment()
    await controller.open()
    expect(controller.doc.settings.name).not.toBe('Nope')
    expect(controller.segmentCount).toBe(1)
  })

  it('routes menu actions to the matching command', () => {
    const { host, controller } = setup()
    host.emitMenu('undo') // nothing to undo yet — safe no-op
    controller.addDebugSegment()
    host.emitMenu('undo')
    expect(controller.segmentCount).toBe(0)
    host.emitMenu('redo')
    expect(controller.segmentCount).toBe(1)
    host.emitMenu('togglePalette')
    expect(controller.paletteOpen).toBe(true)
  })

  it('recovers a snapshot as an unsaved document', () => {
    const { controller } = setup()
    const snapshot = pack(createEmptyProject({ name: 'Recovered' }))
    controller.recover(snapshot)
    expect(controller.doc.settings.name).toBe('Recovered')
    expect(controller.currentPath).toBeNull()
  })
})
