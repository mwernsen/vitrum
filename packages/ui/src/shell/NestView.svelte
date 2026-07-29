<script lang="ts">
  import { formatLength, type LengthUnit } from '@vitrum/core'
  import type { Glass, GlassId } from '@vitrum/model'
  import type { NestResult, NestSheet, PlacedPart } from '@vitrum/nest'

  interface Props {
    /** The nested layout (F-057), or null before the first run. */
    result: NestResult | null
    /** Project glasses, for fill colour + display name. */
    glasses: Readonly<Record<GlassId, Glass>>
    /** Active length unit for sheet dimension captions. */
    unit: LengthUnit
    /** True while a nest is running (drives the busy hint on first run). */
    busy: boolean
  }

  let { result, glasses, unit, busy }: Props = $props()

  const glassName = (id: GlassId): string => glasses[id]?.name ?? 'Unassigned'
  const glassColor = (id: GlassId): string => glasses[id]?.color ?? '#cccccc'

  /** An SVG path for a placed part: outer ring + holes, filled even-odd so holes cut through. */
  function partPath(part: PlacedPart): string {
    const ring = (pts: readonly { x: number; y: number }[]): string =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') +
      ' Z'
    return [ring(part.ring), ...part.holes.map(ring)].join(' ')
  }

  /** Label anchor: the average of the placed ring's vertices (adequate for a piece number). */
  function labelAt(part: PlacedPart): { x: number; y: number } {
    let x = 0
    let y = 0
    for (const p of part.ring) {
      x += p.x
      y += p.y
    }
    const n = Math.max(1, part.ring.length)
    return { x: x / n, y: y / n }
  }

  const pct = (u: number): string => `${Math.round(u * 100)}%`
  const labelSize = (sheet: NestSheet): number =>
    Math.max(6, Math.min(sheet.widthMm, sheet.heightMm) / 45)
</script>

<div class="nest-view">
  {#if !result || result.totalSheets === 0}
    <div class="empty">
      {#if busy}
        <p>Nesting…</p>
      {:else}
        <p>Nothing nested yet</p>
        <p class="hint">
          Assign glass to pieces, then nest from the panel to lay them onto sheets.
        </p>
      {/if}
    </div>
  {:else}
    {#each result.glasses as glass (glass.glassId)}
      {#if glass.sheets.length > 0}
        <section class="glass-group">
          <header class="group-head">
            <span class="dot" style:background={glassColor(glass.glassId)}></span>
            <span class="name">{glassName(glass.glassId)}</span>
            <span class="stat">
              {glass.sheetCount} sheet{glass.sheetCount === 1 ? '' : 's'} · {pct(glass.utilization)} used
            </span>
          </header>
          {#if glass.unplaced.length > 0}
            <p class="warn">
              {glass.unplaced.length} piece{glass.unplaced.length === 1 ? '' : 's'} too large for the
              chosen sheet
            </p>
          {/if}
          <div class="sheets">
            {#each glass.sheets as sheet (sheet.index)}
              <figure class="sheet">
                <svg
                  viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`}
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label={`Sheet ${sheet.index + 1}, ${pct(sheet.utilization)} used`}
                >
                  <rect
                    class="sheet-bg"
                    x="0"
                    y="0"
                    width={sheet.widthMm}
                    height={sheet.heightMm}
                  />
                  {#each sheet.parts as part (part.id)}
                    <path
                      d={partPath(part)}
                      fill={glassColor(glass.glassId)}
                      fill-opacity="0.5"
                      fill-rule="evenodd"
                      class="part"
                    />
                    {#if part.label}
                      {@const at = labelAt(part)}
                      <text
                        x={at.x}
                        y={at.y}
                        font-size={labelSize(sheet)}
                        text-anchor="middle"
                        dominant-baseline="central"
                        class="label">{part.label}</text
                      >
                    {/if}
                  {/each}
                </svg>
                <figcaption>
                  <span class="cap-index">Sheet {sheet.index + 1}</span>
                  <span class="cap-dims">
                    {formatLength(sheet.widthMm, unit)} × {formatLength(sheet.heightMm, unit)}
                  </span>
                  <span class="cap-util">{pct(sheet.utilization)}</span>
                </figcaption>
              </figure>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .nest-view {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: var(--space-6);
    padding-right: 320px; /* clear the floating controls card */
    background: var(--paper-1);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--text-muted);
  }

  .empty p {
    margin: 0;
    font: var(--text-body);
  }

  .empty .hint {
    margin-top: var(--space-2);
    font: var(--text-small);
    max-width: 32ch;
  }

  .glass-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    flex: none;
  }

  .group-head .name {
    font: var(--text-h4);
    color: var(--text-strong);
  }

  .group-head .stat {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .warn {
    margin: 0;
    font: var(--text-small);
    color: var(--warning-600);
  }

  .sheets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
  }

  .sheet {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .sheet svg {
    width: 280px;
    height: auto;
    max-height: 380px;
    background: var(--paper-0);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
  }

  .sheet-bg {
    fill: var(--paper-0);
  }

  .part {
    stroke: var(--ink-700);
    stroke-width: 0.6;
    vector-effect: non-scaling-stroke;
  }

  .label {
    fill: var(--ink-900);
    font-family: var(--font-mono);
  }

  figcaption {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .cap-util {
    color: var(--text-body);
  }
</style>
