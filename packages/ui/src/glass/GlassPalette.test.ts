import { render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Glass } from '@vitrum/model'

import GlassPalette from './GlassPalette.svelte'
import type { GlassScopeActions } from './types'

const g = (over: Partial<Glass> & { id: string; name: string }): Glass => ({
  color: '#3a7bd5',
  transparency: 'transparent',
  texture: 'smooth',
  thicknessMm: 3,
  ...over,
})

const library: Glass[] = [
  g({
    id: 'ruby',
    name: 'Ruby cathedral',
    color: '#9b1b26',
    transparency: 'transparent',
    texture: 'smooth',
  }),
  g({
    id: 'emerald',
    name: 'Emerald cathedral',
    color: '#1f7a4d',
    transparency: 'transparent',
    texture: 'seedy',
  }),
  g({
    id: 'navy',
    name: 'Navy opaque',
    color: '#22335f',
    transparency: 'opaque',
    texture: 'granite',
  }),
]

function actions(): GlassScopeActions {
  return { upsert: vi.fn(), remove: vi.fn(), duplicate: vi.fn(), newId: () => 'new-id' }
}

describe('GlassPalette (F-022)', () => {
  it('lists library glasses with their swatches', () => {
    render(GlassPalette, { library, libraryActions: actions() })
    expect(screen.getByText('Ruby cathedral')).toBeInTheDocument()
    expect(screen.getByText('Emerald cathedral')).toBeInTheDocument()
    expect(screen.getByTestId('glass-count')).toHaveTextContent('3 of 3')
  })

  // The enclosing DockPanel header already names the open section, so a "Glass" heading here read
  // as the same word twice, ~100px apart (user test run 2026-07-29-a).
  it('names the region without repeating the section label as a heading', () => {
    render(GlassPalette, { library, libraryActions: actions() })
    expect(screen.getByRole('region', { name: 'Glass palette' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Glass' })).not.toBeInTheDocument()
  })

  it('filters by free-text search (FR-3)', async () => {
    const user = userEvent.setup()
    render(GlassPalette, { library, libraryActions: actions() })
    await user.type(screen.getByPlaceholderText('Search glass…'), 'ruby')
    expect(screen.getByTestId('glass-count')).toHaveTextContent('1 of 3')
    expect(screen.getByText('Ruby cathedral')).toBeInTheDocument()
    expect(screen.queryByText('Emerald cathedral')).not.toBeInTheDocument()
  })

  it('filters by transparency facet (FR-3)', async () => {
    const user = userEvent.setup()
    render(GlassPalette, { library, libraryActions: actions() })
    // The transparency select is the second combobox (after hue).
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[1]!, 'opaque')
    expect(screen.getByTestId('glass-count')).toHaveTextContent('1 of 3')
    expect(screen.getByText('Navy opaque')).toBeInTheDocument()
  })

  it('creates a new glass through the editor dialog', async () => {
    const user = userEvent.setup()
    const libraryActions = actions()
    render(GlassPalette, { library, libraryActions })

    await user.click(screen.getByRole('button', { name: 'New glass' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Sunburst')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(libraryActions.upsert).toHaveBeenCalledTimes(1)
    const created = (libraryActions.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Glass
    expect(created.name).toBe('Sunburst')
    expect(created.id).toBe('new-id')
  })

  it('previews the glass being created, tracking the texture and transparency picked', async () => {
    const user = userEvent.setup()
    render(GlassPalette, { library, libraryActions: actions() })

    await user.click(screen.getByRole('button', { name: 'New glass' }))
    const dialog = screen.getByRole('dialog')
    // The preview names what it is showing, so the picked surface is described, not just drawn.
    expect(
      within(dialog).getByRole('img', { name: 'Preview of transparent smooth glass' }),
    ).toBeInTheDocument()

    const [transparency, texture] = within(dialog).getAllByRole('combobox')
    await user.selectOptions(texture!, 'hammered')
    await user.selectOptions(transparency!, 'opalescent')
    expect(
      within(dialog).getByRole('img', { name: 'Preview of opalescent hammered glass' }),
    ).toBeInTheDocument()
  })

  it('edits an existing glass and reports the change', async () => {
    const user = userEvent.setup()
    const libraryActions = actions()
    render(GlassPalette, { library, libraryActions })

    await user.click(screen.getByRole('button', { name: 'Ruby cathedral' }))
    const dialog = screen.getByRole('dialog')
    const nameField = within(dialog).getByLabelText('Name')
    await user.clear(nameField)
    await user.type(nameField, 'Ruby streaky')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(libraryActions.upsert).toHaveBeenCalledTimes(1)
    const saved = (libraryActions.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Glass
    expect(saved.id).toBe('ruby')
    expect(saved.name).toBe('Ruby streaky')
  })

  it('shows library / project tabs and switches scope', async () => {
    const user = userEvent.setup()
    const project: Glass[] = [g({ id: 'p1', name: 'Project ruby' })]
    render(GlassPalette, {
      library,
      libraryActions: actions(),
      project,
      projectActions: actions(),
    })
    // Library scope shown by default.
    expect(screen.getByText('Ruby cathedral')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Project' }))
    expect(screen.getByText('Project ruby')).toBeInTheDocument()
    expect(screen.queryByText('Ruby cathedral')).not.toBeInTheDocument()
  })

  // Run 2026-08-16-b: experimenting leaves project glass behind and nothing pruned it. Removal is
  // offered only where it is safe — `removeGlass` drops the catalog entry without touching
  // `assignments`, so a glass still on a piece must not be removable.
  describe('removing unused project glass', () => {
    const project: Glass[] = [
      g({ id: 'used', name: 'Painted amber' }),
      g({ id: 'spare', name: 'Experiment teal' }),
    ]

    it('offers removal for project glass no piece shows, and removes it', async () => {
      const user = userEvent.setup()
      const projectActions = actions()
      render(GlassPalette, {
        library,
        libraryActions: actions(),
        project,
        projectActions,
        usedGlassIds: new Set(['used']),
      })
      await user.click(screen.getByRole('tab', { name: 'Project' }))

      expect(
        screen.queryByRole('button', { name: 'Remove Painted amber from project' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Remove Experiment teal from project' }))
      expect(projectActions.remove).toHaveBeenCalledWith('spare')
    })

    it('never offers it in the library scope — the library is not scoped to one design', () => {
      render(GlassPalette, {
        library,
        libraryActions: actions(),
        project,
        projectActions: actions(),
        usedGlassIds: new Set<string>(),
      })
      expect(
        screen.queryByRole('button', { name: /Remove .* from project/ }),
      ).not.toBeInTheDocument()
    })

    it('offers nothing when usage is unknown, rather than guessing everything is unused', async () => {
      const user = userEvent.setup()
      render(GlassPalette, {
        library,
        libraryActions: actions(),
        project,
        projectActions: actions(),
      })
      await user.click(screen.getByRole('tab', { name: 'Project' }))
      expect(
        screen.queryByRole('button', { name: /Remove .* from project/ }),
      ).not.toBeInTheDocument()
    })
  })

  it('selects a glass for painting instead of editing when onSelect is provided (F-023)', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(GlassPalette, { library, libraryActions: actions(), onSelect, selectedId: 'ruby' })

    // Clicking the swatch selects rather than opening the editor.
    await user.click(screen.getByRole('button', { name: 'Ruby cathedral' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect((onSelect.mock.calls[0]![0] as Glass).id).toBe('ruby')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The selected swatch is marked pressed; editing moves to a dedicated button.
    expect(screen.getByRole('button', { name: 'Ruby cathedral' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'Edit Emerald cathedral' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('adds a library glass to the project by value', async () => {
    const user = userEvent.setup()
    const onAddToProject = vi.fn()
    render(GlassPalette, {
      library,
      libraryActions: actions(),
      project: [],
      projectActions: actions(),
      onAddToProject,
    })
    await user.click(screen.getByRole('button', { name: 'Add Ruby cathedral to project' }))
    expect(onAddToProject).toHaveBeenCalledTimes(1)
    expect((onAddToProject.mock.calls[0]![0] as Glass).id).toBe('ruby')
  })
})
