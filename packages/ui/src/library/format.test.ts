import type { PanelEntry, PanelFacts } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { editedAt, panelDimensions, panelFigures, readinessPills, relativeTime } from './format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const entry = (over: Partial<PanelEntry> = {}): PanelEntry => ({
  path: '/panels/rose.vitrum',
  name: 'Rose window',
  units: 'mm',
  technique: 'lead',
  lastOpenedAt: 1000,
  ...over,
})

const facts = (over: Partial<PanelFacts> = {}): PanelFacts => ({
  panes: 36,
  paintedPanes: 36,
  leadLengthMm: 8200,
  checksOutstanding: 0,
  checksRun: true,
  ...over,
})

describe('panelDimensions', () => {
  it('prints the unit once, on the pair', () => {
    expect(panelDimensions(entry({ widthMm: 300, heightMm: 400 }))).toBe('300.0 × 400.0 mm')
  })

  it('converts to the unit the document uses', () => {
    expect(panelDimensions(entry({ widthMm: 304.8, heightMm: 406.4, units: 'in' }))).toBe(
      '12.00 × 16.00 in',
    )
  })

  it('is absent for a panel with no declared extent', () => {
    expect(panelDimensions(entry())).toBeNull()
  })
})

describe('relativeTime — the design’s vocabulary', () => {
  const now = 10 * DAY

  it.each([
    [now, 'just now'],
    [now - 30_000, 'just now'],
    [now - 12 * MINUTE, '12 min ago'],
    [now - 59 * MINUTE, '59 min ago'],
    [now - 3 * HOUR, '3h ago'],
    [now - 5 * DAY, '5d ago'],
    [now - 7 * DAY, '1w ago'],
    [now - 14 * DAY, '2w ago'],
  ])('renders %j as %j', (at, expected) => {
    expect(relativeTime(at, now)).toBe(expected)
  })

  it('falls back to a date once a month has passed', () => {
    const long = relativeTime(1, 60 * DAY)
    expect(long).not.toMatch(/ago/)
  })

  it('never claims a time for an unstamped entry, and never goes negative', () => {
    expect(relativeTime(0, now)).toBe('never')
    expect(relativeTime(now + HOUR, now)).toBe('just now')
  })
})

describe('editedAt', () => {
  it('prefers the last save — opening a file is not editing it', () => {
    expect(editedAt(entry({ lastOpenedAt: 900, lastSavedAt: 500 }))).toBe(500)
  })

  it('falls back to the last open for an entry never saved by an indexing build', () => {
    expect(editedAt(entry({ lastOpenedAt: 900 }))).toBe(900)
  })
})

describe('panelFigures (FR-10)', () => {
  it('prints the design’s mono line', () => {
    expect(panelFigures(entry({ facts: facts() }))).toBe('36 panes · 8.2 m came')
  })

  it('says "seam" for a foil panel, where "came" would be wrong', () => {
    expect(panelFigures(entry({ technique: 'foil', facts: facts() }))).toBe('36 panes · 8.2 m seam')
  })

  it('singularises one pane and omits a zero length', () => {
    expect(panelFigures(entry({ facts: facts({ panes: 1, leadLengthMm: 0 }) }))).toBe('1 pane')
  })

  it('is absent for an entry with no indexed facts, rather than printing zeroes', () => {
    expect(panelFigures(entry())).toBeNull()
  })
})

describe('readinessPills (FR-9)', () => {
  it('reports a finished panel as complete and clear', () => {
    expect(readinessPills(facts())).toEqual([
      { id: 'geometry', label: 'Geometry complete', tone: 'done' },
      { id: 'glass', label: 'Glass complete', tone: 'done', percent: 100 },
      { id: 'checks', label: 'Checks clear', tone: 'done' },
    ])
  })

  it('shows the painted fraction the design draws as a dial', () => {
    const pills = readinessPills(facts({ panes: 100, paintedPanes: 86 }))
    expect(pills[1]).toEqual({ id: 'glass', label: 'Glass 86%', tone: 'progress', percent: 86 })
  })

  it('counts outstanding checks, and singularises one', () => {
    expect(readinessPills(facts({ checksOutstanding: 2 }))[2]).toEqual({
      id: 'checks',
      label: '2 checks to review',
      tone: 'attention',
    })
    expect(readinessPills(facts({ checksOutstanding: 1 }))[2]?.label).toBe('1 check to review')
  })

  it('distinguishes "not run" from "clear"', () => {
    expect(readinessPills(facts({ checksRun: false }))[2]).toEqual({
      id: 'checks',
      label: 'Checks not run',
      tone: 'progress',
    })
  })

  it('omits the glass pill entirely when geometry does not close yet', () => {
    const pills = readinessPills(facts({ panes: 0, paintedPanes: 0 }))
    expect(pills.map((p) => p.id)).toEqual(['geometry', 'checks'])
    expect(pills[0]).toEqual({ id: 'geometry', label: 'Geometry open', tone: 'attention' })
  })
})
