export {
  julianDay,
  solarDeclinationDeg,
  equationOfTimeMinutes,
  solarNoonUtcMinutes,
  solarPosition,
  type GeoLocation,
  type SolarPosition,
} from './position'
export { kelvinToRgb, skyLight, type SkyLight } from './sky'
export { projectSunOnPanel, type PanelSun } from './panel'
export {
  instantForDay,
  resolveSun,
  type LightInput,
  type LightMode,
  type ResolvedSun,
} from './resolve'

/**
 * Solstice / equinox day-of-year presets (approximate, non-leap reference year) for the 365-days
 * mode's season jumps (F-054 FR-5).
 */
export const SEASON_PRESETS: readonly { readonly label: string; readonly dayOfYear: number }[] = [
  { label: 'Spring equinox', dayOfYear: 79 }, // ~Mar 20
  { label: 'Summer solstice', dayOfYear: 172 }, // ~Jun 21
  { label: 'Autumn equinox', dayOfYear: 265 }, // ~Sep 22
  { label: 'Winter solstice', dayOfYear: 355 }, // ~Dec 21
]
