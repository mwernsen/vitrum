import {
  createPanelProject,
  emptyPanelLibrary,
  panelEntryFor,
  recordPanelOpened,
  serializePanelLibrary,
  type LibraryPort,
  type PanelFacts,
  type Project,
} from '@vitrum/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { LibraryController } from './controller.svelte'
import LibraryScreen from './LibraryScreen.svelte'

const project = (name: string, technique: 'lead' | 'foil' = 'lead'): Project =>
  createPanelProject({ name, units: 'mm', widthMm: 300, heightMm: 400, technique })

const facts = (over: Partial<PanelFacts> = {}): PanelFacts => ({
  panes: 36,
  paintedPanes: 36,
  leadLengthMm: 8200,
  checksOutstanding: 0,
  checksRun: true,
  ...over,
})

/**
 * A controller over an in-memory port. `present` lists the paths that exist on disk — anything in the
 * library but not here reads as missing (FR-2). Thumbnails render as null, so the grid shows its
 * neutral placeholder, which is also what jsdom would produce anyway (FR-6).
 */
function controllerWith(
  entries: { path: string; project: Project; at: number; facts?: PanelFacts }[],
  present: string[] = entries.map((e) => e.path),
) {
  let library = emptyPanelLibrary()
  for (const e of entries) {
    library = recordPanelOpened(library, panelEntryFor(e.path, e.project, e.at, e.facts))
  }
  const stored = serializePanelLibrary(library)
  const openFile = vi.fn(async () => null)
  const port: LibraryPort = {
    load: async () => stored,
    save: async () => {},
    stat: async (paths) => paths.map((p) => (present.includes(p) ? 1000 : null)),
    loadThumbnail: async () => null,
    saveThumbnail: async () => {},
  }
  return {
    controller: new LibraryController({
      port,
      storage: { openFile, readFile: async () => null },
      renderThumbnail: async () => null,
    }),
    openFile,
  }
}

const noop = () => {}
const baseProps = { onNew: noop, onOpenFile: noop, onOpenEntry: noop }

describe('LibraryScreen — #2a chrome (FR-8)', () => {
  it('renders the header and the nav rail with only "Panels" live', async () => {
    const { controller } = controllerWith([])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps, glassCount: 42 })

    expect(screen.getByLabelText('Search panels')).toBeInTheDocument()

    const rail = screen.getByRole('navigation', { name: 'Library sections' })
    expect(rail).toHaveTextContent('Panels')
    // The four unbuilt destinations are present and visibly disabled — never silently absent.
    for (const label of ['Glass library', 'Cut lists', 'Versions', 'Settings']) {
      expect(rail).toHaveTextContent(label)
    }
    const disabled = rail.querySelectorAll('button:disabled')
    expect(disabled).toHaveLength(4)
    // Panels is the live one, and is not a button at all.
    expect(rail.querySelector('[aria-current="page"]')).toHaveTextContent('Panels')
    // Real counts, not the design's sample numbers.
    expect(rail).toHaveTextContent('42')
  })

  it('shows the lifecycle filters as inert, since the taxonomy is deferred to F-061', async () => {
    const { controller } = controllerWith([])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })
    const filters = screen.getByRole('group', { name: 'Panel status filter' })
    expect(filters).toHaveTextContent('Active')
    expect(filters.querySelectorAll('button:disabled')).toHaveLength(3)
  })
})

describe('LibraryScreen — the grid (FR-2)', () => {
  it('prompts when the library is empty', async () => {
    const { controller } = controllerWith([])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })
    expect(screen.getByTestId('library-empty')).toHaveTextContent('No panels yet')
    // …and still offers the way in.
    expect(screen.getByRole('button', { name: /Start a panel/ })).toBeInTheDocument()
  })

  it('lists panels other than the hero, newest first, and opens one on click', async () => {
    const onOpenEntry = vi.fn()
    const { controller } = controllerWith([
      { path: '/a.vitrum', project: project('Kitchen transom'), at: 100, facts: facts() },
      { path: '/b.vitrum', project: project('Art deco door pair'), at: 200, facts: facts() },
      { path: '/c.vitrum', project: project('Chapel lancet'), at: 300, facts: facts() },
    ])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps, onOpenEntry })

    // The newest is the hero, so the grid holds the other two.
    expect(screen.getByRole('button', { name: 'Open Kitchen transom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Art deco door pair' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Chapel lancet' })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Open Kitchen transom' }))
    expect(onOpenEntry).toHaveBeenCalledWith('/a.vitrum')
  })

  it('shows real indexed figures on a card, and the technique (FR-10)', async () => {
    const { controller } = controllerWith([
      { path: '/hero.vitrum', project: project('Hero'), at: 900, facts: facts() },
      {
        path: '/a.vitrum',
        project: project('Foil panel', 'foil'),
        at: 100,
        facts: facts({ panes: 84, leadLengthMm: 16_900 }),
      },
    ])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })
    expect(screen.getByText('84 panes · 16.9 m seam')).toBeInTheDocument()
    expect(screen.getByText(/Copper foil/)).toBeInTheDocument()
  })

  it('renders a card with no indexed figures rather than erroring (FR-10 back-compat)', async () => {
    const { controller } = controllerWith([
      { path: '/hero.vitrum', project: project('Hero'), at: 900, facts: facts() },
      { path: '/old.vitrum', project: project('Never saved'), at: 100 },
    ])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })
    expect(screen.getByRole('button', { name: 'Open Never saved' })).toBeInTheDocument()
    // The figures line is omitted rather than zeroed; the card still carries its real facts.
    expect(screen.queryByText(/0 panes/)).not.toBeInTheDocument()
    const card = screen.getByRole('button', { name: 'Open Never saved' }).closest('.card')!
    expect(card).toHaveTextContent('Lead came · 300.0 × 400.0 mm')
  })

  it('marks a vanished file missing, with locate and remove actions (FR-2)', async () => {
    const { controller, openFile } = controllerWith(
      [
        { path: '/hero.vitrum', project: project('Hero'), at: 900, facts: facts() },
        { path: '/gone.vitrum', project: project('Moved away'), at: 100 },
      ],
      ['/hero.vitrum'],
    )
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })

    expect(screen.getByText('File not found')).toBeInTheDocument()
    // A missing file is not clickable — its thumbnail is not an open button.
    expect(screen.queryByRole('button', { name: 'Open Moved away' })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Locate…' }))
    expect(openFile).toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove from library' }))
    await waitFor(() => expect(screen.queryByText('Moved away')).not.toBeInTheDocument())
  })
})

describe('LibraryScreen — the Continue hero (FR-9)', () => {
  it('leads with the most recently edited panel, its figures and its readiness pills', async () => {
    const { controller } = controllerWith([
      { path: '/old.vitrum', project: project('Older panel'), at: 100, facts: facts() },
      {
        path: '/live.vitrum',
        project: project('Rose window, south nave'),
        at: 500,
        facts: facts({ panes: 128, paintedPanes: 110, leadLengthMm: 24_600, checksOutstanding: 2 }),
      },
    ])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })

    const hero = screen.getByRole('region', { name: 'Continue' })
    expect(hero).toHaveTextContent('Rose window, south nave')
    expect(hero).toHaveTextContent('128 panes · 24.6 m came')
    expect(hero).toHaveTextContent('Geometry complete')
    expect(hero).toHaveTextContent('Glass 86%')
    expect(hero).toHaveTextContent('2 checks to review')
  })

  it('resumes and opens history through their own actions', async () => {
    const onOpenEntry = vi.fn()
    const onOpenHistory = vi.fn()
    const { controller } = controllerWith([
      { path: '/live.vitrum', project: project('Rose'), at: 500, facts: facts() },
    ])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps, onOpenEntry, onOpenHistory })

    await fireEvent.click(screen.getByRole('button', { name: 'Resume editing' }))
    expect(onOpenEntry).toHaveBeenCalledWith('/live.vitrum')
    await fireEvent.click(screen.getByRole('button', { name: 'Version history' }))
    expect(onOpenHistory).toHaveBeenCalledWith('/live.vitrum')
  })

  it('has no hero at all when there is no panel to resume — the empty state stands in', async () => {
    const { controller } = controllerWith([])
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })
    expect(screen.queryByRole('region', { name: 'Continue' })).not.toBeInTheDocument()
    expect(screen.getByTestId('library-empty')).toBeInTheDocument()
  })

  it('skips a missing file when choosing what to resume', async () => {
    const { controller } = controllerWith(
      [
        { path: '/here.vitrum', project: project('Still here'), at: 100, facts: facts() },
        { path: '/gone.vitrum', project: project('Vanished'), at: 900, facts: facts() },
      ],
      ['/here.vitrum'],
    )
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })
    expect(screen.getByRole('region', { name: 'Continue' })).toHaveTextContent('Still here')
  })
})

describe('LibraryScreen — search (FR-11)', () => {
  const three = () =>
    controllerWith([
      { path: '/hero.vitrum', project: project('Rose window'), at: 900, facts: facts() },
      { path: '/a.vitrum', project: project('Kitchen transom'), at: 200, facts: facts() },
      { path: '/b.vitrum', project: project('Art deco door pair'), at: 100, facts: facts() },
    ])

  it('filters the grid by name, case-insensitively', async () => {
    const { controller } = three()
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })

    await fireEvent.input(screen.getByLabelText('Search panels'), { target: { value: 'KITCHEN' } })
    expect(screen.getByRole('button', { name: 'Open Kitchen transom' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open Art deco door pair' }),
    ).not.toBeInTheDocument()
  })

  it('leaves the Continue hero in place while searching', async () => {
    const { controller } = three()
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })
    await fireEvent.input(screen.getByLabelText('Search panels'), { target: { value: 'kitchen' } })
    expect(screen.getByRole('region', { name: 'Continue' })).toHaveTextContent('Rose window')
  })

  it('distinguishes "no matches" from an empty library', async () => {
    const { controller } = three()
    await controller.init()
    render(LibraryScreen, { controller, ...baseProps })
    await fireEvent.input(screen.getByLabelText('Search panels'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('library-no-matches')).toHaveTextContent('No panels match')
    expect(screen.queryByTestId('library-empty')).not.toBeInTheDocument()
  })
})
