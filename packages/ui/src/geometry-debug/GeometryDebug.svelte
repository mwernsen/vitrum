<script lang="ts">
  import {
    arc,
    cubic,
    flattenCurve,
    intersect,
    line,
    offsetPolygon,
    polygon,
    type Curve,
    type Intersection,
    type Polygon,
    type Vec2,
  } from '@vitrum/geometry'

  import Button from '../components/Button.svelte'

  // Local deterministic PRNG so a given seed always draws the same scene — the kernel's
  // test-only generator isn't part of its public API.
  function mulberry32(a: number): () => number {
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const VIEW = 200
  const PAD = 24

  function randomCurve(rand: () => number): Curve {
    const p = (): Vec2 => ({
      x: PAD + rand() * (VIEW - 2 * PAD),
      y: PAD + rand() * (VIEW - 2 * PAD),
    })
    const kind = Math.floor(rand() * 3)
    if (kind === 0) return line(p(), p())
    if (kind === 1) {
      return arc(
        { x: VIEW / 2, y: VIEW / 2 },
        30 + rand() * 55,
        rand() * 6.28,
        rand() * 6.28,
        rand() > 0.5,
      )
    }
    return cubic(p(), p(), p(), p())
  }

  function randomPolygon(rand: () => number): Polygon {
    const n = 5 + Math.floor(rand() * 4)
    const cx = VIEW / 2
    const cy = VIEW / 2
    const pts: Vec2[] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = 35 + rand() * 45 // star-shaped → always simple
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
    }
    return polygon(pts)
  }

  function pathOf(curve: Curve): string {
    const pts = flattenCurve(curve, 0.4)
    return pts
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
      .join(' ')
  }

  function ringPath(ring: readonly Vec2[]): string {
    return (
      ring
        .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
        .join(' ') + ' Z'
    )
  }

  interface IntersectionScene {
    a: Curve
    b: Curve
    hits: Intersection[]
  }
  interface OffsetScene {
    source: Polygon
    grown: ReturnType<typeof offsetPolygon>
    inset: ReturnType<typeof offsetPolygon>
  }

  function buildIntersections(seed: number): IntersectionScene[] {
    const rand = mulberry32(seed * 2654435761)
    return Array.from({ length: 12 }, () => {
      const a = randomCurve(rand)
      const b = randomCurve(rand)
      return { a, b, hits: intersect(a, b) }
    })
  }

  function buildOffsets(seed: number): OffsetScene[] {
    const rand = mulberry32(seed * 40503 + 7)
    return Array.from({ length: 8 }, () => {
      const source = randomPolygon(rand)
      return { source, grown: offsetPolygon(source, 8), inset: offsetPolygon(source, -8) }
    })
  }

  let seed = $state(1)
  const intersections = $derived(buildIntersections(seed))
  const offsets = $derived(buildOffsets(seed))
</script>

<div class="debug">
  <header class="masthead">
    <p class="eyebrow">Vitrum geometry kernel</p>
    <h1>Robustness debug</h1>
    <p class="lede">
      Random intersection and offset cases from <code>@vitrum/geometry</code>, drawn so tangencies,
      endpoint touches and self-intersecting offsets can be eyeballed during review.
    </p>
    <div class="controls">
      <Button onclick={() => (seed += 1)}>Regenerate</Button>
      <span class="seed">seed {seed}</span>
    </div>
  </header>

  <section>
    <h2>Curve intersections</h2>
    <p class="note">
      Cobalt and ink curves; each intersection marked — ruby for a crossing, amber ring for a
      tangency, hollow for an endpoint touch.
    </p>
    <div class="grid">
      {#each intersections as scene, i (i)}
        <svg viewBox="0 0 {VIEW} {VIEW}" class="cell" aria-label="intersection case {i + 1}">
          <path d={pathOf(scene.a)} class="curve-a" />
          <path d={pathOf(scene.b)} class="curve-b" />
          {#each scene.hits as hit, h (h)}
            <circle
              cx={hit.point.x}
              cy={hit.point.y}
              r={hit.tangential ? 5 : 3.2}
              class:tangential={hit.tangential}
              class:endpoint={hit.atEndpoint}
              class="hit"
            />
          {/each}
          <text x="6" y="14" class="count">{scene.hits.length}</text>
        </svg>
      {/each}
    </div>
  </section>

  <section>
    <h2>Contour offset</h2>
    <p class="note">
      Ink source contour with an outward (emerald) and inward (cobalt) offset. A ruby frame marks an
      offset flagged as self-intersecting.
    </p>
    <div class="grid">
      {#each offsets as scene, i (i)}
        <svg
          viewBox="0 0 {VIEW} {VIEW}"
          class="cell"
          class:flagged={scene.grown.selfIntersects || scene.inset.selfIntersects}
          aria-label="offset case {i + 1}"
        >
          <path d={ringPath(scene.source.outer)} class="source" />
          <path d={ringPath(scene.grown.contour.outer)} class="grown" />
          <path d={ringPath(scene.inset.contour.outer)} class="inset" />
        </svg>
      {/each}
    </div>
  </section>
</div>

<style>
  .debug {
    max-width: 1080px;
    margin: 0 auto;
    padding: var(--space-24) var(--space-20) var(--space-32);
    color: var(--text-body);
    font-family: var(--font-sans, 'Onest Variable', sans-serif);
  }
  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  h1 {
    margin: var(--space-2) 0 var(--space-3);
    color: var(--text-strong);
  }
  h2 {
    margin: var(--space-24) 0 var(--space-2);
    color: var(--text-strong);
  }
  .lede,
  .note {
    color: var(--text-muted);
    max-width: 64ch;
    margin: 0 0 var(--space-4);
  }
  code {
    font-family: var(--font-mono, 'Geist Mono Variable', monospace);
    background: var(--surface-sunken);
    padding: 0 var(--space-1);
    border-radius: var(--radius-2, 4px);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
  .seed {
    font-family: var(--font-mono, 'Geist Mono Variable', monospace);
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-4);
  }
  .cell {
    width: 100%;
    aspect-ratio: 1;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-3, 8px);
  }
  .cell.flagged {
    border-color: var(--danger-600);
  }
  .curve-a {
    fill: none;
    stroke: var(--cobalt-500);
    stroke-width: 1.5;
  }
  .curve-b {
    fill: none;
    stroke: var(--ink-700);
    stroke-width: 1.5;
  }
  .hit {
    fill: var(--ruby-600);
    stroke: none;
  }
  .hit.tangential {
    fill: none;
    stroke: var(--amber-600);
    stroke-width: 1.5;
  }
  .hit.endpoint {
    fill: var(--surface-card);
    stroke: var(--ruby-600);
    stroke-width: 1.5;
  }
  .count {
    fill: var(--text-muted);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
  .source {
    fill: color-mix(in srgb, var(--ink-500) 8%, transparent);
    stroke: var(--ink-700);
    stroke-width: 1.5;
  }
  .grown {
    fill: none;
    stroke: var(--emerald-600);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }
  .inset {
    fill: none;
    stroke: var(--cobalt-500);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }
</style>
