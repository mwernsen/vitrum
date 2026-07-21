import {
  arc,
  compose,
  line,
  transformShape,
  vec2,
  type Transform2D,
  type Vec2,
} from '@vitrum/geometry'

import { arcCommand, parsePathData, type PathGeometry } from './path'
import { parseTransform } from './transform'
import { parseLength, parseViewBox, type SvgSizeInfo } from './units'
import { parseXml, type XmlElement } from './xml'

/**
 * Parse an SVG string into geometry (F-050). The result holds every drawable path/shape as kernel
 * geometry in the SVG's **user-unit** coordinate space (the caller scales to mm via
 * {@link import('./units').resolveUnits}), the root size info for unit mapping, and the kinds of
 * unsupported content that were dropped so the UI can report them (FR-5) rather than silently
 * discarding them. Fully DOM-free — it operates on the parsed string, so it runs and unit-tests in
 * plain Node.
 */
export interface ParsedSvg {
  /** Every drawable geometry, with the full CTM already applied, in user units. */
  readonly geometries: readonly PathGeometry[]
  /** Root `width`/`height`/`viewBox`, for resolving the physical scale. */
  readonly size: SvgSizeInfo
  /** Unsupported content that was dropped, as human-readable kind labels (FR-5). */
  readonly dropped: readonly string[]
}

/** Canonical labels for the unsupported content kinds F-050 drops but reports (FR-5). */
const DROPPED_LABELS = {
  text: 'text',
  raster: 'raster images',
  gradient: 'gradients',
  clip: 'clip paths',
  mask: 'masks',
  use: 'symbol references (use)',
} as const

type DroppedKey = keyof typeof DROPPED_LABELS

export function parseSvg(source: string): ParsedSvg {
  const root = parseXml(source)
  if (root.name !== 'svg') throw new Error('parseSvg: root element is not <svg>')

  const size: SvgSizeInfo = {
    width: parseLength(root.attrs['width']),
    height: parseLength(root.attrs['height']),
    viewBox: parseViewBox(root.attrs['viewBox']),
  }

  const geometries: PathGeometry[] = []
  const dropped = new Set<DroppedKey>()
  walk(root, parseTransform(root.attrs['transform']), geometries, dropped, false)

  return {
    geometries,
    size,
    dropped: [...dropped].map((key) => DROPPED_LABELS[key]),
  }
}

/**
 * Walk an element, composing its transform onto the inherited CTM and emitting geometry for every
 * shape. `inDefs` is true inside `<defs>`, whose contents define but never render, so shapes there
 * are skipped (but gradients/clip paths found there are still reported as dropped).
 */
function walk(
  el: XmlElement,
  ctm: Transform2D,
  out: PathGeometry[],
  dropped: Set<DroppedKey>,
  inDefs: boolean,
): void {
  const local = compose(ctm, parseTransform(el.attrs['transform']))

  // Report a clip-path reference on any element (we ignore it, but never silently).
  if (el.attrs['clip-path']) dropped.add('clip')

  switch (el.name) {
    case 'defs':
      for (const child of el.children) walk(child, local, out, dropped, true)
      return
    case 'g':
    case 'svg':
    case 'a':
    case 'switch':
      for (const child of el.children) walk(child, local, out, dropped, inDefs)
      return
    case 'text':
    case 'tspan':
    case 'textpath':
      dropped.add('text')
      return
    case 'image':
      dropped.add('raster')
      return
    case 'lineargradient':
    case 'radialgradient':
      dropped.add('gradient')
      return
    case 'clippath':
      dropped.add('clip')
      return
    case 'mask':
    case 'pattern':
    case 'filter':
      dropped.add('mask')
      return
    case 'use':
      dropped.add('use')
      return
    case 'foreignobject':
      dropped.add('text')
      return
  }

  // A drawable shape. Inside <defs> it is a definition, not rendered — skip (already reported above
  // if it was a gradient/clip path).
  if (!inDefs) {
    for (const g of shapeGeometry(el)) out.push(transformShape(local, g) as PathGeometry)
  }
  for (const child of el.children) walk(child, local, out, dropped, inDefs)
}

/** Convert one shape element into kernel geometry (in the element's local coordinates). */
function shapeGeometry(el: XmlElement): PathGeometry[] {
  const a = el.attrs
  switch (el.name) {
    case 'path':
      return a['d'] ? parsePathData(a['d']) : []
    case 'line':
      return [line(vec2(num(a, 'x1'), num(a, 'y1')), vec2(num(a, 'x2'), num(a, 'y2')))]
    case 'polyline':
      return polyGeometry(a['points'], false)
    case 'polygon':
      return polyGeometry(a['points'], true)
    case 'rect':
      return rectGeometry(el)
    case 'circle': {
      const r = num(a, 'r')
      return r > 0 ? [arc(vec2(num(a, 'cx'), num(a, 'cy')), r, 0, Math.PI * 2, true)] : []
    }
    case 'ellipse':
      return ellipseGeometry(num(a, 'cx'), num(a, 'cy'), num(a, 'rx'), num(a, 'ry'))
    default:
      return []
  }
}

function rectGeometry(el: XmlElement): PathGeometry[] {
  const a = el.attrs
  const x = num(a, 'x')
  const y = num(a, 'y')
  const w = num(a, 'width')
  const h = num(a, 'height')
  if (w <= 0 || h <= 0) return []

  let rx = a['rx'] !== undefined ? num(a, 'rx') : a['ry'] !== undefined ? num(a, 'ry') : 0
  let ry = a['ry'] !== undefined ? num(a, 'ry') : a['rx'] !== undefined ? num(a, 'rx') : 0
  rx = Math.min(Math.max(rx, 0), w / 2)
  ry = Math.min(Math.max(ry, 0), h / 2)

  if (rx === 0 || ry === 0) {
    return [
      line(vec2(x, y), vec2(x + w, y)),
      line(vec2(x + w, y), vec2(x + w, y + h)),
      line(vec2(x + w, y + h), vec2(x, y + h)),
      line(vec2(x, y + h), vec2(x, y)),
    ]
  }

  // Rounded rectangle: straight edges joined by elliptical (or circular) corner arcs, clockwise
  // from the top edge, matching the SVG rect definition.
  const out: PathGeometry[] = []
  out.push(line(vec2(x + rx, y), vec2(x + w - rx, y)))
  out.push(...arcCommand(vec2(x + w - rx, y), vec2(x + w, y + ry), rx, ry, 0, false, true))
  out.push(line(vec2(x + w, y + ry), vec2(x + w, y + h - ry)))
  out.push(...arcCommand(vec2(x + w, y + h - ry), vec2(x + w - rx, y + h), rx, ry, 0, false, true))
  out.push(line(vec2(x + w - rx, y + h), vec2(x + rx, y + h)))
  out.push(...arcCommand(vec2(x + rx, y + h), vec2(x, y + h - ry), rx, ry, 0, false, true))
  out.push(line(vec2(x, y + h - ry), vec2(x, y + ry)))
  out.push(...arcCommand(vec2(x, y + ry), vec2(x + rx, y), rx, ry, 0, false, true))
  return out
}

function ellipseGeometry(cx: number, cy: number, rx: number, ry: number): PathGeometry[] {
  if (rx <= 0 || ry <= 0) return []
  if (Math.abs(rx - ry) <= 1e-9) return [arc(vec2(cx, cy), rx, 0, Math.PI * 2, true)]
  // Two half-ellipse arcs joined at the horizontal extremes → cubic chains covering the full ellipse.
  return [
    ...arcCommand(vec2(cx - rx, cy), vec2(cx + rx, cy), rx, ry, 0, true, true),
    ...arcCommand(vec2(cx + rx, cy), vec2(cx - rx, cy), rx, ry, 0, true, true),
  ]
}

function polyGeometry(pointsAttr: string | undefined, close: boolean): PathGeometry[] {
  if (!pointsAttr) return []
  const nums: number[] = []
  const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pointsAttr)) !== null) nums.push(Number(m[0]))
  const pts: Vec2[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push(vec2(nums[i]!, nums[i + 1]!))
  if (pts.length < 2) return []
  const out: PathGeometry[] = []
  for (let i = 0; i < pts.length - 1; i++) out.push(line(pts[i]!, pts[i + 1]!))
  if (close) out.push(line(pts[pts.length - 1]!, pts[0]!))
  return out
}

function num(attrs: Readonly<Record<string, string>>, key: string): number {
  const raw = attrs[key]
  if (raw === undefined) return 0
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : 0
}

/** Scale every geometry from user units to millimetres (the resolved `userUnitMm`). */
export function scaleGeometries(
  geometries: readonly PathGeometry[],
  userUnitMm: number,
): PathGeometry[] {
  if (userUnitMm === 1) return [...geometries]
  const t: Transform2D = { a: userUnitMm, b: 0, c: 0, d: userUnitMm, e: 0, f: 0 }
  return geometries.map((g) => transformShape(t, g) as PathGeometry)
}
