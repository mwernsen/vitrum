import { line, vec2 } from '@vitrum/geometry'
import { addSegment, createEmptyProject, createSegment, type Project } from '@vitrum/model'
import { describe, expect, it, vi } from 'vitest'

import { createFakeHost, type FakeHost } from '../document/fakeHost'

import { VersionController, type VersionControllerDeps } from './controller.svelte'

/** Let fire-and-forget persistence microtasks settle. */
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(over: Partial<VersionControllerDeps> = {}): {
  ctrl: VersionController
  host: FakeHost
  setDoc: (p: Project) => void
  restored: Project[]
  copied: Project[]
  tick: (ms: number) => void
} {
  const host = createFakeHost()
  let doc = createEmptyProject({ name: 'test' })
  let clock = 1000
  let idc = 0
  const restored: Project[] = []
  const copied: Project[] = []
  const ctrl = new VersionController({
    getDoc: () => doc,
    restore: (p) => restored.push(p),
    openCopy: (p) => copied.push(p),
    port: host.versionStore,
    now: () => clock,
    newId: () => `id-${idc++}`,
    renderThumbnail: async () => null,
    ...over,
  })
  return {
    ctrl,
    host,
    setDoc: (p) => {
      doc = p
    },
    restored,
    copied,
    tick: (ms) => {
      clock += ms
    },
  }
}

function withSegment(doc: Project, x: number): Project {
  return addSegment(createSegment(line(vec2(x, 0), vec2(x, 10)))).apply(doc)
}

describe('VersionController auto-snapshots (FR-1)', () => {
  it('takes an automatic snapshot after the command threshold', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    s.setDoc(withSegment(createEmptyProject({ name: 'test' }), 1))
    for (let i = 0; i < 23; i++) s.ctrl.onChange(true)
    expect(s.ctrl.snapshots).toHaveLength(0)
    s.ctrl.onChange(true) // 24th change crosses the threshold
    expect(s.ctrl.snapshots).toHaveLength(1)
    expect(s.ctrl.snapshots[0]!.kind).toBe('auto')
    await flush()
    expect(s.host.versionArchives.get('scratch')).toBeDefined()
  })

  it('does not snapshot while the document is unchanged since the last snapshot', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    await s.ctrl.saveVersion('base')
    expect(s.ctrl.snapshots).toHaveLength(1)
    // The document never changes; crossing the command threshold must not add a snapshot.
    for (let i = 0; i < 30; i++) s.ctrl.onChange(true)
    expect(s.ctrl.snapshots).toHaveLength(1)
  })

  it('does not snapshot while the document is clean', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    s.setDoc(withSegment(createEmptyProject(), 1))
    for (let i = 0; i < 40; i++) s.ctrl.onChange(false)
    expect(s.ctrl.snapshots).toHaveLength(0)
  })

  it('takes an automatic snapshot once the time threshold elapses', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    s.setDoc(withSegment(createEmptyProject(), 2))
    s.tick(120_000) // > 90 s since baseline
    s.ctrl.onChange(true)
    expect(s.ctrl.snapshots).toHaveLength(1)
  })
})

describe('VersionController manual versions (FR-3)', () => {
  it('saves a named version with a note and persists it', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    await s.ctrl.saveVersion('client draft 2', 'sent for review')
    expect(s.ctrl.snapshots).toHaveLength(1)
    expect(s.ctrl.snapshots[0]).toMatchObject({
      kind: 'manual',
      label: 'client draft 2',
      note: 'sent for review',
    })
    expect(s.host.versionArchives.get('scratch')).toBeDefined()
  })

  it('reloads persisted history for the same document key', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    await s.ctrl.saveVersion('v1')
    // A fresh controller sharing the host reads the persisted archive.
    const host = s.host
    const ctrl2 = new VersionController({
      getDoc: () => createEmptyProject(),
      restore: () => {},
      openCopy: () => {},
      port: host.versionStore,
    })
    await ctrl2.useDocument(null)
    expect(ctrl2.snapshots.map((m) => m.label)).toContain('v1')
  })
})

describe('VersionController restore / open copy (FR-2)', () => {
  it('restores a snapshot to the exact captured document', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    const captured = withSegment(createEmptyProject({ name: 'test' }), 5)
    s.setDoc(captured)
    await s.ctrl.saveVersion('has a segment')
    // Move on to a different document, then restore.
    s.setDoc(createEmptyProject({ name: 'test' }))
    const id = s.ctrl.snapshots[0]!.id
    expect(s.ctrl.restore(id)).toBe(true)
    expect(s.restored).toHaveLength(1)
    expect(s.restored[0]).toEqual(captured)
  })

  it('opens a snapshot as a copy without restoring in place', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    await s.ctrl.saveVersion('v')
    const id = s.ctrl.snapshots[0]!.id
    expect(s.ctrl.openCopy(id)).toBe(true)
    expect(s.copied).toHaveLength(1)
    expect(s.restored).toHaveLength(0)
  })

  it('returns false for an unknown id', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    expect(s.ctrl.restore('nope')).toBe(false)
  })
})

describe('VersionController rename / delete (FR-5)', () => {
  it('renames and deletes versions', async () => {
    const s = setup()
    await s.ctrl.useDocument(null)
    await s.ctrl.saveVersion('a')
    const id = s.ctrl.snapshots[0]!.id
    await s.ctrl.rename(id, { label: 'renamed', note: 'why' })
    expect(s.ctrl.snapshots[0]).toMatchObject({ label: 'renamed', note: 'why' })
    await s.ctrl.remove(id)
    expect(s.ctrl.snapshots).toHaveLength(0)
  })
})

describe('VersionController thumbnails (FR-6)', () => {
  it('returns null then caches a rendered thumbnail as a data URL', async () => {
    const png = new Uint8Array([137, 80, 78, 71]) // "PNG" magic-ish bytes
    const s = setup({ renderThumbnail: vi.fn(async () => png) })
    await s.ctrl.useDocument(null)
    await s.ctrl.saveVersion('v')
    const id = s.ctrl.snapshots[0]!.id
    s.ctrl.requestThumbnail(id) // kicks off the lazy render
    expect(s.ctrl.thumbnailUrl(id)).toBeNull()
    await flush()
    expect(s.ctrl.thumbnailUrl(id)).toMatch(/^data:image\/png;base64,/)
    // Cached to the port for reuse.
    expect(s.host.versionThumbnails.get(`scratch/${id}`)).toEqual(png)
  })

  it('degrades to a placeholder (null) when rendering is unavailable', async () => {
    const s = setup({ renderThumbnail: async () => null })
    await s.ctrl.useDocument(null)
    await s.ctrl.saveVersion('v')
    const id = s.ctrl.snapshots[0]!.id
    s.ctrl.requestThumbnail(id)
    expect(s.ctrl.thumbnailUrl(id)).toBeNull()
    await flush()
    expect(s.ctrl.thumbnailUrl(id)).toBeNull()
  })
})
