import type { SolarPosition } from './position'

/**
 * Project the sun onto the panel's plane (F-054). The window is an oriented plane in the world:
 * `facadeAzimuthDeg` is the compass direction the front normal faces (0 = north, 90 = east,
 * 180 = south, …) and `tiltDeg` is the glass tilt from horizontal (90 = a vertical wall window,
 * 0 = a flat skylight). Given the sun's sky position this returns how square-on the light hits the
 * front (`frontFactor`, the cosine of incidence, 0 when the sun is behind or below) and the sun's
 * direction within the glass plane (`inPlaneX` right, `inPlaneY` up, each −1..1) — where the render
 * puts the solar halo and streams the god-rays from. Pure; unit-tested for the FR-2 directions.
 */

const DEG = Math.PI / 180

export interface PanelSun {
  /** Cosine of the angle between the sun and the panel's front normal, clamped ≥ 0. */
  readonly frontFactor: number
  /** Sun's horizontal position in the glass plane, −1 (left) … +1 (right). */
  readonly inPlaneX: number
  /** Sun's vertical position in the glass plane, −1 (bottom) … +1 (top). */
  readonly inPlaneY: number
  /** True when the sun is near-centred and facing the panel front ("Frontal" caption, Diafane). */
  readonly frontal: boolean
}

interface Vec3 {
  x: number
  y: number
  z: number
}

/** East-North-Up unit vector for a sky azimuth (from north, CW) and elevation. */
function skyVector(azimuthDeg: number, elevationDeg: number): Vec3 {
  const el = elevationDeg * DEG
  const az = azimuthDeg * DEG
  const ce = Math.cos(el)
  return { x: ce * Math.sin(az), y: ce * Math.cos(az), z: Math.sin(el) }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/** Project a sky sun position onto an oriented panel plane. */
export function projectSunOnPanel(
  sun: SolarPosition,
  facadeAzimuthDeg: number,
  tiltDeg: number,
): PanelSun {
  const sunV = skyVector(sun.azimuthDeg, sun.elevationDeg)

  // Panel front normal: elevation of the normal above horizontal is (90 − tilt), so a vertical
  // window (tilt 90) has a horizontal normal at the facade azimuth, and a skylight (tilt 0) points
  // straight up.
  const normal = skyVector(facadeAzimuthDeg, 90 - tiltDeg)

  const frontFactor = Math.max(0, dot(sunV, normal))

  // In-plane basis: right runs along the wall (horizontal), up completes the right-handed frame.
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  let right = cross(worldUp, normal)
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = { x: 1, y: 0, z: 0 } // skylight
  right = normalize(right)
  const up = normalize(cross(normal, right))

  const inPlaneX = clampUnit(dot(sunV, right))
  const inPlaneY = clampUnit(dot(sunV, up))

  // "Frontal" (Diafane caption): the sun is in front of the glass and centred left-right, i.e. the
  // dome dot sits on the vertical mid-line. Height (elevation) does not disqualify it.
  const frontal = frontFactor > 0.05 && Math.abs(inPlaneX) < 0.2
  return { frontFactor, inPlaneX, inPlaneY, frontal }
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v))
}
