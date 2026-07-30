import type { RunResult, Violation } from '@vitrum/drc'
import { vec2 } from '@vitrum/geometry'
import { createEmptyProject, type Command } from '@vitrum/model'
import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { DrcController } from '../drc/controller.svelte'

import RulesPanel from './RulesPanel.svelte'

function nearMiss(): Violation {
  return {
    ruleId: 'near-miss-joint',
    title: 'Near-miss joint',
    severity: 'error',
    message: 'two endpoints are not welded (0.30 mm apart)',
    explain: 'Two line ends sit a hair apart but are not welded.',
    at: vec2(10, 20),
    segmentIds: ['s1', 's2'],
    pieceIds: [],
    key: 'near-miss-joint#s1|s2',
    quickFix: { kind: 'weld', keepNodeId: 'n1', dropNodeId: 'n2', label: 'Weld it' },
  }
}

function unassigned(): Violation {
  return {
    ruleId: 'unassigned-glass',
    title: 'Unassigned glass',
    severity: 'warning',
    message: 'piece has no glass assigned',
    explain: 'This piece has no glass assigned.',
    at: vec2(30, 40),
    segmentIds: [],
    pieceIds: ['p1'],
    key: 'unassigned-glass#p-abc',
  }
}

function makeController(result: RunResult, execute?: (c: Command) => void) {
  const drc = new DrcController({ runner: { run: async () => result, dispose: () => {} }, execute })
  drc.result = result
  drc.hasRun = true
  return drc
}

const RESULT: RunResult = {
  violations: [nearMiss(), unassigned()],
  excluded: [],
  counts: { error: 1, warning: 1, info: 0 },
}

/** The violation queue, so assertions do not collide with the "Fix next" card above it. */
const queue = () => within(screen.getByLabelText('Violations'))

describe('RulesPanel (F-030)', () => {
  it('lists every violation in the queue', () => {
    const drc = makeController(RESULT)
    render(RulesPanel, { drc, doc: createEmptyProject() })
    expect(queue().getByText('Near-miss joint')).toBeInTheDocument()
    expect(queue().getByText('Unassigned glass')).toBeInTheDocument()
  })

  it('re-runs checks from the queue header', async () => {
    const drc = makeController(RESULT)
    const onRun = vi.fn()
    render(RulesPanel, { drc, doc: createEmptyProject(), onRun })
    await fireEvent.click(screen.getByRole('button', { name: 'Re-run' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('offers "Run checks" before the first run', async () => {
    const drc = makeController(RESULT)
    drc.hasRun = false
    const onRun = vi.fn()
    render(RulesPanel, { drc, doc: createEmptyProject(), onRun })
    await fireEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('expands the selected violation and applies its weld quick-fix', async () => {
    const commands: Command[] = []
    const drc = makeController(RESULT, (c) => commands.push(c))
    render(RulesPanel, { drc, doc: createEmptyProject() })

    await fireEvent.click(queue().getByText('Near-miss joint'))
    // The explain text and quick-fix appear on selection.
    expect(queue().getByText(/a hair apart/)).toBeInTheDocument()
    await fireEvent.click(queue().getByRole('button', { name: 'Weld it' }))
    expect(commands.map((c) => c.kind)).toEqual(['mergeNodes'])
  })

  it('waives a violation with a note', async () => {
    const commands: Command[] = []
    const drc = makeController(RESULT, (c) => commands.push(c))
    render(RulesPanel, { drc, doc: createEmptyProject() })

    await fireEvent.click(queue().getByText('Unassigned glass'))
    await fireEvent.input(screen.getByPlaceholderText('Why waive? (optional)'), {
      target: { value: 'stopper glass' },
    })
    await fireEvent.click(queue().getByRole('button', { name: 'Waive' }))

    expect(commands).toHaveLength(1)
    const doc = commands[0]!.apply(createEmptyProject())
    expect(doc.drc.exclusions['unassigned-glass#p-abc']).toEqual({ note: 'stopper glass' })
  })

  it('toggles the excluded tab and restores a waiver', async () => {
    const excludedResult: RunResult = {
      violations: [],
      excluded: [{ ...unassigned(), note: 'stopper glass' }],
      counts: { error: 0, warning: 0, info: 0 },
    }
    const commands: Command[] = []
    const drc = makeController(excludedResult, (c) => commands.push(c))
    render(RulesPanel, { drc, doc: createEmptyProject() })

    await fireEvent.click(screen.getByRole('button', { name: 'View excluded' }))
    expect(screen.getByText('“stopper glass”')).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(commands[0]!.kind).toBe('setDrcExclusion')
    // Restoring passes a null record (removes the waiver).
    const doc = commands[0]!.apply({
      ...createEmptyProject(),
      drc: { exclusions: { 'unassigned-glass#p-abc': { note: 'x' } }, rules: {} },
    })
    expect(doc.drc.exclusions['unassigned-glass#p-abc']).toBeUndefined()
  })

  it('shows the rule settings with an override select per rule', async () => {
    const drc = makeController(RESULT)
    render(RulesPanel, { drc, doc: createEmptyProject() })
    await fireEvent.click(screen.getByRole('button', { name: 'Rule settings' }))
    // Every rule is listed with an enable checkbox.
    expect(screen.getByText('Open border')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(6)
  })

  it('edits a cuttability threshold, persisting it as a per-rule override (F-031 FR-4)', async () => {
    const execute = vi.fn()
    const drc = makeController(RESULT, execute)
    render(RulesPanel, { drc, doc: createEmptyProject() })
    await fireEvent.click(screen.getByRole('button', { name: 'Rule settings' }))

    // The lead default (10 mm) shows as the placeholder for the minimum-piece-size threshold. The
    // structural pack (F-032) also has a 10 mm default (tiny-edge-contact), so scope to the first —
    // min-piece-size comes before the structural rules in the registry order.
    const input = screen.getAllByPlaceholderText('10')[0] as HTMLInputElement
    expect(input).toBeInTheDocument()

    await fireEvent.input(input, { target: { value: '12' } })
    expect(execute).toHaveBeenCalled()
    // Apply the captured command to a fresh doc and inspect the persisted override.
    const command = execute.mock.calls.at(-1)![0] as Command
    const doc = command.apply(createEmptyProject())
    expect(doc.drc.rules['min-piece-size']?.thresholds).toEqual({ minDimensionMm: 12 })
  })

  it('reads "no issues found" when a run is clean', () => {
    const clean: RunResult = {
      violations: [],
      excluded: [],
      counts: { error: 0, warning: 0, info: 0 },
    }
    const drc = makeController(clean)
    render(RulesPanel, { drc, doc: createEmptyProject() })
    expect(screen.getByText('No issues found.')).toBeInTheDocument()
  })
})

// Cockpit v2 opens the panel with one thing to fix rather than a wall of rows, and lets a maker
// clearing errors hide the advisory notes.
describe('RulesPanel — fix next (Cockpit v2)', () => {
  it('promotes the most severe violation, with its fix and explanation', () => {
    const drc = makeController(RESULT)
    render(RulesPanel, { drc, doc: createEmptyProject() })

    const card = within(screen.getByTestId('fix-next'))
    expect(card.getByText('Near-miss joint')).toBeInTheDocument()
    expect(card.getByText(/a hair apart/)).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Weld it' })).toBeInTheDocument()
  })

  it('applies the promoted quick fix straight from the card', async () => {
    const commands: Command[] = []
    const drc = makeController(RESULT, (c) => commands.push(c))
    render(RulesPanel, { drc, doc: createEmptyProject() })

    const card = within(screen.getByTestId('fix-next'))
    await fireEvent.click(card.getByRole('button', { name: 'Weld it' }))
    expect(commands.map((c) => c.kind)).toEqual(['mergeNodes'])
  })

  it('"Show me" selects the violation, which zooms the canvas to it', async () => {
    const drc = makeController(RESULT)
    render(RulesPanel, { drc, doc: createEmptyProject() })

    await fireEvent.click(within(screen.getByTestId('fix-next')).getByText('Show me'))
    expect(drc.selectedKey).toBe('near-miss-joint#s1|s2')
  })

  it('hides the card once nothing is left to fix', () => {
    const clean: RunResult = {
      violations: [],
      excluded: [],
      counts: { error: 0, warning: 0, info: 0 },
    }
    render(RulesPanel, { drc: makeController(clean), doc: createEmptyProject() })
    expect(screen.queryByTestId('fix-next')).not.toBeInTheDocument()
  })

  it('filters the queue by severity, and re-promotes what is left', async () => {
    const drc = makeController(RESULT)
    render(RulesPanel, { drc, doc: createEmptyProject() })

    // Counts read off the chips, so the filter doubles as the severity summary.
    expect(screen.getByRole('button', { name: /1 error/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 warning/ })).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /1 error/ }))
    expect(queue().queryByText('Near-miss joint')).not.toBeInTheDocument()
    expect(queue().getByText('Unassigned glass')).toBeInTheDocument()
    // The warning is now the thing to fix next.
    expect(within(screen.getByTestId('fix-next')).getByText('Unassigned glass')).toBeInTheDocument()
  })

  it('says so when every issue is filtered out', async () => {
    const drc = makeController(RESULT)
    render(RulesPanel, { drc, doc: createEmptyProject() })

    await fireEvent.click(screen.getByRole('button', { name: /1 error/ }))
    await fireEvent.click(screen.getByRole('button', { name: /1 warning/ }))
    expect(screen.getByText('Every issue is filtered out.')).toBeInTheDocument()
    expect(screen.queryByTestId('fix-next')).not.toBeInTheDocument()
  })
})
