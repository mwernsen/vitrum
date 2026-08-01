import { render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import {
  DocumentStore,
  addSegments,
  setGlassAssignments,
  upsertGlass,
  weldSegments,
  type Glass,
  type GlassId,
} from '@vitrum/model'
import { line, vec2 } from '@vitrum/geometry'
import { detectPieces, pieceKey, type Piece } from '@vitrum/core'
import { nestSheets, type NestInput, type NestProgress, type NestResult } from '@vitrum/nest'
import { describe, expect, it } from 'vitest'

import { NestController } from '../nest/controller.svelte'

import NestPanel from './NestPanel.svelte'

const glasses: Record<GlassId, Glass> = {
  g1: {
    id: 'g1',
    name: 'Cobalt blue',
    color: '#3a7bd5',
    transparency: 'transparent',
    texture: 'smooth',
    thicknessMm: 3,
    sheetSizes: [
      { widthMm: 200, heightMm: 200, label: 'Sample' },
      { widthMm: 610, heightMm: 914, label: 'Full sheet' },
    ],
  },
}

/** A runner that nests synchronously, so a component test never touches a worker. */
const runner = {
  run: async (input: NestInput, onProgress: (p: NestProgress) => void): Promise<NestResult> =>
    nestSheets(input, onProgress),
  cancel: () => {},
  dispose: () => {},
}

/** One square panel of glass, assigned to `g1` — enough to nest onto a sheet. */
function setup() {
  const store = new DocumentStore()
  // The controller resolves sheet sizes and rotation from the *document's* glass, so register it.
  store.execute(upsertGlass(glasses.g1!))
  const { segments } = weldSegments([
    { geometry: line(vec2(0, 0), vec2(80, 0)), role: 'lead' },
    { geometry: line(vec2(80, 0), vec2(80, 80)), role: 'lead' },
    { geometry: line(vec2(80, 80), vec2(0, 80)), role: 'lead' },
    { geometry: line(vec2(0, 80), vec2(0, 0)), role: 'lead' },
  ])
  store.execute(addSegments(segments))
  const pieces: readonly Piece[] = detectPieces(
    Object.values(store.document.segments).map((s) => ({
      id: s.id,
      geometry: s.geometry,
      role: s.role,
      endpoints: s.endpoints,
    })),
  ).pieces
  store.execute(
    setGlassAssignments(Object.fromEntries(pieces.map((p) => [pieceKey(p), 'g1' as GlassId]))),
  )
  const nest = new NestController({
    getDoc: () => store.document,
    execute: (c) => store.execute(c),
    getPieces: () => pieces,
    glassFor: () => 'g1',
    labelFor: (p) => p.id.slice(0, 2),
    runner,
  })
  return { store, nest, pieces }
}

describe('NestPanel (F-057)', () => {
  it('drives the placement order, and persists it on the document', async () => {
    const { store, nest } = setup()
    render(NestPanel, { nest, glasses, unit: 'mm' })

    // `fewest` is the shipped default and reads as pressed.
    expect(screen.getByRole('button', { name: 'Fewest sheets' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The hint explains what the chosen order trades, not just its name.
    expect(screen.getByText(/the best sheet count on most panels/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Tightest fit' }))
    expect(store.document.nesting.strategy).toBe('tight')
  })

  it('steps the cut allowance and clamps it at zero', async () => {
    const { store, nest } = setup()
    render(NestPanel, { nest, glasses, unit: 'mm' })

    await userEvent.click(screen.getByRole('button', { name: 'More cut allowance' }))
    expect(store.document.nesting.spacingMm).toBe(4)
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Less cut allowance' }))
    }
    expect(store.document.nesting.spacingMm).toBe(0)
  })

  it('expands one glass at a time and edits its stock size', async () => {
    const { store, nest } = setup()
    render(NestPanel, { nest, glasses, unit: 'mm' })

    const row = screen.getByRole('button', { name: /Cobalt blue/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')

    await userEvent.selectOptions(screen.getByLabelText('Stock size'), '610×914')
    expect(store.document.nesting.perGlass.g1?.sheet).toEqual({
      widthMm: 610,
      heightMm: 914,
      label: 'Full sheet',
    })

    // Collapsing hides the controls again — one open row keeps the choice focused.
    await userEvent.click(row)
    expect(screen.queryByLabelText('Stock size')).not.toBeInTheDocument()
  })

  it('reports a piece that fits no sheet, and offers the next size up', async () => {
    const { store, nest } = setup()
    // Pin the small sample sheet: the 80 mm piece fits, so shrink the sheet below it instead.
    nest.setGlassSheet('g1', { widthMm: 50, heightMm: 50, label: 'Tiny' })
    await nest.run()
    render(NestPanel, { nest, glasses, unit: 'mm' })

    expect(screen.getByText(/larger than the/)).toBeInTheDocument()
    const fix = screen.getByRole('button', { name: /Use .* for Cobalt blue/ })
    await userEvent.click(fix)
    // Moved to the smallest offered sheet larger than the one that failed.
    expect(store.document.nesting.perGlass.g1?.sheet?.widthMm).toBe(200)
  })

  it('shows the nested sheet count and per-glass utilisation once a run completes', async () => {
    const { nest } = setup()
    render(NestPanel, { nest, glasses, unit: 'mm' })
    expect(screen.getByText('not nested yet')).toBeInTheDocument()

    await nest.run()
    expect(screen.getByText('1 sheet')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Cobalt blue/ })
    expect(within(row).getByText(/%$/)).toBeInTheDocument()
  })
})
