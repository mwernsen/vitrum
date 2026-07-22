import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { projectArb } from './arbitraries'
import { addSegment } from './commands'
import { createSegment } from './factory'
import { line, vec2 } from '@vitrum/geometry'
import { createEmptyProject } from './types'
import type { Project } from './types'
import {
  addSnapshot,
  applyProjectDelta,
  deleteSnapshot,
  deserializeArchive,
  diffProject,
  editableCopy,
  emptyArchive,
  isReadOnly,
  listSnapshots,
  pruneArchive,
  renameSnapshot,
  resolveSnapshot,
  serializeArchive,
  sharedProject,
  type VersionArchive,
} from './versions'

/** A project with `n` lead segments, so heavy-session tests have realistic bulk. */
function projectWithSegments(n: number): Project {
  let doc = createEmptyProject({ name: 'heavy' })
  for (let i = 0; i < n; i++) {
    doc = addSegment(createSegment(line(vec2(i, 0), vec2(i, 10)))).apply(doc)
  }
  return doc
}

/** Add `n` snapshots, mutating the document a little each time so deltas are non-trivial. */
function sessionOf(
  n: number,
  base = projectWithSegments(200),
): { archive: VersionArchive; docs: Project[] } {
  let archive = emptyArchive()
  const docs: Project[] = []
  let doc = base
  for (let i = 0; i < n; i++) {
    doc = addSegment(createSegment(line(vec2(1000 + i, 0), vec2(1000 + i, 5)))).apply(doc)
    docs.push(doc)
    archive = addSnapshot(archive, doc, { id: `snap-${i}`, createdAt: 1_000 + i, kind: 'auto' })
  }
  return { archive, docs }
}

describe('structural delta (FR-2)', () => {
  it('applyProjectDelta(a, diff(a, b)) reproduces b exactly', () => {
    fc.assert(
      fc.property(projectArb, projectArb, (a, b) => {
        const restored = applyProjectDelta(a, diffProject(a, b))
        expect(restored).toEqual(b)
      }),
    )
  })

  it('diffing a project against itself round-trips to an equal project', () => {
    fc.assert(
      fc.property(projectArb, (a) => {
        expect(applyProjectDelta(a, diffProject(a, a))).toEqual(a)
      }),
    )
  })
})

describe('archive resolve & round-trip (FR-1/FR-2)', () => {
  it('resolves every snapshot of a >= 50-snapshot session exactly', () => {
    const { archive, docs } = sessionOf(55)
    expect(listSnapshots(archive)).toHaveLength(55)
    docs.forEach((doc, i) => {
      expect(resolveSnapshot(archive, `snap-${i}`)).toEqual(doc)
    })
  })

  it('survives a serialize -> deserialize round-trip', () => {
    const { archive, docs } = sessionOf(55)
    const restored = deserializeArchive(serializeArchive(archive))
    docs.forEach((doc, i) => {
      expect(resolveSnapshot(restored, `snap-${i}`)).toEqual(doc)
    })
  })

  it('returns null for an unknown snapshot id', () => {
    const { archive } = sessionOf(3)
    expect(resolveSnapshot(archive, 'nope')).toBeNull()
  })
})

describe('delete keeps survivors resolvable (FR-5)', () => {
  it('deleting a keyframe still resolves every remaining snapshot', () => {
    const { archive, docs } = sessionOf(25)
    // snap-0, snap-10, snap-20 are keyframes; delete one that later deltas depended on.
    const pruned = deleteSnapshot(archive, 'snap-10')
    expect(listSnapshots(pruned)).toHaveLength(24)
    for (let i = 0; i < 25; i++) {
      if (i === 10) {
        expect(resolveSnapshot(pruned, `snap-${i}`)).toBeNull()
      } else {
        expect(resolveSnapshot(pruned, `snap-${i}`)).toEqual(docs[i])
      }
    }
  })
})

describe('pruning (FR-4)', () => {
  it('keeps every manual version and the most recent auto snapshots', () => {
    let archive = emptyArchive()
    let doc = projectWithSegments(50)
    for (let i = 0; i < 40; i++) {
      doc = addSegment(createSegment(line(vec2(i, 100), vec2(i, 110)))).apply(doc)
      const kind = i % 10 === 0 ? 'manual' : 'auto'
      archive = addSnapshot(archive, doc, {
        id: `s-${i}`,
        createdAt: i,
        kind,
        ...(kind === 'manual' ? { label: `v${i}` } : {}),
      })
    }
    const pruned = pruneArchive(archive, 10)
    const metas = listSnapshots(pruned)
    const manual = metas.filter((m) => m.kind === 'manual')
    const auto = metas.filter((m) => m.kind === 'auto')
    // All 4 manual versions kept; auto capped at 10.
    expect(manual).toHaveLength(4)
    expect(auto).toHaveLength(10)
    // Every survivor still resolves.
    for (const m of metas) expect(resolveSnapshot(pruned, m.id)).not.toBeNull()
  })

  it('is a no-op when auto snapshots are within budget', () => {
    const { archive } = sessionOf(5)
    expect(pruneArchive(archive, 50)).toBe(archive)
  })
})

describe('storage budget (FR-4)', () => {
  it('a 60-snapshot heavy session serializes well under 50 MB', () => {
    const { archive } = sessionOf(60, projectWithSegments(2000))
    const bytes = serializeArchive(archive)
    expect(bytes.byteLength).toBeLessThan(50 * 1024 * 1024)
    // Sanity: deltas make it far smaller than 60 full copies would be.
    expect(bytes.byteLength).toBeLessThan(5 * 1024 * 1024)
  })
})

describe('rename (FR-3/FR-5)', () => {
  it('updates label and note without touching the resolved document', () => {
    const { archive, docs } = sessionOf(3)
    const renamed = renameSnapshot(archive, 'snap-1', { label: 'client draft 2', note: 'sent Tue' })
    const meta = listSnapshots(renamed).find((m) => m.id === 'snap-1')!
    expect(meta.label).toBe('client draft 2')
    expect(meta.note).toBe('sent Tue')
    expect(resolveSnapshot(renamed, 'snap-1')).toEqual(docs[1])
  })

  it('clearing the label drops it', () => {
    const { archive } = sessionOf(2)
    const named = renameSnapshot(archive, 'snap-0', { label: 'x' })
    const cleared = renameSnapshot(named, 'snap-0', { label: '' })
    expect(listSnapshots(cleared).find((m) => m.id === 'snap-0')!.label).toBeUndefined()
  })
})

describe('sharing (FR-7/FR-8)', () => {
  it('sharedProject sets the read-only flag and trims the note', () => {
    const doc = createEmptyProject({ name: 'x' })
    const shared = sharedProject(doc, '  client draft  ')
    expect(isReadOnly(shared)).toBe(true)
    expect(shared.settings.shareNote).toBe('client draft')
    expect(isReadOnly(doc)).toBe(false)
  })

  it('omits an empty note', () => {
    const shared = sharedProject(createEmptyProject(), '   ')
    expect(shared.settings.shareNote).toBeUndefined()
  })

  it('editableCopy drops the read-only flag and note', () => {
    const shared = sharedProject(createEmptyProject({ name: 'x' }), 'note')
    const copy = editableCopy(shared)
    expect(isReadOnly(copy)).toBe(false)
    expect(copy.settings.shareNote).toBeUndefined()
    expect(copy.settings.name).toBe('x')
  })
})
