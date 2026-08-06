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
    /** Open the cutting list in the bottom drawer, where it gets real width. */
    onCuttingList?: () => void
  }

  let { result, glasses, unit, busy, onCuttingList }: Props = $props()

  /** Longest edge of a sheet preview, in px. Every sheet scales to this so they read comparably. */
  const PREVIEW_PX = 260

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

  /** Sheet preview box in px, longest edge at {@link PREVIEW_PX} and the aspect kept. */
  function previewBox(sheet: NestSheet): { w: number; h: number } {
    const scale = PREVIEW_PX / Math.max(sheet.widthMm, sheet.heightMm)
    return { w: Math.round(sheet.widthMm * scale), h: Math.round(sheet.heightMm * scale) }
  }

  const totalSheets = $derived(result?.totalSheets ?? 0)
  const totalPieces = $derived(
    (result?.glasses ?? []).reduce(
      (n, g) => n + g.sheets.reduce((m, s) => m + s.parts.length, 0),
      0,
    ),
  )
  /** Placed area over sheet area across every sheet — the number that decides what to buy. */
  const utilization = $derived.by(() => {
    let placed = 0
    let sheet = 0
    for (const g of result?.glasses ?? []) {
      for (const s of g.sheets) {
        placed += s.parts.reduce((a, p) => a + p.area, 0)
        sheet += s.widthMm * s.heightMm
      }
    }
    return sheet > 0 ? placed / sheet : 0
  })
</script>

<!--
  The sheet layout (F-057), reworked to the "Nesting page redesign" design: a toolbar naming what is
  on screen, then one group per glass of sheet cards. Each card carries its own utilisation, so the
  sheet that is barely used — the one worth changing stock for — is visible without reading the panel.
-->
<div class="nest-view">
  <div class="toolbar">
    <span class="title">Sheets to cut</span>
    {#if result && totalSheets > 0}
      <span class="meta">
        {totalSheets} sheet{totalSheets === 1 ? '' : 's'} · {totalPieces} piece{totalPieces === 1
          ? ''
          : 's'} · {pct(utilization)} used
      </span>
    {/if}
    <span class="spacer"></span>
    {#if onCuttingList}
      <button type="button" class="cut-list" onclick={onCuttingList}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="3"
            y="4"
            width="18"
            height="16"
            rx="2"
            stroke="currentColor"
            stroke-width="1.5"
          />
          <path d="M3 9h18M9 9v11" stroke="currentColor" stroke-width="1.5" />
        </svg>
        Cutting list
      </button>
    {/if}
  </div>

  <div class="scroll">
    {#if !result || totalSheets === 0}
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
                {glass.sheetCount} sheet{glass.sheetCount === 1 ? '' : 's'} ·
                {formatLength(glass.sheets[0]!.widthMm, unit)} × {formatLength(
                  glass.sheets[0]!.heightMm,
                  unit,
                )} · {pct(glass.utilization)} used
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
                {@const box = previewBox(sheet)}
                <figure class="sheet">
                  <div class="sheet-head">
                    <span class="sheet-title">Sheet {sheet.index + 1}</span>
                    <span class="sheet-pct">{pct(sheet.utilization)} used</span>
                  </div>
                  <svg
                    viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`}
                    width={box.w}
                    height={box.h}
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
                    <span class="bar">
                      <span
                        class="fill"
                        style:width={`${Math.max(2, Math.min(100, sheet.utilization * 100))}%`}
                      ></span>
                    </span>
                    <span class="cap-dims">
                      {formatLength(sheet.widthMm, unit)} × {formatLength(sheet.heightMm, unit)}
                    </span>
                  </figcaption>
                </figure>
              {/each}
            </div>
          </section>
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .nest-view {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--paper-100);
  }

  /* Names what is on screen and totals it, so the canvas is readable without the panel. */
  .toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 10px 20px;
    background: var(--paper-50);
    border-bottom: 1px solid var(--border-subtle);
  }

  .toolbar .title {
    font: var(--text-small);
    font-weight: 600;
    color: var(--text-strong);
  }

  .toolbar .meta {
    font: var(--text-eyebrow);
    color: var(--text-muted);
  }

  .spacer {
    flex: 1;
  }

  .cut-list {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 13px;
    background: var(--paper-0);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    font: var(--text-small);
    font-weight: 600;
    color: var(--text-strong);
    cursor: pointer;
  }

  .cut-list:hover {
    background: var(--paper-100);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 22px 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 30px;
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
    gap: 9px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid var(--border-subtle);
    flex: none;
  }

  .group-head .name {
    font: var(--text-h4);
    letter-spacing: var(--tracking-tight);
    color: var(--text-strong);
  }

  .group-head .stat {
    font: var(--text-eyebrow);
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
    gap: 14px;
    align-items: flex-start;
  }

  /* One card per physical sheet — its own header and utilisation, so it reads as a thing to buy. */
  .sheet {
    margin: 0;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--paper-0);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
  }

  .sheet-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .sheet-title {
    font: var(--text-small);
    font-weight: 600;
    color: var(--text-strong);
  }

  .sheet-pct {
    font: var(--text-eyebrow);
    color: var(--text-muted);
  }

  .sheet svg {
    display: block;
    border-radius: var(--radius-xs);
  }

  .sheet-bg {
    fill: var(--paper-0);
    stroke: var(--paper-300);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
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
    align-items: center;
    gap: var(--space-2);
  }

  .bar {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--paper-200);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--ink-800);
  }

  .cap-dims {
    font: var(--text-eyebrow);
    color: var(--text-muted);
  }
</style>
