import { clamp01 } from '@vitrum/geometry'

import type { Rgb } from '../render/shading'

/**
 * The sky / sun light model (F-054): how bright and what colour the sunlight is for a given solar
 * elevation, plus a colour-temperature (kelvin) → RGB approximation. Pure and unit-tested — this is
 * the "warm low sun, bright cool high sun, dark at night" behaviour FR-2 checks in the resolver.
 */

/** The derived light for a solar elevation: a brightness scalar, a colour temperature and its RGB. */
export interface SkyLight {
  /** 0 (night) … 1 (sun high) brightness scalar. */
  readonly intensity: number
  /** Correlated colour temperature in kelvin (warm ≈ 2200 K at the horizon, cool ≈ 6500 K high). */
  readonly temperatureK: number
  /** The light colour (kelvin → RGB, then dimmed for overcast). */
  readonly color: Rgb
}

/** Elevation (deg) below which the sun contributes no direct light (civil-ish twilight floor). */
const NIGHT_FLOOR_DEG = -6

/**
 * Approximate a blackbody colour temperature (1000–12000 K) as linear-ish 0..1 RGB. A compact
 * piecewise fit (Tanner Helland's widely used approximation), clamped to the sane range. Warm
 * (low K) pulls toward orange, cool (high K) toward pale blue; ~6600 K is near white.
 */
export function kelvinToRgb(kelvin: number): Rgb {
  const k = Math.max(1000, Math.min(12_000, kelvin)) / 100
  let r: number
  let g: number
  let b: number
  if (k <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(k) - 161.1195681661
  } else {
    r = 329.698727446 * Math.pow(k - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(k - 60, -0.0755148492)
  }
  if (k >= 66) {
    b = 255
  } else if (k <= 19) {
    b = 0
  } else {
    b = 138.5177312231 * Math.log(k - 10) - 305.0447927307
  }
  return {
    r: clamp01(r / 255),
    g: clamp01(g / 255),
    b: clamp01(b / 255),
  }
}

/**
 * The light for a solar elevation. Intensity ramps up from the night floor and saturates as the sun
 * climbs; temperature warms toward the horizon (golden hour) and cools as the sun rises. `overcast`
 * flattens the light: dimmer, cooler-neutral and softened (the caller uses a wider halo for it).
 */
export function skyLight(elevationDeg: number, overcast = false): SkyLight {
  if (elevationDeg <= NIGHT_FLOOR_DEG) {
    return { intensity: 0, temperatureK: 6500, color: { r: 0, g: 0, b: 0 } }
  }
  // Smooth 0..1 ramp: dim near the horizon, full by ~25°.
  const climb = clamp01((elevationDeg - NIGHT_FLOOR_DEG) / (25 - NIGHT_FLOOR_DEG))
  const intensityClear = 0.15 + 0.85 * (climb * climb * (3 - 2 * climb))
  // Warm at the horizon (~2200 K), cool by ~40° (~6500 K).
  const warmMix = clamp01(elevationDeg / 40)
  const temperatureK = 2200 + warmMix * (6500 - 2200)

  if (overcast) {
    // Overcast: dimmer, neutral-cool, no golden-hour warmth.
    const dimmed = intensityClear * 0.55
    return { intensity: dimmed, temperatureK: 6800, color: dimColor(kelvinToRgb(6800), 0.9) }
  }
  return { intensity: intensityClear, temperatureK, color: kelvinToRgb(temperatureK) }
}

function dimColor(c: Rgb, k: number): Rgb {
  return { r: c.r * k, g: c.g * k, b: c.b * k }
}
