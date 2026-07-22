import { resolveSun, type LightInput, type ResolvedSun } from '@vitrum/core'
import { updateLightSettings, type Command, type LightSettings, type Project } from '@vitrum/model'

interface Deps {
  /** The live document (F-002); its `light` block is the persisted setup. */
  getDoc: () => Project
  /** Command sink — light edits are ordinary undoable commands. */
  execute: (command: Command) => void
}

/**
 * The sunlight-simulation controller (F-054). It owns the *view-side* transient state the persisted
 * document must not carry: the scrub position of the day-of-year / time-of-day sliders and the
 * animation playback loop. Everything else (mode, location, orientation, tilt, manual sun,
 * intensity, temperature, halo, toggles) is persisted `LightSettings` edited through
 * `updateLightSettings` — one undo entry per change (commit on release, the F-053 backlight pattern).
 *
 * Scrubbing a time slider updates the transient value and re-renders live; it commits **once** to
 * the document on release. Animation is preview-only: it advances the transient time each frame and
 * never writes per frame (so a day-lapse never floods the undo stack), committing the final moment
 * once on pause. The effective, mode-resolved sun (`sun`) is derived by the pure core resolver.
 */
export class LightController {
  #getDoc: () => Project
  #execute: (command: Command) => void

  /** Transient day-of-year while scrubbing / animating (null ⇒ use the persisted value). */
  scrubDay = $state<number | null>(null)
  /** Transient time-of-day (minutes) while scrubbing / animating (null ⇒ persisted value). */
  scrubMinutes = $state<number | null>(null)
  /** Transient manual sun azimuth while dragging the dome (null ⇒ persisted value). */
  scrubAz = $state<number | null>(null)
  /** Transient manual sun elevation while dragging the dome (null ⇒ persisted value). */
  scrubEl = $state<number | null>(null)
  /** Whether the day-lapse animation is running. */
  playing = $state(false)

  #raf = 0

  constructor(deps: Deps) {
    this.#getDoc = deps.getDoc
    this.#execute = deps.execute
  }

  get settings(): LightSettings {
    return this.#getDoc().light
  }

  /** The day-of-year the render should use (transient scrub wins over the persisted value). */
  get effectiveDay(): number {
    return this.scrubDay ?? this.settings.dayOfYear
  }
  /** The time-of-day (minutes) the render should use. */
  get effectiveMinutes(): number {
    return this.scrubMinutes ?? this.settings.timeMinutes
  }

  /** The manual sun azimuth the render should use (transient drag wins). */
  get effectiveManualAz(): number {
    return this.scrubAz ?? this.settings.manualAzimuthDeg
  }
  /** The manual sun elevation the render should use. */
  get effectiveManualEl(): number {
    return this.scrubEl ?? this.settings.manualElevationDeg
  }

  /** The core light input for the current effective moment. */
  get input(): LightInput {
    const s = this.settings
    return {
      mode: s.mode,
      latitudeDeg: s.latitudeDeg,
      longitudeDeg: s.longitudeDeg,
      facadeAzimuthDeg: s.facadeAzimuthDeg,
      tiltDeg: s.tiltDeg,
      dayOfYear: this.effectiveDay,
      timeMinutes: this.effectiveMinutes,
      manualAzimuthDeg: this.effectiveManualAz,
      manualElevationDeg: this.effectiveManualEl,
      intensity: s.intensity,
      temperatureK: s.temperatureK,
      haloIntensity: s.haloIntensity,
      haloConcentration: s.haloConcentration,
      overcast: s.overcast,
    }
  }

  /** The fully resolved sun for the current moment (pure core derivation). */
  get sun(): ResolvedSun {
    return resolveSun(this.input)
  }

  /** Patch the persisted light settings (one undo entry). */
  patch(patch: Partial<LightSettings>): void {
    this.#execute(updateLightSettings(patch))
  }

  // --- Manual sun placement (dome widget) ---------------------------------

  /** Drag the manual sun (panel-relative az/el): transient, re-renders live. */
  scrubManualSun(azimuthDeg: number, elevationDeg: number): void {
    this.scrubAz = clamp(azimuthDeg, -90, 90)
    this.scrubEl = clamp(elevationDeg, 0, 90)
  }
  /** Commit the dragged manual sun to the document (one undo entry) and drop the transient. */
  commitManualSun(): void {
    if (this.scrubAz === null || this.scrubEl === null) return
    const azimuthDeg = this.scrubAz
    const elevationDeg = this.scrubEl
    this.scrubAz = null
    this.scrubEl = null
    if (
      azimuthDeg !== this.settings.manualAzimuthDeg ||
      elevationDeg !== this.settings.manualElevationDeg
    ) {
      this.patch({ manualAzimuthDeg: azimuthDeg, manualElevationDeg: elevationDeg })
    }
  }

  // --- Time / day scrubbing -----------------------------------------------

  /** Update the transient day while dragging its slider. */
  scrubToDay(day: number): void {
    this.scrubDay = clamp(Math.round(day), 1, 365)
  }
  /** Commit the scrubbed day to the document (one undo entry) and drop the transient. */
  commitDay(): void {
    if (this.scrubDay === null) return
    const day = this.scrubDay
    this.scrubDay = null
    if (day !== this.settings.dayOfYear) this.patch({ dayOfYear: day })
  }

  /** Update the transient time-of-day while dragging its slider. */
  scrubToMinutes(minutes: number): void {
    this.scrubMinutes = clamp(Math.round(minutes), 0, 1439)
  }
  /** Commit the scrubbed time to the document (one undo entry) and drop the transient. */
  commitMinutes(): void {
    if (this.scrubMinutes === null) return
    const minutes = this.scrubMinutes
    this.scrubMinutes = null
    if (minutes !== this.settings.timeMinutes) this.patch({ timeMinutes: minutes })
  }

  // --- Animation playback (preview-only) ----------------------------------

  /** Start / stop the day-lapse. Playback is transient — it commits the final moment on stop. */
  togglePlay(): void {
    if (this.playing) this.stop()
    else this.play()
  }

  play(): void {
    if (this.playing) return
    this.playing = true
    this.scrubMinutes = this.effectiveMinutes
    if (typeof requestAnimationFrame === 'undefined') return
    const step = (): void => {
      if (!this.playing) return
      // Advance ~6 minutes/frame → a full day loops in a few seconds.
      const next = ((this.scrubMinutes ?? 0) + 6) % 1440
      this.scrubMinutes = next
      this.#raf = requestAnimationFrame(step)
    }
    this.#raf = requestAnimationFrame(step)
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    if (this.#raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.#raf)
    this.#raf = 0
    // Persist the moment we paused on as one undo entry.
    this.commitMinutes()
  }

  dispose(): void {
    if (this.#raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.#raf)
    this.#raf = 0
    this.playing = false
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
