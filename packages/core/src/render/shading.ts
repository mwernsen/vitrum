import { clamp01 } from '@vitrum/geometry'

/**
 * Pure shading maths for the realistic glass render (F-053). Everything here is framework- and
 * model-free: it takes plain numbers and the two glass string-unions (mirrored structurally from
 * `@vitrum/model`, the same discipline piece detection and the drawing tools follow), so
 * `packages/core` stays a leaf. The WebGL fragment shader mirrors these exact formulas on the GPU;
 * keeping the reference implementation here — pure and unit-tested — is what lets us assert the
 * transmission model is distinct and monotonic across transparency classes (FR-2) without a GL
 * context. The look itself ("believable", the spec's open question) is a gallery sign-off handed to
 * Mathieu; these functions only fix the *shape* of the model, not the final art direction.
 */

/** How light passes through a glass (mirrors `@vitrum/model`'s `TransparencyClass`). */
export type TransparencyClass = 'transparent' | 'translucent' | 'opalescent' | 'opaque'

/** Surface texture of a glass (mirrors `@vitrum/model`'s `TextureTag`). */
export type TextureTag = 'smooth' | 'hammered' | 'seedy' | 'streaky' | 'ripple' | 'granite'

/** A linear RGB colour, each channel in 0..1. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/**
 * The adjustable uniform daylight backlight (F-053). `intensity` scales overall brightness (1 =
 * neutral daylight; F-054 replaces this with the real sun). `warmth` tints the light warm (+1,
 * afternoon) or cool (−1, north sky), 0 = neutral white.
 */
export interface Backlight {
  readonly intensity: number
  readonly warmth: number
}

/** The neutral default backlight: full-intensity, untinted daylight. */
export const DEFAULT_BACKLIGHT: Backlight = { intensity: 1, warmth: 0 }

/**
 * Light transmission per transparency class: the fraction of backlight the glass lets through, so a
 * transparent antique glows and an opaque cathedral stays dense. Strictly **decreasing** clear →
 * solid and every value **distinct** (FR-2), verified by the unit test. These are art-direction
 * seeds, not physics; the gallery pass tunes them.
 */
export const TRANSMISSION: Record<TransparencyClass, number> = {
  transparent: 0.95,
  translucent: 0.72,
  opalescent: 0.5,
  opaque: 0.24,
}

/** The transmission scalar (0..1) for a transparency class. */
export function transmission(transparency: TransparencyClass): number {
  return TRANSMISSION[transparency]
}

/**
 * The backlight's colour for a given warmth. Neutral is white; positive warmth pulls blue down
 * (warm), negative pulls red down (cool). Kept multiplicative and ≤ 1 per channel so it only ever
 * tints, never blows out — the intensity does the brightening.
 */
export function daylight(warmth: number): Rgb {
  const w = Math.max(-1, Math.min(1, warmth))
  return {
    r: 1 - Math.max(0, -w) * 0.15,
    g: 1 - Math.abs(w) * 0.06,
    b: 1 - Math.max(0, w) * 0.18,
  }
}

/**
 * The colour a piece of glass shows when backlit: its base colour modulated by the light colour and
 * scaled by a luminous gain (opaque glass transmits little and stays dark; transparent glass is
 * bright and picks up a faint glow of the light colour). Monotonic in both `intensity` and
 * `transmission` per channel (unit-tested), so the backlight sliders behave predictably. This is the
 * exact formula the fragment shader mirrors; keep the two in lock-step.
 */
export function litColor(glass: Rgb, transmission: number, backlight: Backlight): Rgb {
  const light = daylight(backlight.warmth)
  const t = clamp01(transmission)
  const gain = backlight.intensity * (0.35 + 0.65 * t)
  const bloom = t * 0.15 * backlight.intensity
  return {
    r: clamp01(glass.r * light.r * gain + light.r * bloom),
    g: clamp01(glass.g * light.g * gain + light.g * bloom),
    b: clamp01(glass.b * light.b * gain + light.b * bloom),
  }
}

/** Parse an sRGB hex string (`#rgb` or `#rrggbb`) to linear-ish 0..1 RGB. Bad input → mid grey. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0.5, g: 0.5, b: 0.5 }
  let h = m[1]!
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  }
}

/** Format 0..1 RGB back to a lowercase `#rrggbb` string. */
export function rgbToHex(rgb: Rgb): string {
  const byte = (v: number): string =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`
}

/**
 * The numeric texture kind the shader switches on. Stable integer codes (never reordered) since they
 * cross into GLSL as a uniform.
 */
export const TEXTURE_KIND: Record<TextureTag, number> = {
  smooth: 0,
  hammered: 1,
  seedy: 2,
  streaky: 3,
  ripple: 4,
  granite: 5,
}

/**
 * Procedural texture parameters per tag, consumed as shader uniforms. `frequencyPerMm` sets the noise
 * cell size in world mm (so texture is stable in world space and per-piece transforms compose with
 * it), `amplitude` the brightness modulation depth, `anisotropy` the directional stretch (streaky /
 * ripple run along one axis). `smooth` has zero amplitude — a flat, untextured glass. Each tag maps
 * to a **distinct** parameter set (unit-tested), so the classes read apart side by side.
 */
export interface TextureParams {
  readonly kind: number
  readonly frequencyPerMm: number
  readonly amplitude: number
  readonly anisotropy: number
}

/**
 * Tuned against Mathieu's reference photo of a real leaded panel (F-064): the blotches in rolled
 * cathedral glass are **large** — roughly 5–15 mm across, so frequencies sit near 0.1/mm, not the
 * fine dust an 0.5/mm grain produces — and their depth is far stronger than a subtle 0.1.
 *
 * `smooth` stays flat here: giving it an amplitude would be inert, because kind 0 short-circuits in
 * both the CPU mirror and the fragment shader. Real antique glass is never optically flat, so a faint
 * unevenness for `smooth` is scoped to F-064 thrust A, where the height-field branch is added to the
 * CPU function and the GLSL together.
 */
const TEXTURE_PARAMS: Record<TextureTag, TextureParams> = {
  smooth: { kind: TEXTURE_KIND.smooth, frequencyPerMm: 0, amplitude: 0, anisotropy: 1 },
  hammered: { kind: TEXTURE_KIND.hammered, frequencyPerMm: 0.11, amplitude: 0.3, anisotropy: 1 },
  seedy: { kind: TEXTURE_KIND.seedy, frequencyPerMm: 0.32, amplitude: 0.26, anisotropy: 1 },
  streaky: { kind: TEXTURE_KIND.streaky, frequencyPerMm: 0.07, amplitude: 0.34, anisotropy: 6 },
  ripple: { kind: TEXTURE_KIND.ripple, frequencyPerMm: 0.1, amplitude: 0.26, anisotropy: 4 },
  granite: { kind: TEXTURE_KIND.granite, frequencyPerMm: 0.45, amplitude: 0.2, anisotropy: 1 },
}

/** The procedural texture parameters for a texture tag. */
export function textureParams(texture: TextureTag): TextureParams {
  return TEXTURE_PARAMS[texture]
}

/* -------------------------------------------------------------------------- */
/* Procedural texture — the CPU mirror of the fragment shader                  */
/* -------------------------------------------------------------------------- */

/** Hash → 0..1, the fragment shader's `hash` verbatim (same constants, same result). */
function hash(x: number, y: number): number {
  const fract = (v: number): number => v - Math.floor(v)
  let px = fract(x * 123.34)
  let py = fract(y * 456.21)
  const d = px * px + py * py + px * 45.32 + py * 45.32
  px += d
  py += d
  return fract(px * py)
}

/** Value noise with a smoothstep fade — the shader's `vnoise`. */
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  const top = a + (b - a) * ux
  const bottom = c + (d - c) * ux
  return top + (bottom - top) * uy
}

/**
 * Three octaves of value noise — the shader's `fbm`. A single octave shows its integer lattice as
 * soft squares once the amplitude is strong enough to see, which is not what rolled glass looks
 * like (F-064, from the reference photo).
 */
function fbm(x: number, y: number): number {
  let n = vnoise(x, y) * 0.5
  n += vnoise(x * 2.03 + 5.2, y * 2.03 + 1.3) * 0.28
  n += vnoise(x * 4.11 + 9.7, y * 4.11 + 7.1) * 0.14
  return n / 0.92
}

/**
 * Domain warp then fBm — the shader's `gnoise`, the grain field every texture tag builds on.
 * Displacing the sample point by a low-frequency noise vector bends the lattice into organic
 * blotches instead of axis-aligned cells.
 */
function gnoise(x: number, y: number): number {
  const wx = vnoise(x * 0.5 + 1.7, y * 0.5 + 8.3) - 0.5
  const wy = vnoise(x * 0.5 + 4.9, y * 0.5 + 2.1) - 0.5
  return fbm(x + wx * 1.6, y + wy * 1.6)
}

/* -------------------------------------------------------------------------- */
/* Surface material model (F-064 thrust A)                                     */
/* -------------------------------------------------------------------------- */

/** A unit surface normal in texture space; `z` faces the viewer. */
export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * The thickness the transmission model is calibrated at. A piece of this thickness, seen through a
 * flat part of its surface, transmits exactly `litColor` — so the F-053 reference stays the nominal
 * case and thickness only ever deepens or lightens *relative* to it.
 */
export const REFERENCE_THICKNESS_MM = 3

/** The frequency of the smooth tag's long surface rolls, and of the hue drift, per mm. */
const SMOOTH_HEIGHT_FREQ = 0.04
const HUE_DRIFT_FREQ = 0.035

/**
 * How a glass's surface behaves as a *material* rather than as a pattern (F-064 thrust A): how deep
 * its relief actually is, how glossy its front face is, and how far its colour drifts across a
 * sheet. This is what turns "brightness times noise" into a lit surface.
 */
export interface SurfaceParams {
  /** Peak-to-trough relief of the surface in mm — how deep the texture physically is. */
  readonly reliefMm: number
  /** Front-surface gloss, 0..1, driving the Fresnel sheen. */
  readonly gloss: number
  /** How far the hue drifts across the sheet, 0..1. Streaky glass drifts most. */
  readonly hueDrift: number
  /** The mm step for the finite-difference normal, scaled to the tag's feature size. */
  readonly normalStepMm: number
}

const SURFACE: Record<TextureTag, SurfaceParams> = {
  // Antique glass is never optically flat: a faint long roll, and the glossiest front face.
  smooth: { reliefMm: 0.06, gloss: 1, hueDrift: 0.06, normalStepMm: 4 },
  hammered: { reliefMm: 0.9, gloss: 0.9, hueDrift: 0.12, normalStepMm: 2.2 },
  seedy: { reliefMm: 0.45, gloss: 0.85, hueDrift: 0.1, normalStepMm: 0.9 },
  streaky: { reliefMm: 0.32, gloss: 0.8, hueDrift: 0.5, normalStepMm: 3.4 },
  ripple: { reliefMm: 0.7, gloss: 0.95, hueDrift: 0.12, normalStepMm: 2.4 },
  granite: { reliefMm: 0.24, gloss: 0.55, hueDrift: 0.2, normalStepMm: 0.6 },
}

/** Denser glass scatters rather than reflects, so it reads less glossy. */
const GLOSS_BY_TRANSPARENCY: Record<TransparencyClass, number> = {
  transparent: 1,
  translucent: 0.85,
  opalescent: 0.6,
  opaque: 0.4,
}

/**
 * The surface material for a glass. Gloss comes from the texture tag *and* the transparency class —
 * derived, never authored, so no `Glass` field is needed (F-064 open question 2).
 */
export function surfaceParams(texture: TextureTag, transparency: TransparencyClass): SurfaceParams {
  const base = SURFACE[texture]
  return { ...base, gloss: base.gloss * GLOSS_BY_TRANSPARENCY[transparency] }
}

/**
 * The surface height at a point in texture space (world mm), normalised 0..1. Every texture tag is a
 * shape of *surface*, not a shape of brightness — that reframing is what lets the same field drive
 * relief lighting, the refractive offset and the optical path length. Mirrored verbatim in both
 * fragment shaders.
 */
export function heightField(texture: TextureTag, x: number, y: number): number {
  const { kind, frequencyPerMm, anisotropy } = textureParams(texture)
  const freq = frequencyPerMm > 0 ? frequencyPerMm : SMOOTH_HEIGHT_FREQ
  const fx = x * freq
  const fy = y * freq
  switch (kind) {
    case TEXTURE_KIND.hammered: {
      // Dimples: ridged noise gives rounded hollows rather than smooth hills.
      return 1 - Math.abs(2 * gnoise(fx, fy) - 1)
    }
    case TEXTURE_KIND.seedy: {
      // Bubbles sit proud of the surface in sparse round patches.
      const t = clamp01((gnoise(fx, fy) - 0.72) / 0.2)
      return t * t * (3 - 2 * t)
    }
    case TEXTURE_KIND.streaky:
      return gnoise(fx / anisotropy, fy)
    case TEXTURE_KIND.ripple:
      return (
        0.5 + 0.5 * Math.sin((y * freq * 2 * Math.PI) / anisotropy) * (0.6 + 0.4 * gnoise(fx, fy))
      )
    case TEXTURE_KIND.granite:
      return gnoise(fx, fy) * 0.6 + gnoise(fx * 2.7, fy * 2.7) * 0.4
    default:
      // smooth: a faint long roll, so even "flat" glass is not a dead plane.
      return gnoise(fx, fy)
  }
}

/**
 * The unit surface normal at a point, by forward differences on `heightField`. Forward (not central)
 * differences keep this to three height evaluations per fragment, which matters because the height
 * field is multi-octave noise (FR-6).
 */
export function surfaceNormal(
  texture: TextureTag,
  x: number,
  y: number,
  reliefMm: number,
  stepMm: number,
): Vec3 {
  const step = Math.max(stepMm, 1e-4)
  const h0 = heightField(texture, x, y)
  const dx = ((heightField(texture, x + step, y) - h0) * reliefMm) / step
  const dy = ((heightField(texture, x, y + step) - h0) * reliefMm) / step
  const len = Math.sqrt(dx * dx + dy * dy + 1)
  return { x: -dx / len, y: -dy / len, z: 1 / len }
}

/**
 * How far light travels through the glass, relative to the reference thickness. A tilted surface
 * lengthens the path, which is precisely why relief shows up as varying colour *depth* rather than
 * as varying brightness. Clamped so a near-vertical slope cannot blow the path up without bound.
 */
export function pathRatio(thicknessMm: number, normalZ: number): number {
  const thickness = Math.max(thicknessMm, 0.1) / REFERENCE_THICKNESS_MM
  return thickness / Math.max(normalZ, 0.25)
}

/**
 * The Beer–Lambert deepening factor for a given path ratio, applied *relative* to the reference
 * case: at `ratio === 1` every channel is exactly 1, so `litColor` is reproduced untouched. Longer
 * paths push each channel toward its own absorption, which deepens saturated glass much faster than
 * pale glass — the reason thick ruby reads almost black at a steep slope while thick opal barely
 * changes.
 */
export function pathDepthFactor(glass: Rgb, ratio: number): Rgb {
  const exponent = ratio - 1
  const channel = (c: number): number => Math.pow(Math.max(c, 0.004), exponent)
  return { r: channel(glass.r), g: channel(glass.g), b: channel(glass.b) }
}

/**
 * Schlick's Fresnel reflectance for the glass's front face, scaled by gloss. Head-on the surface
 * barely reflects (≈ 4%); where relief tilts it away, reflectance climbs steeply — which is what
 * puts bright glints along the edges of hammered dimples and ripple crests, and the single strongest
 * cue that a surface is glass rather than paper.
 */
export function fresnelSheen(normalZ: number, gloss: number): number {
  const f0 = 0.04
  const grazing = Math.pow(1 - clamp01(normalZ), 5)
  return (f0 + (1 - f0) * grazing) * clamp01(gloss)
}

/**
 * The per-channel hue drift across a sheet: real streaky and cathedral glass streaks *different
 * colours* together, where the old model multiplied one hue by grey noise. A single low-frequency
 * field pushes warm and cool in opposite directions, so a piece drifts between two tints of its own
 * colour rather than just getting lighter and darker.
 */
export function hueDriftMultiplier(amount: number, x: number, y: number): Rgb {
  const d = gnoise(x * HUE_DRIFT_FREQ, y * HUE_DRIFT_FREQ) - 0.5
  return { r: 1 + d * amount, g: 1 + d * amount * 0.15, b: 1 - d * amount }
}

/**
 * The brightness multiplier a glass's surface texture applies at a point in texture space
 * (world mm). This is the CPU mirror of the F-053 fragment shader's texture branch — same noise,
 * same per-tag formulas — so a 2D preview of a glass (the glass editor's swatch) reads the same
 * as the piece will on the render view. `smooth` is flat and always returns exactly 1.
 */
export function textureModulation(texture: TextureTag, x: number, y: number): number {
  const { kind, frequencyPerMm: freq, amplitude: amp, anisotropy: aniso } = textureParams(texture)
  const fx = x * freq
  const fy = y * freq
  switch (kind) {
    case TEXTURE_KIND.hammered:
      return 1 + amp * (2 * gnoise(fx, fy) - 1)
    case TEXTURE_KIND.seedy: {
      const n = gnoise(fx, fy)
      // Sparse dark bubbles: the shader's smoothstep(0.72, 0.9, n).
      const t = clamp01((n - 0.72) / (0.9 - 0.72))
      return 1 - amp * (t * t * (3 - 2 * t))
    }
    case TEXTURE_KIND.streaky:
      return 1 + amp * (2 * gnoise(fx / aniso, fy) - 1)
    case TEXTURE_KIND.ripple: {
      const wave = Math.sin((y * freq * 2 * Math.PI) / aniso)
      return 1 + amp * wave * (0.6 + 0.4 * gnoise(fx, fy))
    }
    case TEXTURE_KIND.granite: {
      const n = gnoise(fx, fy) * 0.6 + gnoise(fx * 2.7, fy * 2.7) * 0.4
      return 1 + amp * (2 * n - 1)
    }
    default:
      return 1
  }
}
