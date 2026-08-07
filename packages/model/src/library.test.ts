import { describe, expect, it } from 'vitest'

import {
  createPanelProject,
  deserializePanelLibrary,
  emptyPanelLibrary,
  forgetPanel,
  MAX_LIBRARY_ENTRIES,
  panelEntryFor,
  panelMatches,
  panelThumbnailKey,
  recordPanelOpened,
  relocatePanel,
  serializePanelLibrary,
  type PanelEntry,
  type PanelFacts,
} from './library'
import { createEmptyProject } from './types'

const facts = (over: Partial<PanelFacts> = {}): PanelFacts => ({
  panes: 36,
  paintedPanes: 30,
  leadLengthMm: 8200,
  checksOutstanding: 2,
  checksRun: true,
  ...over,
})

const entry = (path: string, at: number, over: Partial<PanelEntry> = {}): PanelEntry => ({
  path,
  name: path,
  units: 'mm',
  technique: 'lead',
  lastOpenedAt: at,
  ...over,
})

describe('panel library — recents store (F-058 FR-7)', () => {
  it('starts empty', () => {
    expect(emptyPanelLibrary().entries).toEqual([])
  })

  it('puts the most recently opened panel first', () => {
    let lib = emptyPanelLibrary()
    lib = recordPanelOpened(lib, entry('/a.vitrum', 1))
    lib = recordPanelOpened(lib, entry('/b.vitrum', 2))
    expect(lib.entries.map((e) => e.path)).toEqual(['/b.vitrum', '/a.vitrum'])
  })

  it('re-opening a panel moves it to the front with refreshed metadata, never duplicating it', () => {
    let lib = emptyPanelLibrary()
    lib = recordPanelOpened(lib, entry('/a.vitrum', 1, { name: 'Old name' }))
    lib = recordPanelOpened(lib, entry('/b.vitrum', 2))
    lib = recordPanelOpened(lib, entry('/a.vitrum', 3, { name: 'New name' }))
    expect(lib.entries.map((e) => e.path)).toEqual(['/a.vitrum', '/b.vitrum'])
    expect(lib.entries[0]!.name).toBe('New name')
    expect(lib.entries[0]!.lastOpenedAt).toBe(3)
  })

  it('caps the list and evicts the oldest-opened entry', () => {
    let lib = emptyPanelLibrary()
    for (let i = 0; i < MAX_LIBRARY_ENTRIES + 5; i++) {
      lib = recordPanelOpened(lib, entry(`/p${i}.vitrum`, i))
    }
    expect(lib.entries).toHaveLength(MAX_LIBRARY_ENTRIES)
    expect(lib.entries[0]!.path).toBe(`/p${MAX_LIBRARY_ENTRIES + 4}.vitrum`)
    // The five oldest fell off the end.
    expect(lib.entries.some((e) => e.path === '/p4.vitrum')).toBe(false)
    expect(lib.entries.at(-1)!.path).toBe('/p5.vitrum')
  })

  it('forgets an entry without touching the others', () => {
    let lib = emptyPanelLibrary()
    lib = recordPanelOpened(lib, entry('/a.vitrum', 1))
    lib = recordPanelOpened(lib, entry('/b.vitrum', 2))
    lib = forgetPanel(lib, '/a.vitrum')
    expect(lib.entries.map((e) => e.path)).toEqual(['/b.vitrum'])
    expect(forgetPanel(lib, '/nope.vitrum').entries).toHaveLength(1)
  })

  describe('locate → rebind (FR-2)', () => {
    it('rebinds the entry to the new path, keeping its metadata and position', () => {
      let lib = emptyPanelLibrary()
      lib = recordPanelOpened(lib, entry('/gone.vitrum', 1, { name: 'Rose' }))
      lib = recordPanelOpened(lib, entry('/b.vitrum', 2))
      lib = relocatePanel(lib, '/gone.vitrum', '/moved/rose.vitrum')
      expect(lib.entries.map((e) => e.path)).toEqual(['/b.vitrum', '/moved/rose.vitrum'])
      expect(lib.entries[1]!.name).toBe('Rose')
    })

    it('absorbs an existing entry at the destination rather than duplicating it', () => {
      let lib = emptyPanelLibrary()
      lib = recordPanelOpened(lib, entry('/here.vitrum', 1, { name: 'Already listed' }))
      lib = recordPanelOpened(lib, entry('/gone.vitrum', 2, { name: 'Rose' }))
      lib = relocatePanel(lib, '/gone.vitrum', '/here.vitrum')
      expect(lib.entries.map((e) => e.path)).toEqual(['/here.vitrum'])
      expect(lib.entries[0]!.name).toBe('Rose')
    })

    it('is a no-op when the path did not change', () => {
      const lib = recordPanelOpened(emptyPanelLibrary(), entry('/a.vitrum', 1))
      expect(relocatePanel(lib, '/a.vitrum', '/a.vitrum')).toBe(lib)
    })
  })

  it('round-trips through JSON', () => {
    let lib = emptyPanelLibrary()
    lib = recordPanelOpened(
      lib,
      entry('/a.vitrum', 7, { widthMm: 300, heightMm: 400, units: 'in', technique: 'foil' }),
    )
    expect(deserializePanelLibrary(serializePanelLibrary(lib))).toEqual(lib)
  })

  it('never throws on a corrupt or foreign store (FR-7 — startup must not break)', () => {
    expect(deserializePanelLibrary('not json').entries).toEqual([])
    expect(deserializePanelLibrary('null').entries).toEqual([])
    expect(deserializePanelLibrary('{"entries":"nope"}').entries).toEqual([])
    // A malformed entry is dropped; well-formed neighbours survive, with defaults filled in.
    const lib = deserializePanelLibrary(
      '{"entries":[{"nope":1},{"path":"/a.vitrum"},{"path":"","name":"x"}]}',
    )
    expect(lib.entries).toEqual([
      {
        path: '/a.vitrum',
        name: 'Untitled panel',
        units: 'mm',
        technique: 'lead',
        lastOpenedAt: 0,
      },
    ])
  })
})

describe('save-time index (FR-10)', () => {
  const project = () =>
    createPanelProject({
      name: 'Rose',
      units: 'mm',
      widthMm: 300,
      heightMm: 400,
      technique: 'lead',
    })

  it('captures the derived figures and stamps a save time only on the save path', () => {
    const saved = panelEntryFor('/a.vitrum', project(), 500, facts())
    expect(saved.facts).toEqual(facts())
    expect(saved.lastSavedAt).toBe(500)

    // Merely opening must not claim the panel was edited.
    const opened = panelEntryFor('/a.vitrum', project(), 500)
    expect(opened.facts).toBeUndefined()
    expect(opened.lastSavedAt).toBeUndefined()
  })

  it('keeps indexed figures when the panel is later re-opened without saving', () => {
    let lib = recordPanelOpened(
      emptyPanelLibrary(),
      panelEntryFor('/a.vitrum', project(), 100, facts()),
    )
    lib = recordPanelOpened(lib, panelEntryFor('/a.vitrum', project(), 200))
    expect(lib.entries[0]!.lastOpenedAt).toBe(200)
    expect(lib.entries[0]!.lastSavedAt).toBe(100)
    expect(lib.entries[0]!.facts).toEqual(facts())
  })

  it('replaces the figures on the next save', () => {
    let lib = recordPanelOpened(
      emptyPanelLibrary(),
      panelEntryFor('/a.vitrum', project(), 100, facts()),
    )
    lib = recordPanelOpened(
      lib,
      panelEntryFor('/a.vitrum', project(), 300, facts({ panes: 84, checksOutstanding: 0 })),
    )
    expect(lib.entries[0]!.facts).toEqual(facts({ panes: 84, checksOutstanding: 0 }))
    expect(lib.entries[0]!.lastSavedAt).toBe(300)
  })

  it('round-trips the figures through JSON', () => {
    const lib = recordPanelOpened(
      emptyPanelLibrary(),
      panelEntryFor('/a.vitrum', project(), 7, facts()),
    )
    expect(deserializePanelLibrary(serializePanelLibrary(lib))).toEqual(lib)
  })

  it('reads an entry written by a build with no index, rather than erroring (FR-10 back-compat)', () => {
    const legacy = '{"entries":[{"path":"/old.vitrum","name":"Old","lastOpenedAt":5}]}'
    const entry = deserializePanelLibrary(legacy).entries[0]!
    expect(entry.name).toBe('Old')
    expect(entry.facts).toBeUndefined()
    expect(entry.lastSavedAt).toBeUndefined()
  })

  it('drops a half-written facts block wholesale rather than trusting part of it', () => {
    const partial = '{"entries":[{"path":"/a.vitrum","facts":{"panes":36,"paintedPanes":30}}]}'
    expect(deserializePanelLibrary(partial).entries[0]!.facts).toBeUndefined()
    const nonsense = '{"entries":[{"path":"/a.vitrum","facts":"lots"}]}'
    expect(deserializePanelLibrary(nonsense).entries[0]!.facts).toBeUndefined()
  })
})

describe('panelMatches — search (FR-11)', () => {
  const rose = entry('/panels/rose-window.vitrum', 1, { name: 'Rose window, south nave' })

  it('matches everything on a blank or whitespace query', () => {
    expect(panelMatches(rose, '')).toBe(true)
    expect(panelMatches(rose, '   ')).toBe(true)
  })

  it('matches the name case-insensitively, anywhere in it', () => {
    expect(panelMatches(rose, 'rose')).toBe(true)
    expect(panelMatches(rose, 'SOUTH')).toBe(true)
    expect(panelMatches(rose, 'nave')).toBe(true)
    expect(panelMatches(rose, 'transom')).toBe(false)
  })

  it('also matches the file name, so a panel found by where it lives still matches', () => {
    expect(panelMatches(entry('/x/kitchen.vitrum', 1, { name: 'Untitled' }), 'kitchen')).toBe(true)
    // …but not the rest of the path, which would match far too much.
    expect(panelMatches(entry('/panels/a.vitrum', 1, { name: 'A' }), 'panels')).toBe(false)
  })
})

describe('panelEntryFor', () => {
  it('describes a document from its settings and technique', () => {
    const project = createPanelProject({
      name: 'Chapel light',
      units: 'in',
      widthMm: 304.8,
      heightMm: 609.6,
      technique: 'foil',
    })
    expect(panelEntryFor('/c.vitrum', project, 42)).toEqual({
      path: '/c.vitrum',
      name: 'Chapel light',
      units: 'in',
      widthMm: 304.8,
      heightMm: 609.6,
      technique: 'foil',
      lastOpenedAt: 42,
    })
  })

  it('omits the size for a document with no panel extent, and names an untitled one', () => {
    const e = panelEntryFor('/u.vitrum', createEmptyProject({ name: '' }), 1)
    expect(e.widthMm).toBeUndefined()
    expect(e.name).toBe('Untitled panel')
  })
})

describe('panelThumbnailKey (FR-6)', () => {
  it('keys on path and modification time, so an edited file re-renders', () => {
    const a = panelThumbnailKey('/panels/rose.vitrum', 1000)
    expect(a).toBe(panelThumbnailKey('/panels/rose.vitrum', 1000))
    expect(a).not.toBe(panelThumbnailKey('/panels/rose.vitrum', 2000))
    expect(a).not.toBe(panelThumbnailKey('/panels/other.vitrum', 1000))
  })

  it('is filesystem-safe and rounds a fractional mtime', () => {
    expect(panelThumbnailKey('/a b/c.vitrum', 12.7)).toBe('_a_b_c.vitrum@13')
  })
})

describe('createPanelProject (FR-3)', () => {
  it('applies the chosen settings and technique, leaving every other block at its default', () => {
    const project = createPanelProject({
      name: 'Rose',
      units: 'mm',
      widthMm: 300,
      heightMm: 400,
      technique: 'foil',
    })
    expect(project.settings.name).toBe('Rose')
    expect(project.settings.units).toBe('mm')
    expect(project.settings.panelSize).toEqual({ width: 300, height: 400 })
    expect(project.technique.kind).toBe('foil')
    expect(project.segments).toEqual({})
    expect(project.assignments).toEqual({})
    // Everything the dialog does not ask about matches a plain empty project.
    const strip = (p: ReturnType<typeof createEmptyProject>) => ({
      ...p,
      settings: undefined,
      technique: undefined,
    })
    expect(strip(project)).toEqual(strip(createEmptyProject()))
  })

  it('defaults to lead came', () => {
    const project = createPanelProject({
      name: 'A',
      units: 'mm',
      widthMm: 1,
      heightMm: 1,
      technique: 'lead',
    })
    expect(project.technique.kind).toBe('lead')
  })
})
