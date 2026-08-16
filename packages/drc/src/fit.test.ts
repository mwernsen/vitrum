import { arc, line, vec2, type Vec2 } from '@vitrum/geometry'
import {
  createEmptyProject,
  weldSegments,
  type CameOverride,
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
 *
 * Since 2026-08-16 `panelSize` is the **finished** panel (Mathieu's decision, F-033 open question 1),
 * so every expectation below is about the *assembled* extent: the drawn extent grown by the
 * technique's perimeter came allowance. A default project is lead came with the H 5 mm profile
 * (F-021 FR-5), whose flange is centred on the drawn line, so {@link ALLOWANCE} mm of came lands
 * outside the drawn border on every side and a drawn border of _w_ assembles to _w_ + 5 mm.
 */

/** The default project's perimeter allowance: half the H 5 mm came flange, per side. */
const ALLOWANCE = 2.5

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

/** Swap the project's default came profile, which is the perimeter came until a border overrides it. */
function withDefaultCame(project: Project, profileId: string): Project {
  const lead = project.technique.lead
  return {
    ...project,
    technique: { ...project.technique, lead: { ...lead, defaultProfileId: profileId } },
  }
}

/** Fit a heavier (or lighter) came on every border segment — the standard perimeter-came case. */
function withBorderCame(project: Project, profileId: string): Project {
  const overrides: Record<string, CameOverride> = {}
  for (const s of Object.values(project.segments)) {
    if (s.role === 'border') overrides[s.id] = { profileId }
  }
  const lead = project.technique.lead
  return { ...project, technique: { ...project.technique, lead: { ...lead, overrides } } }
}

/** The same design built as copper foil: no perimeter came at all. */
function asFoil(project: Project): Project {
  return { ...project, technique: { ...project.technique, kind: 'foil' } }
}

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
    // Drawn 280 × 380 at (10, 10); assembles to 285 × 385 spanning (7.5, 7.5)→(292.5, 392.5).
    expect(check(projectFrom(rect(10, 10, 280, 380), ORDERED_300_400))).toEqual([])
  })

  it('is silent on a design drawn to the ordered size less the came allowance', () => {
    // The centreline a maker should aim at: inset by the came allowance on every side, so the
    // assembled panel lands exactly on the ordered 300 × 400 mm rectangle.
    const drawn = rect(ALLOWANCE, ALLOWANCE, 300 - 2 * ALLOWANCE, 400 - 2 * ALLOWANCE)
    expect(check(projectFrom(drawn, ORDERED_300_400))).toEqual([])
  })

  it('is silent within the fit tolerance (snapping and rounding slop)', () => {
    // Assembles to 300.5 × 400.5 spanning (−0.5, −0.5)→(300.5, 400.5): half a millimetre out on
    // every side, inside the 1 mm tolerance.
    expect(check(projectFrom(rect(2, 2, 296, 396), ORDERED_300_400))).toEqual([])
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
    // panel and nothing says so until the cutting list". Drawn 400 × 400 assembles to 405 × 405, so
    // it now overruns the height too — which is the point of measuring the finished panel.
    const v = only(projectFrom(rect(0, 0, 400, 400), ORDERED_300_400))
    expect(v.ruleId).toBe('design-exceeds-panel')
    expect(v.title).toBe('Exceeds panel')
    expect(v.severity).toBe('error')
    expect(v.message).toBe(
      'assembles to 405 × 405 mm — 105 mm wider and 5 mm taller than the ordered 300 × 400 mm ' +
        'panel (drawn 400 × 400 mm plus 2.5 mm of came on each side)',
    )
  })

  it('flags a design drawn to exactly the ordered size — the came makes it larger', () => {
    // The regression this ticket exists for (Mathieu, 2026-08-16). Drawing a 300 × 400 border in a
    // 300 × 400 panel passed clean while `panelSize` was compared with the drawn centreline; the
    // finished panel is 305 × 405 mm and does not fit the opening.
    const v = only(projectFrom(rect(0, 0, 300, 400), ORDERED_300_400))
    expect(v.severity).toBe('error')
    expect(v.message).toBe(
      'assembles to 305 × 405 mm — 5 mm wider and 5 mm taller than the ordered 300 × 400 mm ' +
        'panel (drawn 300 × 400 mm plus 2.5 mm of came on each side)',
    )
  })

  it('names both dimensions when both exceed the order', () => {
    const v = only(projectFrom(rect(0, 0, 420, 430), ORDERED_300_400))
    expect(v.message).toBe(
      'assembles to 425 × 435 mm — 125 mm wider and 35 mm taller than the ordered 300 × 400 mm ' +
        'panel (drawn 420 × 430 mm plus 2.5 mm of came on each side)',
    )
  })

  it('is an error wherever the oversized design sits, since moving it cannot help', () => {
    // Centred on the panel: it overruns on all four sides but the point is the size, not the place.
    const v = only(projectFrom(rect(-50, -15, 400, 430), ORDERED_300_400))
    expect(v.severity).toBe('error')
    expect(v.message).toContain('105 mm wider and 35 mm taller')
  })

  it('reports fractional overruns to a tenth of a millimetre', () => {
    // Drawn 296.4 × 395 assembles to 301.4 × 400: 1.4 mm too wide, exactly the ordered height.
    const v = only(projectFrom(rect(0, 0, 296.4, 395), ORDERED_300_400))
    expect(v.message).toBe(
      'assembles to 301.4 × 400 mm — 1.4 mm wider than the ordered 300 × 400 mm panel ' +
        '(drawn 296.4 × 395 mm plus 2.5 mm of came on each side)',
    )
  })
})

/* -------------------------------------------------------------------------- */
/* The allowance itself: derived from the technique, never assumed              */
/* -------------------------------------------------------------------------- */

describe('design-exceeds-panel: the perimeter allowance comes from the technique (F-021)', () => {
  /** The centreline that assembles exactly to the order under the default H 5 mm came. */
  const toSize = rect(ALLOWANCE, ALLOWANCE, 300 - 2 * ALLOWANCE, 400 - 2 * ALLOWANCE)

  it('grows with a heavier perimeter came fitted on the border', () => {
    const base = projectFrom(toSize, ORDERED_300_400)
    expect(check(base)).toEqual([])

    // U 9 mm on the perimeter (the standard heavier-border case): 4.5 mm outside the drawn line
    // instead of 2.5, so the same drawing assembles 4 mm too big in each direction.
    const heavy = only(withBorderCame(base, 'came-u-9'))
    expect(heavy.severity).toBe('error')
    expect(heavy.message).toBe(
      'assembles to 304 × 404 mm — 4 mm wider and 4 mm taller than the ordered 300 × 400 mm ' +
        'panel (drawn 295 × 395 mm plus 4.5 mm of came on each side)',
    )
  })

  it('follows the default came profile when no border came is fitted', () => {
    // The same drawing, 8 mm smaller than the order on each axis: fine with H 5 mm came (2.5 mm
    // per side), too big with H 12 mm (6 mm per side).
    const drawn = rect(4, 4, 292, 392)
    expect(check(projectFrom(drawn, ORDERED_300_400))).toEqual([])

    const heavy = only(withDefaultCame(projectFrom(drawn, ORDERED_300_400), 'came-h-12'))
    expect(heavy.message).toContain('assembles to 304 × 404 mm')
    expect(heavy.message).toContain('plus 6 mm of came on each side')
  })

  it('adds nothing for copper foil, where the drawn size is the finished size', () => {
    // Foil has no perimeter came: pieces are cut back half the piece gap and the edge is wrapped
    // and soldered, so the finished edge lands back on the drawn line. The design that is an error
    // in lead is silent in foil.
    expect(check(asFoil(projectFrom(rect(0, 0, 300, 400), ORDERED_300_400)))).toEqual([])
  })

  it('says so in the message when a foiled panel is genuinely too big', () => {
    const v = only(asFoil(projectFrom(rect(0, 0, 400, 400), ORDERED_300_400)))
    expect(v.message).toBe(
      'assembles to 400 × 400 mm — 100 mm wider than the ordered 300 × 400 mm panel ' +
        '(drawn 400 × 400 mm; foiled edges add no width)',
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
      'assembles to 285 × 385 mm — it fits the ordered 300 × 400 mm panel but extends 42.5 mm ' +
        'past its right edge (drawn 280 × 380 mm plus 2.5 mm of came on each side)',
    )
  })

  it('names every overrunning edge, in a stable order', () => {
    const v = only(projectFrom(rect(-20, -30, 280, 380), ORDERED_300_400))
    expect(v.message).toContain('extends 22.5 mm past its left edge and 32.5 mm past its top edge')
  })

  it('names the bottom edge for an overrun past the panel height (world y grows downward)', () => {
    const v = only(projectFrom(rect(10, 60, 280, 380), ORDERED_300_400))
    expect(v.message).toContain('42.5 mm past its bottom edge')
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

  it('names a segment drawn inside the panel whose came lands outside it', () => {
    // A lead line 1 mm inside the right edge: the drawn line fits, the came on it does not.
    const inside = rect(10, 10, 280, 380)
    const nearEdge = seg(vec2(299, 100), vec2(299, 300), 'lead')
    const project = projectFrom([...inside, nearEdge], ORDERED_300_400)
    const v = only(project)
    expect(v.severity).toBe('warning')
    expect(v.message).toContain('1.5 mm past its right edge')
    const leadIds = Object.values(project.segments)
      .filter((s) => s.role === 'lead')
      .map((s) => s.id)
    expect(v.segmentIds).toEqual(leadIds)
  })

  it('anchors the marker on the corner of the assembled panel that sticks out furthest', () => {
    const v = only(projectFrom(rect(10, 60, 320, 380), ORDERED_300_400))
    // Assembles to (7.5, 57.5)→(332.5, 442.5): overruns right (32.5) and bottom (42.5), so the
    // marker lands on the finished panel's bottom-right corner.
    expect(v.at).toEqual(vec2(332.5, 442.5))
    expect(v.distance).toBeCloseTo(42.5, 6)
  })

  it('anchors on the panel-side axis when only one axis overruns', () => {
    const v = only(projectFrom(rect(60, 10, 280, 380), ORDERED_300_400))
    // Only the right edge overruns; the vertical anchor is the assembled panel's mid-height.
    expect(v.at.x).toBeCloseTo(342.5, 6)
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
    // 10 → 390 drawn: the arc's extremum, not its endpoints (which stop at x = 290).
    expect(v.message).toBe(
      'assembles to 385 × 385 mm — 85 mm wider than the ordered 300 × 400 mm panel ' +
        '(drawn 380 × 380 mm plus 2.5 mm of came on each side)',
    )
    expect(v.at).toEqual(vec2(392.5, 200))
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
