import { arc, line, vec2, type Vec2 } from '@vitrum/geometry'
import {
  createEmptyProject,
  weldSegments,
  type Project,
  type ProjectSettings,
  type Segment,
  type SegmentGeometry,
  type SegmentRole,
} from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { FIT_RULES } from './rules/fit'
import { runChecks } from './run'
import { buildInput, countByRule } from './test/harness'
import type { Violation } from './types'

/**
 * Suite for the panel-fit pack (F-033). Scenes are built with the same coincidence-welding the
 * drawing tools use, and rules are scoped to {@link FIT_RULES} — each pack tests its own rules, as
 * the topology/cuttability/structural suites do.
 *
 * The reference frame throughout: the ordered panel is `settings.panelSize`, spanning
 * (0,0)→(width, height) in world mm, and world y grows downward, so y = 0 is the top edge.
 */

type Draft = { geometry: SegmentGeometry; role: SegmentRole }

function seg(a: Vec2, b: Vec2, role: SegmentRole = 'border'): Draft {
  return { geometry: line(a, b), role }
}

function projectFrom(drafts: readonly Draft[], settings: Partial<ProjectSettings> = {}): Project {
  const { segments, nodes } = weldSegments(drafts)
  const byId: Record<string, Segment> = {}
  for (const s of segments) byId[s.id] = s
  return { ...createEmptyProject(settings), segments: byId, nodes }
}

/** A closed rectangular border from (x,y) to (x+w, y+h). */
function rect(x: number, y: number, w: number, h: number, role: SegmentRole = 'border'): Draft[] {
  const A = vec2(x, y)
  const B = vec2(x + w, y)
  const C = vec2(x + w, y + h)
  const D = vec2(x, y + h)
  return [seg(A, B, role), seg(B, C, role), seg(C, D, role), seg(D, A, role)]
}

const ORDERED_300_400 = { panelSize: { width: 300, height: 400 } }

function check(project: Project): Violation[] {
  return [...runChecks(buildInput(project), FIT_RULES).violations]
}

function only(project: Project): Violation {
  const violations = check(project)
  expect(violations).toHaveLength(1)
  return violations[0]!
}

/* -------------------------------------------------------------------------- */
/* Silence: no ordered size, no design, or a design that fits                   */
/* -------------------------------------------------------------------------- */

describe('design-exceeds-panel: when it says nothing', () => {
  it('is silent with no ordered panel size, however large the design', () => {
    // `panelSize` is optional. With no order there is no reference, so absence must never read as a
    // zero-sized panel that everything overruns.
    const project = projectFrom(rect(0, 0, 4000, 4000))
    expect(check(project)).toEqual([])
  })

  it('is silent on an empty document that has an ordered size', () => {
    expect(check(createEmptyProject(ORDERED_300_400))).toEqual([])
  })

  it('is silent on a design inside the ordered panel', () => {
    expect(check(projectFrom(rect(10, 10, 280, 380), ORDERED_300_400))).toEqual([])
  })

  it('is silent on a design that exactly fills the ordered panel', () => {
    expect(check(projectFrom(rect(0, 0, 300, 400), ORDERED_300_400))).toEqual([])
  })

  it('is silent within the fit tolerance (snapping and rounding slop)', () => {
    expect(check(projectFrom(rect(0, 0, 300.8, 400), ORDERED_300_400))).toEqual([])
  })

  it('is silent when only construction guides run off the panel', () => {
    // Guides are scaffolding — they are allowed to extend past the glass, and `outputSegments`
    // excludes them by role.
    const project = projectFrom(
      [...rect(10, 10, 280, 380), seg(vec2(-500, 200), vec2(800, 200), 'construction')],
      ORDERED_300_400,
    )
    expect(check(project)).toEqual([])
  })

  it('is silent when the ordered size is degenerate', () => {
    const project = projectFrom(rect(0, 0, 300, 400), { panelSize: { width: 0, height: 400 } })
    expect(check(project)).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The headline case: a design larger than the ordered glass (error)             */
/* -------------------------------------------------------------------------- */

describe('design-exceeds-panel: larger than the ordered glass', () => {
  it('flags a 400 mm design in a 300 mm panel as an error, naming the overrun', () => {
    // The finding this rule comes from, verbatim: "a user can draw a 400 mm design in a 300 mm
    // panel and nothing says so until the cutting list".
    const v = only(projectFrom(rect(0, 0, 400, 400), ORDERED_300_400))
    expect(v.ruleId).toBe('design-exceeds-panel')
    expect(v.title).toBe('Exceeds panel')
    expect(v.severity).toBe('error')
    expect(v.message).toBe(
      'design is 400 × 400 mm — 100 mm wider than the ordered 300 × 400 mm panel',
    )
  })

  it('names both dimensions when both exceed the order', () => {
    const v = only(projectFrom(rect(0, 0, 420, 430), ORDERED_300_400))
    expect(v.message).toBe(
      'design is 420 × 430 mm — 120 mm wider and 30 mm taller than the ordered 300 × 400 mm panel',
    )
  })

  it('is an error wherever the oversized design sits, since moving it cannot help', () => {
    // Centred on the panel: it overruns on all four sides but the point is the size, not the place.
    const v = only(projectFrom(rect(-50, -15, 400, 430), ORDERED_300_400))
    expect(v.severity).toBe('error')
    expect(v.message).toContain('100 mm wider and 30 mm taller')
  })

  it('reports fractional overruns to a tenth of a millimetre', () => {
    const v = only(projectFrom(rect(0, 0, 301.4, 400), ORDERED_300_400))
    expect(v.message).toBe(
      'design is 301.4 × 400 mm — 1.4 mm wider than the ordered 300 × 400 mm panel',
    )
  })
})

/* -------------------------------------------------------------------------- */
/* The milder case: it fits, but not where it is (warning)                       */
/* -------------------------------------------------------------------------- */

describe('design-exceeds-panel: fits but sits outside', () => {
  it('warns rather than errors, and says the design does fit', () => {
    const v = only(projectFrom(rect(60, 10, 280, 380), ORDERED_300_400))
    expect(v.severity).toBe('warning')
    expect(v.message).toBe(
      'design is 280 × 380 mm — it fits the ordered 300 × 400 mm panel but extends 40 mm past its right edge',
    )
  })

  it('names every overrunning edge, in a stable order', () => {
    const v = only(projectFrom(rect(-20, -30, 280, 380), ORDERED_300_400))
    expect(v.message).toContain('extends 20 mm past its left edge and 30 mm past its top edge')
  })

  it('names the bottom edge for an overrun past the panel height (world y grows downward)', () => {
    const v = only(projectFrom(rect(10, 60, 280, 380), ORDERED_300_400))
    expect(v.message).toContain('40 mm past its bottom edge')
  })
})

/* -------------------------------------------------------------------------- */
/* What the violation points at                                                 */
/* -------------------------------------------------------------------------- */

describe('design-exceeds-panel: what it points at', () => {
  it('lists only the segments that stick out, so hovering highlights them (FR-2)', () => {
    // A border inside the panel plus one lead line running out past the right edge.
    const inside = rect(10, 10, 280, 380)
    const spur = seg(vec2(200, 200), vec2(500, 200), 'lead')
    const project = projectFrom([...inside, spur], ORDERED_300_400)
    const v = only(project)
    const leadIds = Object.values(project.segments)
      .filter((s) => s.role === 'lead')
      .map((s) => s.id)
    expect(leadIds).toHaveLength(1)
    expect(v.segmentIds).toEqual(leadIds)
  })

  it('anchors the marker on the corner that sticks out furthest', () => {
    const v = only(projectFrom(rect(10, 60, 320, 380), ORDERED_300_400))
    // Overruns right (330 − 300 = 30) and bottom (440 − 400 = 40): the bottom-right corner.
    expect(v.at).toEqual(vec2(330, 440))
    expect(v.distance).toBeCloseTo(40, 6)
  })

  it('anchors on the panel-side axis when only one axis overruns', () => {
    const v = only(projectFrom(rect(60, 10, 280, 380), ORDERED_300_400))
    // Only the right edge overruns; the vertical anchor is the design's mid-height.
    expect(v.at.x).toBeCloseTo(340, 6)
    expect(v.at.y).toBeCloseTo(200, 6)
  })

  it('is a single waivable item for the whole design', () => {
    const v = only(projectFrom(rect(0, 0, 400, 400), ORDERED_300_400))
    expect(v.key).toBe('design-exceeds-panel#panel')
  })

  it('names the pieces that overrun the panel', () => {
    const project = projectFrom(rect(0, 0, 400, 400), ORDERED_300_400)
    const v = only(project)
    expect(v.pieceIds).toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------- */
/* Measuring the true extent, not the endpoints                                 */
/* -------------------------------------------------------------------------- */

describe('design-exceeds-panel: measures where the glass actually reaches', () => {
  it('counts a curve that bows past the panel even though its ends are inside', () => {
    // A semicircular bulge whose endpoints sit on x = 290 but which reaches x = 390. Measuring
    // endpoints (as the structural pack's `panelMetrics` does) would miss it entirely.
    const bulge: Draft = {
      geometry: arc(vec2(290, 200), 100, -Math.PI / 2, Math.PI / 2, true),
      role: 'lead',
    }
    const border = rect(10, 10, 280, 380)
    expect(check(projectFrom(border, ORDERED_300_400))).toEqual([])

    const v = only(projectFrom([...border, bulge], ORDERED_300_400))
    // 10 → 390: the arc's extremum, not its endpoints (which stop at x = 290).
    expect(v.message).toBe(
      'design is 380 × 380 mm — 80 mm wider than the ordered 300 × 400 mm panel',
    )
    expect(v.at).toEqual(vec2(390, 200))
  })
})

/* -------------------------------------------------------------------------- */
/* Tunability (F-031/F-032 threshold convention)                                */
/* -------------------------------------------------------------------------- */

describe('design-exceeds-panel: threshold', () => {
  it('declares one tunable tolerance', () => {
    const rule = FIT_RULES[0]!
    expect(rule.thresholds?.map((t) => t.key)).toEqual(['toleranceMm'])
    expect(rule.thresholds?.[0]!.defaultFor('lead')).toBe(1)
    expect(rule.thresholds?.[0]!.defaultFor('foil')).toBe(1)
  })

  it('honours a per-project tolerance override (FR-4)', () => {
    const base = projectFrom(rect(0, 0, 305, 400), ORDERED_300_400)
    expect(countByRule(runChecks(buildInput(base), FIT_RULES))['design-exceeds-panel']).toBe(1)

    const relaxed: Project = {
      ...base,
      drc: {
        exclusions: {},
        rules: { 'design-exceeds-panel': { thresholds: { toleranceMm: 10 } } },
      },
    }
    expect(check(relaxed)).toEqual([])
  })

  it('can be disabled per project, like any rule', () => {
    const base = projectFrom(rect(0, 0, 400, 400), ORDERED_300_400)
    const off: Project = {
      ...base,
      drc: { exclusions: {}, rules: { 'design-exceeds-panel': { enabled: false } } },
    }
    expect(check(off)).toEqual([])
  })
})
