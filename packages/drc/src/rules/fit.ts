import { perimeterAllowance, type PerimeterAllowance } from '@vitrum/core'
import { bboxExpand, bboxOf, bboxUnion, vec2, type BBox, type Vec2 } from '@vitrum/geometry'
import { outputSegments, type Project } from '@vitrum/model'

import { resolveThreshold } from '../thresholds'
import type { DrcInput, Rule, ThresholdSpec } from '../types'

/**
 * The panel-fit rule pack (F-033): does the design match the panel that was *ordered*? The other
 * three packs measure the drawing against itself — topology (F-030) asks whether the network closes,
 * cuttability (F-031) whether each piece can be cut, structural (F-032) whether the assembly
 * survives. None of them knows what the maker asked for. `Project.settings.panelSize` is that
 * intent — the width and height typed into the new-panel dialog (F-058) — and until now nothing
 * checked the drawing against it, so a 400 mm design in a 300 mm panel stayed silent until the
 * cutting list.
 *
 * The panel rectangle spans (0,0)→(width, height) in world mm, the same rectangle zoom-to-fit frames
 * and the canvas draws. `panelSize` is optional: with no ordered size there is no reference and the
 * pack emits nothing.
 *
 * **What the ordered size means** (Mathieu, 2026-08-16, closing this spec's open question 1):
 * `panelSize` is the **finished** panel — the outside dimensions of the assembled panel, as a
 * customer orders it and a glazier measures it. The user draws the came *centreline*, so the drawn
 * extent is not that number: perimeter came adds its own width outside the drawn border, and a
 * design drawn to exactly 300 mm assembles into something wider. This rule therefore measures the
 * **assembled** extent — the drawn extent grown by the technique's perimeter allowance (F-021's
 * `perimeterAllowance`) — against the ordered rectangle. Before that decision it compared the drawn
 * extent directly, which let a design drawn to exactly the ordered size pass clean and then not fit
 * the opening.
 */

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Format a millimetre measurement for a message: whole numbers bare, otherwise one decimal. The
 * overruns this pack reports are often sub-millimetre-ish (the tolerance is 1 mm), so rounding them
 * to whole millimetres as the structural pack does would print "1 mm" for a 1.4 mm overrun that a
 * 1 mm tolerance just let through.
 */
function mm(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** A threshold with the same default for lead and foil. */
function fixed(
  key: string,
  label: string,
  unit: string,
  value: number,
  rationale: string,
): ThresholdSpec {
  return { key, label, unit, rationale, defaultFor: () => value }
}

/** The ordered panel rectangle in world mm, or undefined when no size was ordered. */
function orderedPanel(project: Project): BBox | undefined {
  const size = project.settings.panelSize
  if (!size) return undefined
  if (!(size.width > 0) || !(size.height > 0)) return undefined
  return { min: vec2(0, 0), max: vec2(size.width, size.height) }
}

/**
 * The true extent of one finished-panel entity. Unlike the structural pack's `panelMetrics` — which
 * collects segment *endpoints* and folds in detected piece bboxes — this uses each segment's tight
 * geometric bbox, so an arc or bézier that bows outward is measured where the glass actually reaches
 * rather than where its ends happen to sit. That difference matters here and nowhere else: a hinge
 * axis is about endpoints, but "will this fit the sheet" is about the outermost millimetre.
 */
function segmentExtent(project: Project): BBox | undefined {
  let box: BBox | undefined
  for (const segment of outputSegments(project)) {
    const b = bboxOf(segment.geometry)
    box = box ? bboxUnion(box, b) : b
  }
  return box
}

/**
 * The whole design's extent: every finished-panel segment, plus the detected pieces' bboxes. The
 * pieces are folded in for the same reason `panelMetrics` does it — they are derived from the
 * *expanded* network, so a symmetry replica (F-052) that overruns the panel is measured even though
 * `DrcInput.project` carries only the source geometry.
 */
function designExtent(input: DrcInput): BBox | undefined {
  let box = segmentExtent(input.project)
  for (const piece of input.pieces) {
    box = box ? bboxUnion(box, piece.bbox) : piece.bbox
  }
  return box
}

/** The design's perimeter segments — whose came is the one that lands outside the finished edge. */
function borderSegmentIds(project: Project): string[] {
  return outputSegments(project)
    .filter((s) => s.role === 'border')
    .map((s) => s.id)
}

/**
 * How far the finished panel reaches outside the drawn line, per side, from the project's technique
 * (F-021). Derived, never a constant in this pack: a heavier perimeter came, a lighter default
 * profile or a switch to copper foil all change the answer, and only the technique model knows.
 */
function allowanceFor(project: Project): PerimeterAllowance {
  return perimeterAllowance(project.technique, borderSegmentIds(project))
}

/** Where the assembled panel reaches: the drawn extent grown by the perimeter allowance. */
function assembledExtent(drawn: BBox, allowance: PerimeterAllowance): BBox {
  return allowance.mm > 0 ? bboxExpand(drawn, allowance.mm) : drawn
}

/**
 * How the message accounts for the difference between what was drawn and what gets assembled, so the
 * maker can reconcile every number with their own ruler.
 */
function allowanceNote(drawnW: number, drawnH: number, allowance: PerimeterAllowance): string {
  const drawn = `drawn ${mm(drawnW)} × ${mm(drawnH)} mm`
  return allowance.mm > 0
    ? `${drawn} plus ${mm(allowance.mm)} mm of came on each side`
    : `${drawn}; foiled edges add no width`
}

/** How far `box` reaches outside `panel` on each side, in mm. Zero or negative ⇒ inside. */
interface Overruns {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** World y grows downward (screen order), so y = 0 is the panel's top edge. */
function overrunsOf(box: BBox, panel: BBox): Overruns {
  return {
    left: panel.min.x - box.min.x,
    right: box.max.x - panel.max.x,
    top: panel.min.y - box.min.y,
    bottom: box.max.y - panel.max.y,
  }
}

/** The worst overrun on any side. */
function worstOverrun(o: Overruns): number {
  return Math.max(o.left, o.right, o.top, o.bottom)
}

/** True when any part of `box` reaches more than `tol` mm outside `panel`. */
function outsideBy(box: BBox, panel: BBox, tol: number): boolean {
  return worstOverrun(overrunsOf(box, panel)) > tol
}

/**
 * The point of the design's extent that sticks out furthest, so the canvas marker lands on the
 * corner the maker has to look at. Axes are independent: an overrun on the right and the bottom
 * anchors at the bottom-right corner; an axis that is inside anchors at its midpoint.
 */
function anchor(box: BBox, o: Overruns): Vec2 {
  const x =
    o.right > 0 && o.right >= o.left
      ? box.max.x
      : o.left > 0
        ? box.min.x
        : (box.min.x + box.max.x) / 2
  const y =
    o.bottom > 0 && o.bottom >= o.top
      ? box.max.y
      : o.top > 0
        ? box.min.y
        : (box.min.y + box.max.y) / 2
  return vec2(x, y)
}

/** Name each overrunning side with its amount, in a stable order. */
function edgeList(o: Overruns, tol: number): string[] {
  const sides: Array<[string, number]> = [
    ['left', o.left],
    ['right', o.right],
    ['top', o.top],
    ['bottom', o.bottom],
  ]
  return sides.filter(([, d]) => d > tol).map(([name, d]) => `${mm(d)} mm past its ${name} edge`)
}

/** Join a list as prose: "a", "a and b", "a, b and c". */
function prose(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/* -------------------------------------------------------------------------- */
/* design-exceeds-panel — the drawing does not fit the ordered panel            */
/* -------------------------------------------------------------------------- */

const FIT_TOLERANCE = fixed(
  'toleranceMm',
  'Panel fit tolerance',
  'mm',
  1,
  'How far the assembled panel may fall outside the ordered rectangle before it is reported. A ' +
    'millimetre absorbs snapping and rounding slop. The perimeter came is not part of it: the ' +
    "came's own width is added to the drawn extent first, from the technique.",
)

const designExceedsPanel: Rule = {
  id: 'design-exceeds-panel',
  title: 'Exceeds panel',
  // A design that merely sits outside the rectangle can be moved back in, so the shipped default is
  // a warning; one that is genuinely larger than the ordered glass escalates itself to an error
  // below (F-031's per-violation grading seam), because no amount of moving will make it fit.
  defaultSeverity: 'warning',
  explain:
    'The panel size this document was created with is the finished panel — the outside dimensions ' +
    'of the assembled panel, as a customer orders it and a glazier measures it. What you draw is ' +
    'the came centreline, and perimeter came adds its own width outside it, so the assembled panel ' +
    'is larger than the drawing. That grown extent is what is measured here. Move or shrink the ' +
    'design, fit a lighter perimeter came, or order the panel at the size it really assembles to.',
  thresholds: [FIT_TOLERANCE],
  check: (input) => {
    const panel = orderedPanel(input.project)
    if (!panel) return []
    const drawn = designExtent(input)
    if (!drawn) return []

    const tol = resolveThreshold(input, 'design-exceeds-panel', FIT_TOLERANCE)
    // The came lands outside the drawn line, so everything below measures the *assembled* panel.
    const allowance = allowanceFor(input.project)
    const design = assembledExtent(drawn, allowance)
    const o = overrunsOf(design, panel)
    if (worstOverrun(o) <= tol) return []

    const orderedW = panel.max.x
    const orderedH = panel.max.y
    const designW = design.max.x - design.min.x
    const designH = design.max.y - design.min.y
    const tooWide = designW - orderedW
    const tooTall = designH - orderedH
    // "Bigger than the glass" is a different problem from "off the glass": the first cannot be
    // fixed by moving the design, so it is the error case.
    const tooBig = tooWide > tol || tooTall > tol

    const size = `assembles to ${mm(designW)} × ${mm(designH)} mm`
    const ordered = `the ordered ${mm(orderedW)} × ${mm(orderedH)} mm panel`
    const note = allowanceNote(drawn.max.x - drawn.min.x, drawn.max.y - drawn.min.y, allowance)
    const verdict = tooBig
      ? `${prose([
          ...(tooWide > tol ? [`${mm(tooWide)} mm wider`] : []),
          ...(tooTall > tol ? [`${mm(tooTall)} mm taller`] : []),
        ])} than ${ordered}`
      : `it fits ${ordered} but extends ${prose(edgeList(o, tol))}`
    const message = `${size} — ${verdict} (${note})`

    // Point at exactly what sticks out, so hovering the row highlights it (F-030 FR-2). Segments
    // are checked with their true geometry; pieces come from the expanded network. Each is measured
    // assembled too, so a segment drawn just inside the edge whose came lands outside is named.
    const segmentIds = outputSegments(input.project)
      .filter((s) => outsideBy(assembledExtent(bboxOf(s.geometry), allowance), panel, tol))
      .map((s) => s.id)
      .sort()
    const pieceIds = input.pieces
      .filter((p) => outsideBy(assembledExtent(p.bbox, allowance), panel, tol))
      .map((p) => p.id)
      .sort()

    return [
      {
        at: anchor(design, o),
        message,
        // One waivable item for the whole design, like `panel-needs-reinforcement`: the fit of the
        // design against its order is a single fact, not one per segment.
        identity: ['panel'],
        segmentIds,
        pieceIds,
        distance: worstOverrun(o),
        ...(tooBig ? { severity: 'error' as const } : {}),
      },
    ]
  },
}

/** The panel-fit rule pack (F-033). */
export const FIT_RULES: readonly Rule[] = [designExceedsPanel]
