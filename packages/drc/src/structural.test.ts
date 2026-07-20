import { detectPieces, pieceKey } from '@vitrum/core'
import { line, vec2, type Vec2 } from '@vitrum/geometry'
import {
  createEmptyProject,
  outputSegments,
  weldSegments,
  type Project,
  type ReinforcementBar,
  type Segment,
  type SegmentRole,
} from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { panelWeight } from './rules/weight'
import { STRUCTURAL_RULES } from './rules/structural'
import { runChecks } from './run'
import { buildInput, countByRule } from './test/harness'

/**
 * Golden suite for the structural-integrity pack (F-032). Each scene is built with the same
 * coincidence-welding the drawing tools use, so shared corners are genuinely one node. Rules are
 * scoped to {@link STRUCTURAL_RULES} — each pack tests its own rules (the topology/cuttability
 * suites do the same). `panel-weight` emits an always-on info, so most scenes carry one.
 */

type Draft = { geometry: ReturnType<typeof line>; role: SegmentRole }

function seg(a: Vec2, b: Vec2, role: SegmentRole = 'lead'): Draft {
  return { geometry: line(a, b), role }
}

function projectFrom(
  drafts: readonly Draft[],
  reinforcements: readonly ReinforcementBar[] = [],
): Project {
  const { segments, nodes } = weldSegments(drafts)
  const byId: Record<string, Segment> = {}
  for (const s of segments) byId[s.id] = s
  return { ...createEmptyProject(), segments: byId, nodes, reinforcements }
}

/** Rectangle border A→B→C→D→A, split at each edge midpoint so interior lines can weld to it. */
function borderWithMidpoints(w: number, h: number): Draft[] {
  const A = vec2(0, 0)
  const B = vec2(w, 0)
  const C = vec2(w, h)
  const D = vec2(0, h)
  const mTop = vec2(w / 2, 0)
  const mBottom = vec2(w / 2, h)
  const mLeft = vec2(0, h / 2)
  const mRight = vec2(w, h / 2)
  return [
    seg(A, mTop, 'border'),
    seg(mTop, B, 'border'),
    seg(B, mRight, 'border'),
    seg(mRight, C, 'border'),
    seg(C, mBottom, 'border'),
    seg(mBottom, D, 'border'),
    seg(D, mLeft, 'border'),
    seg(mLeft, A, 'border'),
  ]
}

/* -------------------------------------------------------------------------- */
/* hinge-line: the Mondrian / brick discriminator (FR-1)                        */
/* -------------------------------------------------------------------------- */

describe('hinge-line (FR-1)', () => {
  it('flags full edge-to-edge lines in a Mondrian-style grid', () => {
    const w = 600
    const h = 600
    // A full vertical divider and a full horizontal divider, each crossing the panel edge to edge.
    const drafts: Draft[] = [
      ...borderWithMidpoints(w, h),
      seg(vec2(w / 2, 0), vec2(w / 2, h / 2)),
      seg(vec2(w / 2, h / 2), vec2(w / 2, h)),
      seg(vec2(0, h / 2), vec2(w / 2, h / 2)),
      seg(vec2(w / 2, h / 2), vec2(w, h / 2)),
    ]
    const result = runChecks(buildInput(projectFrom(drafts)), STRUCTURAL_RULES)
    expect(countByRule(result)['hinge-line']).toBe(2)
    // A perfectly straight run through is graded as an error.
    expect(
      result.violations
        .filter((v) => v.ruleId === 'hinge-line')
        .every((v) => v.severity === 'error'),
    ).toBe(true)
  })

  it('does not flag a staggered layout where no line runs edge to edge', () => {
    const w = 600
    const h = 600
    // Vertical + horizontal dividers, each jogged at mid-span so neither half reaches an edge and
    // the collinear chain breaks at the > 12° jog.
    const drafts: Draft[] = [
      ...borderWithMidpoints(w, h),
      // Vertical divider, jogged sideways at mid-height.
      seg(vec2(300, 0), vec2(300, 280)),
      seg(vec2(300, 280), vec2(340, 320)),
      seg(vec2(340, 320), vec2(340, 600)),
      // Horizontal divider, jogged up at mid-width.
      seg(vec2(0, 300), vec2(280, 300)),
      seg(vec2(280, 300), vec2(320, 340)),
      seg(vec2(320, 340), vec2(600, 340)),
    ]
    const result = runChecks(buildInput(projectFrom(drafts)), STRUCTURAL_RULES)
    expect(countByRule(result)['hinge-line'] ?? 0).toBe(0)
  })

  it('relaxes the span threshold for foil (foil is stiffer once soldered)', () => {
    // A single run reaching 88 % of the panel width: a hinge under the lead default (85 %) but not
    // under the foil default (92 %).
    const w = 1000
    const h = 400
    const drafts: Draft[] = [...borderWithMidpoints(w, h), seg(vec2(60, 40), vec2(940, 40))]
    const lead = projectFrom(drafts)
    expect(countByRule(runChecks(buildInput(lead), STRUCTURAL_RULES))['hinge-line']).toBe(1)

    const foil: Project = { ...lead, technique: { ...lead.technique, kind: 'foil' } }
    expect(countByRule(runChecks(buildInput(foil), STRUCTURAL_RULES))['hinge-line'] ?? 0).toBe(0)
  })

  it('respects a per-project threshold override', () => {
    // The same 88 % run, but the project pins the span threshold to 95 % — no longer a hinge.
    const w = 1000
    const h = 400
    const base = projectFrom([...borderWithMidpoints(w, h), seg(vec2(60, 40), vec2(940, 40))])
    const pinned: Project = {
      ...base,
      drc: { exclusions: {}, rules: { 'hinge-line': { thresholds: { spanPercent: 95 } } } },
    }
    expect(countByRule(runChecks(buildInput(pinned), STRUCTURAL_RULES))['hinge-line'] ?? 0).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* crowded-joint                                                                */
/* -------------------------------------------------------------------------- */

describe('crowded-joint', () => {
  /** N lead spokes from a shared centre, at non-opposite angles so no two are collinear. */
  function star(n: number): Project {
    const center = vec2(0, 0)
    const drafts: Draft[] = []
    for (let i = 0; i < n; i++) {
      const angle = (i * 50 * Math.PI) / 180 // 50° apart ⇒ never 180° apart for n ≤ 7
      drafts.push(seg(center, vec2(Math.cos(angle) * 100, Math.sin(angle) * 100)))
    }
    return projectFrom(drafts)
  }

  it('warns when five came ends meet at one joint', () => {
    const result = runChecks(buildInput(star(5)), STRUCTURAL_RULES)
    const crowded = result.violations.filter((v) => v.ruleId === 'crowded-joint')
    expect(crowded).toHaveLength(1)
    expect(crowded[0]!.severity).toBe('warning')
  })

  it('errors when six or more came ends meet', () => {
    const result = runChecks(buildInput(star(6)), STRUCTURAL_RULES)
    const crowded = result.violations.filter((v) => v.ruleId === 'crowded-joint')
    expect(crowded).toHaveLength(1)
    expect(crowded[0]!.severity).toBe('error')
  })

  it('is silent at a normal four-way crossing', () => {
    const result = runChecks(buildInput(star(4)), STRUCTURAL_RULES)
    expect(result.violations.some((v) => v.ruleId === 'crowded-joint')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* panel-needs-reinforcement + the reinforcement bar (FR-2)                     */
/* -------------------------------------------------------------------------- */

describe('panel-needs-reinforcement (FR-2)', () => {
  const w = 900
  const h = 600
  const bigPanel = (bars: ReinforcementBar[] = []) => projectFrom(borderRect(w, h), bars)

  function borderRect(width: number, height: number): Draft[] {
    const A = vec2(0, 0)
    const B = vec2(width, 0)
    const C = vec2(width, height)
    const D = vec2(0, height)
    return [seg(A, B, 'border'), seg(B, C, 'border'), seg(C, D, 'border'), seg(D, A, 'border')]
  }

  it('flags an oversized panel with no bar (area and span)', () => {
    const result = runChecks(buildInput(bigPanel()), STRUCTURAL_RULES)
    const v = result.violations.filter((r) => r.ruleId === 'panel-needs-reinforcement')
    expect(v).toHaveLength(1)
    expect(v[0]!.message).toMatch(/area/)
    expect(v[0]!.message).toMatch(/span/)
  })

  it('clears once a bar spans the long dimension', () => {
    const bar: ReinforcementBar = {
      id: 'r1',
      a: vec2(50, 300),
      b: vec2(850, 300),
      widthMm: 6,
      material: 'zinc',
    }
    const result = runChecks(buildInput(bigPanel([bar])), STRUCTURAL_RULES)
    expect(result.violations.some((r) => r.ruleId === 'panel-needs-reinforcement')).toBe(false)
  })

  it('a bar that does not span the long dimension does not clear it', () => {
    // A short bar (200 mm) across a 900 mm width covers < 80 %, so it does not brace the span.
    const stub: ReinforcementBar = {
      id: 'r2',
      a: vec2(350, 300),
      b: vec2(550, 300),
      widthMm: 6,
      material: 'steel',
    }
    const result = runChecks(buildInput(bigPanel([stub])), STRUCTURAL_RULES)
    expect(result.violations.some((r) => r.ruleId === 'panel-needs-reinforcement')).toBe(true)
  })

  it('is silent on a small panel', () => {
    const small = projectFrom(borderRect(300, 300))
    const result = runChecks(buildInput(small), STRUCTURAL_RULES)
    expect(result.violations.some((r) => r.ruleId === 'panel-needs-reinforcement')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* panel-weight (FR-3): accurate within 10 % of a hand computation              */
/* -------------------------------------------------------------------------- */

describe('panel-weight (FR-3)', () => {
  /** A single square glass piece of the given size + thickness, in a plain rectangular border. */
  function squarePanel(sizeMm: number, thicknessMm: number): Project {
    const A = vec2(0, 0)
    const B = vec2(sizeMm, 0)
    const C = vec2(sizeMm, sizeMm)
    const D = vec2(0, sizeMm)
    const base = projectFrom([
      seg(A, B, 'border'),
      seg(B, C, 'border'),
      seg(C, D, 'border'),
      seg(D, A, 'border'),
    ])
    const { pieces } = detectPieces(outputSegments(base))
    const assignments: Record<string, string> = {}
    for (const p of pieces) assignments[pieceKey(p)] = 'g'
    return {
      ...base,
      glasses: {
        g: {
          id: 'g',
          name: 'Ref',
          color: '#cccccc',
          transparency: 'transparent',
          texture: 'smooth',
          thicknessMm,
        },
      },
      assignments,
    }
  }

  it('matches a hand-computed reference panel within 10 %', () => {
    // 200 × 200 mm, 4 mm glass, default H 5 mm came (flange 5, heart 1.5).
    // Glass: 40 000 mm² × 4 mm × 2.5e-3 g/mm³ = 400 g.
    // Lead: perimeter 800 mm × (5 × 1.5 mm² × 11.34e-3 g/mm³) = 800 × 0.08505 = 68.04 g.
    // Total ≈ 468.0 g.
    const input = buildInput(squarePanel(200, 4))
    const { grams } = panelWeight(input)
    const hand = 468.04
    expect(Math.abs(grams - hand) / hand).toBeLessThan(0.1)
    expect(grams).toBeGreaterThan(400) // glass alone
  })

  it('emits an info readout below the limit and a warning above it', () => {
    const light = runChecks(buildInput(squarePanel(200, 4)), STRUCTURAL_RULES)
    const lightWeight = light.violations.find((v) => v.ruleId === 'panel-weight')
    expect(lightWeight?.severity).toBe('info')
    expect(lightWeight?.message).toMatch(/kg/)

    // A big, thick panel (1500 mm, 6 mm) is well over the 15 kg default.
    const heavy = runChecks(buildInput(squarePanel(1500, 6)), STRUCTURAL_RULES)
    const heavyWeight = heavy.violations.find((v) => v.ruleId === 'panel-weight')
    expect(heavyWeight?.severity).toBe('warning')
  })

  it('weighs an unassigned piece at the default 3 mm thickness', () => {
    const A = vec2(0, 0)
    const bare = projectFrom([
      seg(A, vec2(200, 0), 'border'),
      seg(vec2(200, 0), vec2(200, 200), 'border'),
      seg(vec2(200, 200), vec2(0, 200), 'border'),
      seg(vec2(0, 200), A, 'border'),
    ])
    const input = buildInput(bare)
    const glass = 40000 * 3 * 2.5e-3 // 300 g
    expect(panelWeight(input).glassGrams).toBeCloseTo(glass, 3)
  })
})

/* -------------------------------------------------------------------------- */
/* tiny-edge-contact                                                            */
/* -------------------------------------------------------------------------- */

describe('tiny-edge-contact', () => {
  it('flags a piece meeting the border along less than the minimum', () => {
    // A small triangle whose only border contact is an 8 mm strip of the bottom edge.
    const w = 200
    const h = 200
    const P = vec2(95, 0)
    const R = vec2(103, 0) // 8 mm apart on the bottom edge
    const apex = vec2(99, 60)
    const drafts: Draft[] = [
      // Border with the bottom edge split at P and R.
      seg(vec2(0, 0), P, 'border'),
      seg(P, R, 'border'),
      seg(R, vec2(w, 0), 'border'),
      seg(vec2(w, 0), vec2(w, h), 'border'),
      seg(vec2(w, h), vec2(0, h), 'border'),
      seg(vec2(0, h), vec2(0, 0), 'border'),
      // The triangle's two interior sides.
      seg(P, apex),
      seg(R, apex),
    ]
    const result = runChecks(buildInput(projectFrom(drafts)), STRUCTURAL_RULES)
    const tiny = result.violations.filter((v) => v.ruleId === 'tiny-edge-contact')
    expect(tiny).toHaveLength(1)
    expect(tiny[0]!.message).toMatch(/8\.0 mm/)
  })

  it('is silent when pieces meet the border along a long edge', () => {
    const w = 200
    const h = 200
    const drafts: Draft[] = [
      seg(vec2(0, 0), vec2(w, 0), 'border'),
      seg(vec2(w, 0), vec2(w, h), 'border'),
      seg(vec2(w, h), vec2(0, h), 'border'),
      seg(vec2(0, h), vec2(0, 0), 'border'),
      // A central divider — both halves meet the border along full edges.
      seg(vec2(w / 2, 0), vec2(w / 2, h)),
    ]
    const result = runChecks(buildInput(projectFrom(drafts)), STRUCTURAL_RULES)
    expect(result.violations.some((v) => v.ruleId === 'tiny-edge-contact')).toBe(false)
  })
})
