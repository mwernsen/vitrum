import {
  emptyLibrary,
  serializeLibrary,
  upsertGlassInLibrary,
  type Glass,
  type GlassLibrary,
  type GlassLibraryPort,
} from '@vitrum/model'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { GlassLibraryController } from './library.svelte'
import GlassLibraryView from './GlassLibraryView.svelte'

const glass = (over: Partial<Glass> & Pick<Glass, 'id' | 'name'>): Glass => ({
  color: '#3a7bd5',
  transparency: 'transparent',
  texture: 'smooth',
  thicknessMm: 3,
  ...over,
})

/** A `GlassLibraryController` over a mutable in-memory port, seeded with `glasses`. */
async function loaded(glasses: Glass[]): Promise<{
  controller: GlassLibraryController
  port: GlassLibraryPort
  saved: () => string | null
}> {
  let library: GlassLibrary = emptyLibrary()
  for (const g of glasses) library = upsertGlassInLibrary(library, g)
  let stored = serializeLibrary(library)
  const importLibrary = vi.fn(async () => null)
  const exportLibrary = vi.fn(async () => null)
  const port: GlassLibraryPort = {
    load: async () => stored,
    save: async (raw) => {
      stored = raw
    },
    importLibrary,
    exportLibrary,
  }
  const controller = new GlassLibraryController(port)
  await controller.init()
  return { controller, port, saved: () => stored }
}

const ruby = glass({
  id: 'r',
  name: 'Ruby cathedral',
  color: '#c8102e',
  transparency: 'transparent',
  texture: 'smooth',
  manufacturer: 'Aurora Glass',
  sku: 'AG-101',
  pricePerM2: 120,
})
const emerald = glass({
  id: 'e',
  name: 'Emerald cathedral',
  color: '#0f9d58',
  transparency: 'translucent',
  texture: 'seedy',
})

describe('GlassLibraryView — the grid (FR-2)', () => {
  it('renders every glass with its metadata', async () => {
    const { controller } = await loaded([ruby, emerald])
    render(GlassLibraryView, { controller, query: '' })

    expect(screen.getByRole('button', { name: 'Ruby cathedral' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Emerald cathedral' })).toBeInTheDocument()
    // Rich card: commercial line, transparency/texture/thickness tags, price (the management surface).
    const card = screen.getByRole('button', { name: 'Ruby cathedral' })
    expect(card).toHaveTextContent('Aurora Glass · AG-101')
    expect(card).toHaveTextContent('Transparent')
    expect(card).toHaveTextContent('Smooth')
    expect(card).toHaveTextContent('3 mm')
    expect(card).toHaveTextContent('120.00 / m²')
    expect(screen.getByTestId('glass-home-count')).toHaveTextContent('2 of 2')
  })
})

describe('GlassLibraryView — search and facets (FR-3)', () => {
  it('filters by the header query, with a distinct no-match state', async () => {
    const { controller } = await loaded([ruby, emerald])
    const { rerender } = render(GlassLibraryView, { controller, query: 'emerald' })
    expect(screen.getByText('Emerald cathedral')).toBeInTheDocument()
    expect(screen.queryByText('Ruby cathedral')).not.toBeInTheDocument()
    expect(screen.getByTestId('glass-home-count')).toHaveTextContent('1 of 2')

    // A query matching nothing shows the no-match state, distinct from an empty library.
    await rerender({ controller, query: 'nothing here' })
    expect(screen.getByTestId('glass-home-no-matches')).toBeInTheDocument()
    expect(screen.queryByTestId('glass-home-empty')).not.toBeInTheDocument()
  })

  it('filters by a facet (transparency)', async () => {
    const { controller } = await loaded([ruby, emerald])
    render(GlassLibraryView, { controller, query: '' })

    await fireEvent.change(screen.getByLabelText('Transparency'), {
      target: { value: 'translucent' },
    })
    expect(screen.getByText('Emerald cathedral')).toBeInTheDocument()
    expect(screen.queryByText('Ruby cathedral')).not.toBeInTheDocument()
  })

  it('shows the empty-library state when there is no glass at all', async () => {
    const { controller } = await loaded([])
    render(GlassLibraryView, { controller, query: '' })
    expect(screen.getByTestId('glass-home-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('glass-home-no-matches')).not.toBeInTheDocument()
  })
})

describe('GlassLibraryView — CRUD through the shared controller (FR-4)', () => {
  it('creates a glass through the editor dialog and shows it in the grid', async () => {
    const { controller } = await loaded([])
    render(GlassLibraryView, { controller, query: '' })

    await fireEvent.click(screen.getByRole('button', { name: 'New glass' }))
    const dialog = screen.getByRole('dialog', { name: 'New glass' })
    await fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Studio blue' },
    })
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Studio blue' })).toBeInTheDocument(),
    )
    // The one shared controller now holds it — the editor palette would see it too (FR-4).
    expect(controller.glasses.some((g) => g.name === 'Studio blue')).toBe(true)
  })

  it('always confirms a delete, and removing keeps FR-7 safety wording', async () => {
    const { controller } = await loaded([ruby])
    render(GlassLibraryView, { controller, query: '' })

    // Open the editor on the glass, then Delete → a confirmation, not an immediate removal.
    await fireEvent.click(screen.getByRole('button', { name: 'Ruby cathedral' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete glass' })
    expect(confirm).toHaveTextContent('copy it by value')
    // Still present until confirmed.
    expect(controller.glasses.some((g) => g.id === 'r')).toBe(true)

    await fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(controller.glasses.some((g) => g.id === 'r')).toBe(false))
  })

  it('routes import and export through the controller port (FR-5)', async () => {
    const { controller, port } = await loaded([ruby])
    render(GlassLibraryView, {
      controller,
      query: '',
      onImport: () => void controller.importLibrary(),
      onExport: () => void controller.exportLibrary(),
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Export…' }))
    await waitFor(() => expect(port.exportLibrary).toHaveBeenCalled())
    await fireEvent.click(screen.getByRole('button', { name: 'Import…' }))
    await waitFor(() => expect(port.importLibrary).toHaveBeenCalled())
  })
})
