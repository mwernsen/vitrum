/**
 * Astronomical solar position (F-054 FR-1) — a direct port of the NOAA solar-position
 * equations (the widely-used "NOAA solar calculator" spreadsheet). Pure and framework-free
 * (`packages/core` stays a leaf): given a geographic location and a UTC instant it returns the
 * sun's azimuth (degrees clockwise from north) and elevation (degrees above the horizon,
 * corrected for atmospheric refraction, matching the NOAA calculator to well within 0.5°).
 *
 * These are the reference maths the light simulation is built on; the render never touches
 * astronomy — it consumes the resolved sun (see `resolve.ts`).
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** A geographic location. Longitude is **east-positive** (NOAA convention). */
export interface GeoLocation {
  readonly latitudeDeg: number
  /** East-positive longitude, −180..180. */
  readonly longitudeDeg: number
}

/** The sun's position in the sky: azimuth clockwise from north, elevation above the horizon. */
export interface SolarPosition {
  /** Azimuth in degrees, 0 = north, 90 = east, 180 = south, 270 = west. */
  readonly azimuthDeg: number
  /** Elevation in degrees above the horizon (negative = below, i.e. night). */
  readonly elevationDeg: number
}

/** The Julian Day for a UTC instant. */
export function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5
}

/** Julian centuries since J2000.0 for a Julian Day. */
function julianCentury(jd: number): number {
  return (jd - 2_451_545) / 36_525
}

/** Sun declination in degrees for a Julian century `t`. Exported for solar-noon / tests. */
export function solarDeclinationDeg(t: number): number {
  const l0 = mod360(280.46646 + t * (36_000.76983 + t * 0.0003032))
  const m = 357.52911 + t * (35_999.05029 - 0.0001537 * t)
  const c =
    Math.sin(m * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * DEG) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * DEG) * 0.000289
  const trueLong = l0 + c
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * DEG)
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliqCorr = meanObliq + 0.00256 * Math.cos((125.04 - 1934.136 * t) * DEG)
  return Math.asin(Math.sin(obliqCorr * DEG) * Math.sin(appLong * DEG)) * RAD
}

/** Equation of time in minutes for a Julian century `t`. Exported for solar-noon / tests. */
export function equationOfTimeMinutes(t: number): number {
  const l0 = mod360(280.46646 + t * (36_000.76983 + t * 0.0003032))
  const m = 357.52911 + t * (35_999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliqCorr = meanObliq + 0.00256 * Math.cos((125.04 - 1934.136 * t) * DEG)
  const y = Math.tan((obliqCorr / 2) * DEG) ** 2
  const l0r = l0 * DEG
  const mr = m * DEG
  const eot =
    y * Math.sin(2 * l0r) -
    2 * e * Math.sin(mr) +
    4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
    0.5 * y * y * Math.sin(4 * l0r) -
    1.25 * e * e * Math.sin(2 * mr)
  return 4 * (eot * RAD)
}

/**
 * UTC minutes-of-day at which the sun transits the meridian at `longitudeDeg` on `date`'s day —
 * i.e. local solar noon. Used by the resolver and testable independently of azimuth.
 */
export function solarNoonUtcMinutes(longitudeDeg: number, date: Date): number {
  const t = julianCentury(julianDay(date))
  return 720 - 4 * longitudeDeg - equationOfTimeMinutes(t)
}

/** Atmospheric refraction correction (degrees) to add to the geometric elevation (NOAA). */
function refractionDeg(elevationDeg: number): number {
  if (elevationDeg > 85) return 0
  const te = Math.tan(elevationDeg * DEG)
  let arcsec: number
  if (elevationDeg > 5) {
    arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
  } else if (elevationDeg > -0.575) {
    arcsec =
      1735 +
      elevationDeg *
        (-518.2 + elevationDeg * (103.4 + elevationDeg * (-12.79 + elevationDeg * 0.711)))
  } else {
    arcsec = -20.772 / te
  }
  return arcsec / 3600
}

/** Wrap a value into [0, 360). */
function mod360(v: number): number {
  return ((v % 360) + 360) % 360
}

/**
 * The sun's azimuth/elevation for a location and UTC instant (FR-1). Azimuth is clockwise from
 * north; elevation is corrected for atmospheric refraction to match the NOAA calculator.
 */
export function solarPosition(location: GeoLocation, date: Date): SolarPosition {
  const { latitudeDeg: lat, longitudeDeg: lon } = location
  const jd = julianDay(date)
  const t = julianCentury(jd)
  const decl = solarDeclinationDeg(t)
  const eqTime = equationOfTimeMinutes(t)

  // Minutes past UTC midnight.
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60

  // True solar time (minutes), then hour angle (degrees).
  const trueSolarTime = (((utcMinutes + eqTime + 4 * lon) % 1440) + 1440) % 1440
  let hourAngle = trueSolarTime / 4 - 180
  if (hourAngle < -180) hourAngle += 360

  const latR = lat * DEG
  const declR = decl * DEG
  const haR = hourAngle * DEG
  const cosZenith =
    Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(haR)
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)))
  const elevationGeometric = 90 - zenith * RAD

  // Azimuth from the standard NOAA branch.
  const denom = Math.cos(latR) * Math.sin(zenith)
  let azimuth: number
  if (Math.abs(denom) < 1e-9) {
    azimuth = lat > decl ? 180 : 0
  } else {
    const cosAz = (Math.sin(latR) * Math.cos(zenith) - Math.sin(declR)) / denom
    const acAz = Math.acos(Math.min(1, Math.max(-1, cosAz))) * RAD
    azimuth = hourAngle > 0 ? mod360(acAz + 180) : mod360(540 - acAz)
  }

  return {
    azimuthDeg: azimuth,
    elevationDeg: elevationGeometric + refractionDeg(elevationGeometric),
  }
}
