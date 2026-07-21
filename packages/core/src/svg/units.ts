/**
 * SVG unit mapping (F-050, resolved decision #3). An SVG's coordinate numbers are in *user units*;
 * whether one user unit is a real millimetre depends on `width`/`height` and `viewBox`:
 *
 * - `width`/`height` carrying a real unit (`mm`, `cm`, `in`, `pt`, `pc`, `px`) **and** a `viewBox`
 *   pin the scale exactly: `userUnitMm = widthMm / viewBox.width` (FR-1). This is the unambiguous
 *   case Illustrator, Inkscape and Affinity all emit.
 * - Anything else — a bare unitless `viewBox`, unitless `width`/`height`, or no size at all — is
 *   **ambiguous**: the UI opens the scale dialog defaulting to 1 user unit = 1 mm, with a
 *   target-width field to rescale the whole artwork proportionally.
 *
 * Pure and DOM-free: it reads the already-parsed root attributes, never a live element.
 */

/** CSS/absolute length units, in millimetres per unit (px at the CSS 96 dpi reference). */
const UNIT_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  q: 0.25,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  px: 25.4 / 96,
}

/** A parsed SVG length: its numeric value and (optional) unit suffix. */
export interface SvgLength {
  readonly value: number
  readonly unit: string | null
}

export interface ViewBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The size information read off the root `<svg>`. */
export interface SvgSizeInfo {
  readonly width: SvgLength | null
  readonly height: SvgLength | null
  readonly viewBox: ViewBox | null
}

/** The resolved unit mapping. `userUnitMm` is the physical size of one user unit, when known. */
export interface UnitResolution {
  /**
   * Whether the file pins its own physical scale. When false the UI must ask (scale dialog); the
   * suggested default is `userUnitMm = 1` (1 user unit = 1 mm).
   */
  readonly ambiguous: boolean
  /** Physical size of one user unit in mm. For an ambiguous file this is the 1 mm/unit default. */
  readonly userUnitMm: number
  /** The nominal artwork width in user units (viewBox width, else the width value), for the dialog. */
  readonly artworkWidthUser: number | null
  /** The nominal artwork height in user units, for the dialog's proportional rescale. */
  readonly artworkHeightUser: number | null
}

/** Parse an SVG length string (`"210mm"`, `"300"`, `"12.5in"`) into a value + unit. */
export function parseLength(raw: string | undefined): SvgLength | null {
  if (raw === undefined) return null
  const m = /^\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(raw)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  const unit = m[2] ? m[2].toLowerCase() : null
  return { value, unit }
}

/** Parse a `viewBox="minX minY width height"` attribute. */
export function parseViewBox(raw: string | undefined): ViewBox | null {
  if (raw === undefined) return null
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [x, y, width, height] = parts as [number, number, number, number]
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/** A real physical length in mm, or null if the length is missing, unitless or a percentage. */
function lengthMm(length: SvgLength | null): number | null {
  if (!length || length.unit === null || length.unit === '%') return null
  const perUnit = UNIT_MM[length.unit]
  return perUnit === undefined ? null : length.value * perUnit
}

/**
 * Resolve how one user unit maps to millimetres from the root size info. Unambiguous only when a
 * `viewBox` is present *and* `width` carries a real physical unit; otherwise the scale is left for
 * the user (default 1 mm/unit).
 */
export function resolveUnits(info: SvgSizeInfo): UnitResolution {
  const widthMm = lengthMm(info.width)
  const vb = info.viewBox

  const artworkWidthUser = vb ? vb.width : (info.width?.value ?? null)
  const artworkHeightUser = vb ? vb.height : (info.height?.value ?? null)

  if (vb && widthMm !== null && vb.width > 0) {
    return {
      ambiguous: false,
      userUnitMm: widthMm / vb.width,
      artworkWidthUser,
      artworkHeightUser,
    }
  }

  return { ambiguous: true, userUnitMm: 1, artworkWidthUser, artworkHeightUser }
}

/**
 * The scale (mm per user unit) that makes the artwork exactly `targetWidthMm` wide, given its width
 * in user units. Used by the scale dialog's target-width field to rescale proportionally.
 */
export function scaleForTargetWidth(artworkWidthUser: number, targetWidthMm: number): number {
  if (artworkWidthUser <= 0) return 1
  return targetWidthMm / artworkWidthUser
}
