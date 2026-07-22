import { clamp01 } from '@vitrum/geometry'

import type { Rgb } from '../render/shading'

import { projectSunOnPanel } from './panel'
import { solarPosition, type SolarPosition } from './position'
import { kelvinToRgb, skyLight } from './sky'

/**
 * Resolve the effective sun for the light render (F-054). Takes the persisted, mode-agnostic light
 * setup (mirrored structurally from `@vitrum/model`'s `LightSettings`, the F-053/F-020 discipline
 * that keeps `packages/core` a leaf) and produces the single `ResolvedSun` the WebGL light pass
 * consumes. Pure and unit-tested — the FR-2 seasonal directions are asserted here.
 */

export type LightMode = 'manual' | 'astronomical'

/** Mode-agnostic light setup (mirrors `@vitrum/model`'s `LightSettings`). */
export interface LightInput {
  readonly mode: LightMode
  // Astronomical (365 days):
  readonly latitudeDeg: number
  readonly longitudeDeg: number
  /** Compass direction the window front faces (0 = N, 90 = E, 180 = S, 270 = W). */
  readonly facadeAzimuthDeg: number
  /** Glass tilt from horizontal: 90 = vertical window, 0 = skylight. */
  readonly tiltDeg: number
  /** Day of year, 1..365. */
  readonly dayOfYear: number
  /** Local clock minutes past midnight, 0..1439. */
  readonly timeMinutes: number
  // Manual:
  /** Panel-relative sun azimuth, −90 (left) … +90 (right); 0 = straight in front. */
  readonly manualAzimuthDeg: number
  /** Panel-relative sun elevation, 0 (horizon) … 90 (zenith). */
  readonly manualElevationDeg: number
  readonly intensity: number
  readonly temperatureK: number
  // Shared:
  readonly haloIntensity: number
  readonly haloConcentration: number
  readonly overcast: boolean
}

/** The fully resolved sun for one rendered moment. */
export interface ResolvedSun {
  /** Sky azimuth (astronomical) or panel-relative azimuth (manual), for the panel readout. */
  readonly azimuthDeg: number
  readonly elevationDeg: number
  readonly aboveHorizon: boolean
  /** Cosine of incidence with the panel front, 0 when behind/below. */
  readonly frontFactor: number
  readonly inPlaneX: number
  readonly inPlaneY: number
  readonly frontal: boolean
  readonly color: Rgb
  readonly intensity: number
  readonly temperatureK: number
  readonly haloIntensity: number
  readonly haloConcentration: number
}

/** A reference year for the day-of-year → date mapping (non-leap; the difference is sub-0.5°). */
const REFERENCE_YEAR = 2025

/**
 * The UTC instant for a local clock time on `dayOfYear`, using an integer timezone estimated from
 * longitude (15° per hour). Good enough for the seasonal render (FR-2 is directional); FR-1's
 * accuracy is tested on `solarPosition` with explicit UTC dates, so this estimate never affects it.
 */
export function instantForDay(dayOfYear: number, timeMinutes: number, longitudeDeg: number): Date {
  const day = Math.max(1, Math.min(365, Math.round(dayOfYear)))
  const tzOffsetMinutes = Math.round(longitudeDeg / 15) * 60
  const utcMs =
    Date.UTC(REFERENCE_YEAR, 0, 1) +
    (day - 1) * 86_400_000 +
    (timeMinutes - tzOffsetMinutes) * 60_000
  return new Date(utcMs)
}

/** Resolve the sun for a light setup. */
export function resolveSun(input: LightInput): ResolvedSun {
  if (input.mode === 'manual') return resolveManual(input)
  return resolveAstronomical(input)
}

function resolveManual(input: LightInput): ResolvedSun {
  const sun: SolarPosition = {
    azimuthDeg: input.manualAzimuthDeg,
    elevationDeg: input.manualElevationDeg,
  }
  // Manual sun is panel-relative: project against a facade facing straight ahead (azimuth 0,
  // vertical), so azimuth 0 reads as frontal and the dome maps directly to the plane.
  const panel = projectSunOnPanel(sun, 0, 90)
  const aboveHorizon = input.manualElevationDeg > 0
  const intensity = aboveHorizon ? clamp01(input.intensity) : 0
  return {
    azimuthDeg: input.manualAzimuthDeg,
    elevationDeg: input.manualElevationDeg,
    aboveHorizon,
    frontFactor: panel.frontFactor,
    inPlaneX: panel.inPlaneX,
    inPlaneY: panel.inPlaneY,
    frontal: panel.frontal,
    color: kelvinToRgb(input.temperatureK),
    intensity,
    temperatureK: input.temperatureK,
    haloIntensity: clamp01(input.haloIntensity),
    haloConcentration: clamp01(input.haloConcentration),
  }
}

function resolveAstronomical(input: LightInput): ResolvedSun {
  const date = instantForDay(input.dayOfYear, input.timeMinutes, input.longitudeDeg)
  const sun = solarPosition(
    { latitudeDeg: input.latitudeDeg, longitudeDeg: input.longitudeDeg },
    date,
  )
  const panel = projectSunOnPanel(sun, input.facadeAzimuthDeg, input.tiltDeg)
  const sky = skyLight(sun.elevationDeg, input.overcast)
  const aboveHorizon = sun.elevationDeg > 0
  return {
    azimuthDeg: sun.azimuthDeg,
    elevationDeg: sun.elevationDeg,
    aboveHorizon,
    frontFactor: panel.frontFactor,
    inPlaneX: panel.inPlaneX,
    inPlaneY: panel.inPlaneY,
    frontal: panel.frontal,
    color: sky.color,
    // The sky drives brightness in astronomical mode; the user intensity is inert here (Decision §3).
    intensity: sky.intensity,
    temperatureK: sky.temperatureK,
    haloIntensity: clamp01(input.haloIntensity),
    haloConcentration: clamp01(input.haloConcentration),
  }
}
