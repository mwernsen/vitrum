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

const TEXTURE_PARAMS: Record<TextureTag, TextureParams> = {
  smooth: { kind: TEXTURE_KIND.smooth, frequencyPerMm: 0, amplitude: 0, anisotropy: 1 },
  hammered: { kind: TEXTURE_KIND.hammered, frequencyPerMm: 0.18, amplitude: 0.16, anisotropy: 1 },
  seedy: { kind: TEXTURE_KIND.seedy, frequencyPerMm: 0.5, amplitude: 0.12, anisotropy: 1 },
  streaky: { kind: TEXTURE_KIND.streaky, frequencyPerMm: 0.09, amplitude: 0.2, anisotropy: 6 },
  ripple: { kind: TEXTURE_KIND.ripple, frequencyPerMm: 0.14, amplitude: 0.14, anisotropy: 4 },
  granite: { kind: TEXTURE_KIND.granite, frequencyPerMm: 0.9, amplitude: 0.1, anisotropy: 1 },
}

/** The procedural texture parameters for a texture tag. */
export function textureParams(texture: TextureTag): TextureParams {
  return TEXTURE_PARAMS[texture]
}
