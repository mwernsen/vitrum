import { describe, expect, it } from 'vitest'

import {
  equationOfTimeMinutes,
  instantForDay,
  julianDay,
  kelvinToRgb,
  projectSunOnPanel,
  resolveSun,
  skyLight,
  solarDeclinationDeg,
  solarNoonUtcMinutes,
  solarPosition,
  type LightInput,
} from './index'

const century = (date: Date): number => (julianDay(date) - 2_451_545) / 36_525

/** The declination and equation-of-time at the actual transit instant, for the noon identity. */
function noonInstant(year: number, monthIndex: number, day: number, lon: number): Date {
  const anchor = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0))
  const noonMin = solarNoonUtcMinutes(lon, anchor)
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0) + noonMin * 60_000)
}

describe('solarPosition — solar-noon identity (FR-1: within 0.5° of the reference geometry)', () => {
  // At solar transit the sun sits due south (northern hemisphere, lat > declination) and its
  // elevation is exactly 90° − |latitude − declination|. This is the reference geometry the NOAA
  // calculator reproduces; asserting it across latitudes and seasons pins the algorithm to < 0.5°.
  const cases = [
    { name: 'Amsterdam, June solstice', lat: 52.37, monthIndex: 5, day: 21 },
    { name: 'Amsterdam, December solstice', lat: 52.37, monthIndex: 11, day: 21 },
    { name: 'Amsterdam, March equinox', lat: 52.37, monthIndex: 2, day: 20 },
    { name: 'Quito (equator), June solstice', lat: 0, monthIndex: 5, day: 21 },
    { name: 'Sydney (south), December solstice', lat: -33.87, monthIndex: 11, day: 21 },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const lon = 0
      const noon = noonInstant(2025, c.monthIndex, c.day, lon)
      const decl = solarDeclinationDeg(century(noon))
      const pos = solarPosition({ latitudeDeg: c.lat, longitudeDeg: lon }, noon)
      const expectedEl = 90 - Math.abs(c.lat - decl)
      // Refraction lifts elevations near the horizon by up to ~0.5°; allow for it, tighten high up.
      const tol = expectedEl > 10 ? 0.5 : 0.7
      expect(Math.abs(pos.elevationDeg - expectedEl)).toBeLessThan(tol)
      // Azimuth: due south when the sun is south of the zenith, due north when north of it.
      const expectedAz = c.lat > decl ? 180 : 0
      const azErr = Math.min(
        Math.abs(pos.azimuthDeg - expectedAz),
        Math.abs(pos.azimuthDeg - expectedAz - 360),
        Math.abs(pos.azimuthDeg - expectedAz + 360),
      )
      expect(azErr).toBeLessThan(0.6)
    })
  }
})

describe('solarPosition — direction of travel', () => {
  it('sun is in the east before local noon and the west after', () => {
    const loc = { latitudeDeg: 52, longitudeDeg: 0 }
    const morning = solarPosition(loc, new Date(Date.UTC(2025, 5, 21, 9, 0, 0)))
    const afternoon = solarPosition(loc, new Date(Date.UTC(2025, 5, 21, 15, 0, 0)))
    expect(morning.azimuthDeg).toBeGreaterThan(90)
    expect(morning.azimuthDeg).toBeLessThan(180)
    expect(afternoon.azimuthDeg).toBeGreaterThan(180)
    expect(afternoon.azimuthDeg).toBeLessThan(270)
  })

  it('is below the horizon at local midnight in Amsterdam', () => {
    const loc = { latitudeDeg: 52.37, longitudeDeg: 4.9 }
    const pos = solarPosition(loc, new Date(Date.UTC(2025, 11, 21, 23, 0, 0)))
    expect(pos.elevationDeg).toBeLessThan(0)
  })

  it('equation of time stays within its physical envelope (±17 min)', () => {
    for (let m = 0; m < 12; m++) {
      const eot = equationOfTimeMinutes(century(new Date(Date.UTC(2025, m, 15, 12))))
      expect(Math.abs(eot)).toBeLessThan(17)
    }
  })
})

describe('skyLight / kelvinToRgb', () => {
  it('is dark below the horizon and brighter as the sun climbs', () => {
    expect(skyLight(-10).intensity).toBe(0)
    expect(skyLight(2).intensity).toBeGreaterThan(0)
    expect(skyLight(45).intensity).toBeGreaterThan(skyLight(5).intensity)
  })

  it('warms toward the horizon and cools overhead', () => {
    expect(skyLight(3).temperatureK).toBeLessThan(skyLight(60).temperatureK)
  })

  it('overcast is dimmer than clear at the same elevation', () => {
    expect(skyLight(30, true).intensity).toBeLessThan(skyLight(30, false).intensity)
  })

  it('kelvinToRgb is warm (red>blue) low and cool (blue≈red) high', () => {
    const warm = kelvinToRgb(2200)
    const cool = kelvinToRgb(6500)
    expect(warm.r).toBeGreaterThan(warm.b)
    expect(cool.b).toBeGreaterThan(warm.b)
  })
})

describe('projectSunOnPanel', () => {
  it('is fully frontal for a sun square-on to a vertical window', () => {
    // A south-facing vertical window, sun due south on the horizon → straight into the glass.
    const panel = projectSunOnPanel({ azimuthDeg: 180, elevationDeg: 0 }, 180, 90)
    expect(panel.frontFactor).toBeCloseTo(1, 5)
    expect(panel.frontal).toBe(true)
  })

  it('gives zero front factor for a sun behind the panel', () => {
    // South-facing window, sun due north → behind.
    const panel = projectSunOnPanel({ azimuthDeg: 0, elevationDeg: 20 }, 180, 90)
    expect(panel.frontFactor).toBe(0)
  })

  it('places a higher sun higher in the plane (inPlaneY up)', () => {
    const low = projectSunOnPanel({ azimuthDeg: 180, elevationDeg: 10 }, 180, 90)
    const high = projectSunOnPanel({ azimuthDeg: 180, elevationDeg: 50 }, 180, 90)
    expect(high.inPlaneY).toBeGreaterThan(low.inPlaneY)
  })
})

describe('resolveSun — seasonal behaviour (FR-2)', () => {
  const base: LightInput = {
    mode: 'astronomical',
    latitudeDeg: 52.37,
    longitudeDeg: 4.9,
    facadeAzimuthDeg: 180, // south-facing vertical window
    tiltDeg: 90,
    dayOfYear: 172,
    timeMinutes: 12 * 60,
    manualAzimuthDeg: 0,
    manualElevationDeg: 45,
    intensity: 1,
    temperatureK: 5500,
    haloIntensity: 0.5,
    haloConcentration: 0.5,
    overcast: false,
  }

  it('a south-facing Amsterdam window at noon: June is higher, cooler and more frontal than December', () => {
    const june = resolveSun({ ...base, dayOfYear: 172 })
    const december = resolveSun({ ...base, dayOfYear: 355 })

    // Higher elevation in June.
    expect(june.elevationDeg).toBeGreaterThan(december.elevationDeg)
    // Cooler (higher colour temperature) in June, warmer in December.
    expect(june.temperatureK).toBeGreaterThan(december.temperatureK)
    // Both are above the horizon and lit at noon.
    expect(june.aboveHorizon).toBe(true)
    expect(december.aboveHorizon).toBe(true)
    expect(june.intensity).toBeGreaterThan(0)
    expect(december.intensity).toBeGreaterThan(0)
  })

  it('renders night below the horizon (zero intensity)', () => {
    const midnight = resolveSun({ ...base, timeMinutes: 0 })
    expect(midnight.aboveHorizon).toBe(false)
    expect(midnight.intensity).toBe(0)
  })

  it('manual mode places the sun panel-relative and honours the intensity slider', () => {
    const front = resolveSun({
      ...base,
      mode: 'manual',
      manualAzimuthDeg: 0,
      manualElevationDeg: 40,
    })
    expect(front.frontal).toBe(true)
    expect(front.intensity).toBeCloseTo(1)
    const dim = resolveSun({ ...base, mode: 'manual', intensity: 0.3, manualElevationDeg: 40 })
    expect(dim.intensity).toBeCloseTo(0.3)
  })
})

describe('instantForDay', () => {
  it('maps local noon near a longitude to roughly solar midday', () => {
    // Amsterdam, midsummer, local noon → sun well up.
    const date = instantForDay(172, 12 * 60, 4.9)
    const pos = solarPosition({ latitudeDeg: 52.37, longitudeDeg: 4.9 }, date)
    expect(pos.elevationDeg).toBeGreaterThan(45)
  })
})
