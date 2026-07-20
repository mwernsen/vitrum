import type { RunResult, Violation } from '@vitrum/drc'
import { vec2 } from '@vitrum/geometry'
import { createEmptyProject, type Command } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
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

describe('RulesPanel (F-030)', () => {
  it('lists violations with severity counts and a run button', () => {
    const drc = makeController(RESULT)
    render(RulesPanel, { drc, doc: createEmptyProject() })
    expect(screen.getByRole('button', { name: 'Run checks' })).toBeInTheDocument()
    expect(screen.getByText('Near-miss joint')).toBeInTheDocument()
    expect(screen.getByText('Unassigned glass')).toBeInTheDocument()
    expect(screen.getByText('2 total')).toBeInTheDocument()
  })

  it('runs checks when "Run checks" is clicked', async () => {
    const drc = makeController(RESULT)
    const onRun = vi.fn()
    render(RulesPanel, { drc, doc: createEmptyProject(), onRun })
    await fireEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('expands the selected violation and applies its weld quick-fix', async () => {
    const commands: Command[] = []
    const drc = makeController(RESULT, (c) => commands.push(c))
    render(RulesPanel, { drc, doc: createEmptyProject() })

    await fireEvent.click(screen.getByText('Near-miss joint'))
    // The explain text and quick-fix appear on selection.
    expect(screen.getByText(/a hair apart/)).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Weld it' }))
    expect(commands.map((c) => c.kind)).toEqual(['mergeNodes'])
  })

  it('waives a violation with a note', async () => {
    const commands: Command[] = []
    const drc = makeController(RESULT, (c) => commands.push(c))
    render(RulesPanel, { drc, doc: createEmptyProject() })

    await fireEvent.click(screen.getByText('Unassigned glass'))
    await fireEvent.input(screen.getByPlaceholderText('Why waive? (optional)'), {
      target: { value: 'stopper glass' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Waive' }))

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

    // The lead default (10 mm) shows as the placeholder for the minimum-piece-size threshold.
    const input = screen.getByPlaceholderText('10') as HTMLInputElement
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
