<script lang="ts">
  interface Props {
    /** Manual sun azimuth, −90 (left) … +90 (right). */
    azimuthDeg: number
    /** Manual sun elevation, 0 (horizon) … 90 (zenith). */
    elevationDeg: number
    /** Caption under the dome (e.g. "Frontal" when centred). */
    caption?: string
    /** Live drag callback (transient). */
    onScrub: (azimuthDeg: number, elevationDeg: number) => void
    /** Release callback (commit one undo entry). */
    onCommit: () => void
  }

  let { azimuthDeg, elevationDeg, caption, onScrub, onCommit }: Props = $props()

  const W = 200
  const H = 120
  const LEFT = 10
  const SPAN = 180
  const BASE_Y = 100
  const R = 90

  /** Available dome height at a horizontal fraction `t` (0 at the edges, full at centre). */
  function heightAt(t: number): number {
    return Math.max(1, R * Math.sin(Math.PI * t))
  }

  const dot = $derived.by(() => {
    const t = (azimuthDeg + 90) / 180
    const px = LEFT + t * SPAN
    const py = BASE_Y - (elevationDeg / 90) * heightAt(t)
    return { px, py }
  })

  let svgEl: SVGSVGElement
  let dragging = $state(false)

  function toSun(clientX: number, clientY: number): { az: number; el: number } {
    const rect = svgEl.getBoundingClientRect()
    const lx = ((clientX - rect.left) / rect.width) * W
    const ly = ((clientY - rect.top) / rect.height) * H
    const t = clamp((lx - LEFT) / SPAN, 0, 1)
    const az = t * 180 - 90
    const el = clamp((BASE_Y - ly) / heightAt(t), 0, 1) * 90
    return { az, el }
  }

  function pointerDown(event: PointerEvent) {
    dragging = true
    svgEl.setPointerCapture(event.pointerId)
    const { az, el } = toSun(event.clientX, event.clientY)
    onScrub(az, el)
    event.preventDefault()
  }
  function pointerMove(event: PointerEvent) {
    if (!dragging) return
    const { az, el } = toSun(event.clientX, event.clientY)
    onScrub(az, el)
  }
  function pointerUp(event: PointerEvent) {
    if (!dragging) return
    dragging = false
    if (svgEl.hasPointerCapture(event.pointerId)) svgEl.releasePointerCapture(event.pointerId)
    onCommit()
  }

  function keyDown(event: KeyboardEvent) {
    const stepAz = event.shiftKey ? 15 : 5
    const stepEl = event.shiftKey ? 15 : 5
    let az = azimuthDeg
    let el = elevationDeg
    switch (event.key) {
      case 'ArrowLeft':
        az -= stepAz
        break
      case 'ArrowRight':
        az += stepAz
        break
      case 'ArrowUp':
        el += stepEl
        break
      case 'ArrowDown':
        el -= stepEl
        break
      default:
        return
    }
    event.preventDefault()
    onScrub(clamp(az, -90, 90), clamp(el, 0, 90))
    onCommit()
  }

  function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v))
  }
</script>

<div class="dome">
  <svg
    bind:this={svgEl}
    viewBox="0 0 {W} {H}"
    role="slider"
    tabindex="0"
    aria-label="Sun position"
    aria-valuemin={0}
    aria-valuemax={90}
    aria-valuenow={Math.round(elevationDeg)}
    aria-valuetext={`azimuth ${Math.round(azimuthDeg)} degrees, elevation ${Math.round(elevationDeg)} degrees`}
    onpointerdown={pointerDown}
    onpointermove={pointerMove}
    onpointerup={pointerUp}
    onpointercancel={pointerUp}
    onkeydown={keyDown}
  >
    <!-- Dome fill + arc -->
    <path
      d={`M ${LEFT} ${BASE_Y} A ${R} ${R} 0 0 1 ${LEFT + SPAN} ${BASE_Y} Z`}
      class="dome-fill"
    />
    <path d={`M ${LEFT} ${BASE_Y} A ${R} ${R} 0 0 1 ${LEFT + SPAN} ${BASE_Y}`} class="dome-arc" />
    <line x1={LEFT} y1={BASE_Y} x2={LEFT + SPAN} y2={BASE_Y} class="horizon" />
    <line x1={W / 2} y1={BASE_Y} x2={W / 2} y2={BASE_Y - R} class="meridian" />
    <!-- Ray from the sun to the panel centre -->
    <line x1={dot.px} y1={dot.py} x2={W / 2} y2={BASE_Y} class="ray" />
    <circle cx={dot.px} cy={dot.py} r="7" class="sun" />
    <text x={W / 2} y="12" class="axis-label">zenith</text>
    <text x={W / 2} y={H - 2} class="axis-label">horizon</text>
  </svg>
  {#if caption}<span class="caption">{caption}</span>{/if}
</div>

<style>
  .dome {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  svg {
    width: 100%;
    height: auto;
    touch-action: none;
    cursor: crosshair;
    border-radius: var(--radius-sm);
  }
  svg:focus-visible {
    outline: 2px solid var(--cobalt-500);
    outline-offset: 2px;
  }

  .dome-fill {
    fill: var(--paper-100);
  }
  .dome-arc {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 1.5;
  }
  .horizon {
    stroke: var(--border-strong);
    stroke-width: 1.5;
  }
  .meridian {
    stroke: var(--border-subtle);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .ray {
    stroke: var(--cobalt-400);
    stroke-width: 1.5;
    opacity: 0.5;
  }
  .sun {
    fill: var(--cobalt-500);
    stroke: var(--paper-0);
    stroke-width: 2;
  }

  .axis-label {
    fill: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 9px;
    text-anchor: middle;
    text-transform: uppercase;
    letter-spacing: var(--tracking-eyebrow);
  }

  .caption {
    font: 600 12px/1 var(--font-sans);
    color: var(--ink-700);
  }
</style>
