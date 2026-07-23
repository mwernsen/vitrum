<script lang="ts">
  import { SEASON_PRESETS } from '@vitrum/core'
  import type { LightMode } from '@vitrum/model'
  import Pause from 'lucide-svelte/icons/pause'
  import Play from 'lucide-svelte/icons/play'

  import Switch from '../components/Switch.svelte'
  import Tabs from '../components/Tabs.svelte'
  import type { LightController } from '../light/controller.svelte'
  import SunDome from '../light/SunDome.svelte'

  interface Props {
    /** The sunlight-simulation controller (F-054). Absent ⇒ the panel stays a placeholder. */
    light?: LightController
    /** Whether the light view is the active view. When false, a hint invites switching to it. */
    lightViewActive?: boolean
    /** Switch the app to the light view (so the panel and stage agree). */
    onEnterLightView?: () => void
  }

  let { light, lightViewActive = false, onEnterLightView }: Props = $props()

  const MODES: { label: string; value: LightMode }[] = [
    { label: 'Manual', value: 'manual' },
    { label: '365 days', value: 'astronomical' },
  ]

  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]

  function timeLabel(minutes: number): string {
    const m = Math.round(minutes)
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }
  function dayLabel(day: number): string {
    const d = new Date(Date.UTC(2025, 0, Math.max(1, Math.min(365, Math.round(day)))))
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  }
</script>

{#if light}
  {@const s = light.settings}
  {@const sun = light.sun}
  <div class="light">
    {#if !lightViewActive}
      <button class="enter" onclick={() => onEnterLightView?.()}>
        Switch to the light view to see the sun on the panel.
      </button>
    {/if}

    <Tabs items={MODES} value={s.mode} onchange={(v) => light.patch({ mode: v as LightMode })} />

    {#if s.mode === 'manual'}
      <SunDome
        azimuthDeg={light.effectiveManualAz}
        elevationDeg={light.effectiveManualEl}
        caption={sun.frontal ? 'Frontal' : undefined}
        onScrub={(az, el) => light.scrubManualSun(az, el)}
        onCommit={() => light.commitManualSun()}
      />

      <label class="slider">
        <span class="slider-label">
          Intensity
          <span class="slider-value">{Math.round(s.intensity * 100)}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={s.intensity}
          onchange={(e) => light.patch({ intensity: Number(e.currentTarget.value) })}
          aria-label="Light intensity"
        />
      </label>

      <label class="slider">
        <span class="slider-label">
          Temperature
          <span class="slider-value">{Math.round(s.temperatureK)} K</span>
        </span>
        <input
          type="range"
          min="2000"
          max="8000"
          step="100"
          value={s.temperatureK}
          onchange={(e) => light.patch({ temperatureK: Number(e.currentTarget.value) })}
          aria-label="Colour temperature"
        />
      </label>
    {:else}
      <div class="grid">
        <label class="num">
          <span class="num-label">Latitude</span>
          <span class="num-field">
            <input
              type="number"
              step="0.1"
              min="-90"
              max="90"
              value={s.latitudeDeg}
              onchange={(e) => light.patch({ latitudeDeg: Number(e.currentTarget.value) })}
              aria-label="Latitude"
            />
            <span class="unit">°</span>
          </span>
        </label>
        <label class="num">
          <span class="num-label">Longitude</span>
          <span class="num-field">
            <input
              type="number"
              step="0.1"
              min="-180"
              max="180"
              value={s.longitudeDeg}
              onchange={(e) => light.patch({ longitudeDeg: Number(e.currentTarget.value) })}
              aria-label="Longitude"
            />
            <span class="unit">°</span>
          </span>
        </label>
      </div>

      <label class="slider">
        <span class="slider-label">
          Facade orientation
          <span class="slider-value">{Math.round(s.facadeAzimuthDeg)}°</span>
        </span>
        <input
          type="range"
          min="0"
          max="359"
          step="1"
          value={s.facadeAzimuthDeg}
          onchange={(e) => light.patch({ facadeAzimuthDeg: Number(e.currentTarget.value) })}
          aria-label="Facade orientation"
        />
      </label>

      <label class="slider">
        <span class="slider-label">
          Tilt
          <span class="slider-value">{Math.round(s.tiltDeg)}°</span>
        </span>
        <input
          type="range"
          min="0"
          max="90"
          step="1"
          value={s.tiltDeg}
          onchange={(e) => light.patch({ tiltDeg: Number(e.currentTarget.value) })}
          aria-label="Tilt"
        />
      </label>

      <label class="slider">
        <span class="slider-label">
          Day
          <span class="slider-value">{dayLabel(light.effectiveDay)}</span>
        </span>
        <input
          type="range"
          min="1"
          max="365"
          step="1"
          value={light.effectiveDay}
          oninput={(e) => light.scrubToDay(Number(e.currentTarget.value))}
          onchange={() => light.commitDay()}
          aria-label="Day of year"
        />
      </label>

      <div class="time-row">
        <label class="slider grow">
          <span class="slider-label">
            Time of day
            <span class="slider-value">{timeLabel(light.effectiveMinutes)}</span>
          </span>
          <input
            type="range"
            min="0"
            max="1439"
            step="1"
            value={light.effectiveMinutes}
            oninput={(e) => light.scrubToMinutes(Number(e.currentTarget.value))}
            onchange={() => light.commitMinutes()}
            aria-label="Time of day"
          />
        </label>
        <button
          class="play"
          onclick={() => light.togglePlay()}
          aria-label={light.playing ? 'Pause day-lapse' : 'Play day-lapse'}
          aria-pressed={light.playing}
        >
          {#if light.playing}<Pause size={16} strokeWidth={1.8} />{:else}<Play
              size={16}
              strokeWidth={1.8}
            />{/if}
        </button>
      </div>

      <div class="presets">
        {#each SEASON_PRESETS as preset (preset.label)}
          <button class="preset" onclick={() => light.patch({ dayOfYear: preset.dayOfYear })}>
            {preset.label}
          </button>
        {/each}
      </div>

      <Switch
        label="Overcast"
        checked={s.overcast}
        onchange={(on) => light.patch({ overcast: on })}
      />

      <p class="readout" aria-label="Sun readout">
        Sun {sun.aboveHorizon ? 'up' : 'below horizon'} · azimuth
        <span class="mono">{Math.round(sun.azimuthDeg)}°</span> · elevation
        <span class="mono">{Math.round(sun.elevationDeg)}°</span>
      </p>
    {/if}

    <div class="section">
      <span class="eyebrow">Solar halo</span>
      <label class="slider">
        <span class="slider-label">
          Intensity
          <span class="slider-value">{Math.round(s.haloIntensity * 100)}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={s.haloIntensity}
          onchange={(e) => light.patch({ haloIntensity: Number(e.currentTarget.value) })}
          aria-label="Solar halo intensity"
        />
      </label>
      <label class="slider">
        <span class="slider-label">
          Concentration
          <span class="slider-value">{Math.round(s.haloConcentration * 100)}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={s.haloConcentration}
          onchange={(e) => light.patch({ haloConcentration: Number(e.currentTarget.value) })}
          aria-label="Solar halo concentration"
        />
      </label>
    </div>

    <div class="section toggles">
      <Switch
        label="Photo grain"
        checked={s.photoGrain}
        onchange={(on) => light.patch({ photoGrain: on })}
      />
      <Switch
        label="Textures"
        checked={s.showTextures}
        onchange={(on) => light.patch({ showTextures: on })}
      />
    </div>
  </div>
{:else}
  <div class="placeholder">
    <p class="ph-note">Place the sun and play the window through a day and the seasons.</p>
    <span class="ph-feature">Coming with F-054</span>
  </div>
{/if}

<style>
  .light {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .enter {
    padding: 8px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--paper-50);
    color: var(--ink-700);
    font: 500 12px/1.4 var(--font-sans);
    text-align: left;
    cursor: pointer;
  }
  .enter:hover {
    background: var(--paper-100);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .slider {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .slider-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font: 500 12.5px/1 var(--font-sans);
    color: var(--ink-800);
  }

  .slider-value {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .slider input[type='range'] {
    width: 100%;
    accent-color: var(--cobalt-500);
  }

  .time-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .grow {
    flex: 1;
  }

  .play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex: none;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--paper-0);
    color: var(--ink-800);
    cursor: pointer;
  }
  .play:hover {
    background: var(--paper-50);
  }
  .play[aria-pressed='true'] {
    background: var(--ink-950);
    color: var(--paper-0);
    border-color: var(--ink-950);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .preset {
    padding: 5px 9px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--paper-0);
    color: var(--ink-700);
    font: 500 11.5px/1 var(--font-sans);
    cursor: pointer;
  }
  .preset:hover {
    background: var(--paper-50);
    color: var(--ink-900);
  }

  .num {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .num-label {
    font: 500 12px/1 var(--font-sans);
    color: var(--ink-800);
  }
  .num-field {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .num-field input {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    background: var(--paper-0);
    color: var(--ink-900);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: right;
  }
  .num-field .unit {
    font: var(--text-caption);
    color: var(--ink-500);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }
  .toggles {
    gap: var(--space-3);
  }

  .eyebrow {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--text-muted);
  }

  .readout {
    margin: 0;
    font: var(--text-caption);
    color: var(--ink-600);
  }
  .mono {
    font-family: var(--font-mono);
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .ph-note {
    margin: 0;
    font: var(--text-small);
    color: var(--text-muted);
  }
  .ph-feature {
    font: var(--text-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
    color: var(--ink-500);
    padding: 4px 9px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
  }
</style>
