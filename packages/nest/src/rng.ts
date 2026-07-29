/**
 * A tiny deterministic PRNG (mulberry32). The nester is stochastic — it shuffles placement order over
 * several restarts and keeps the best — but must be reproducible from a stored seed (F-057 FR-3), so
 * it draws every random choice from this seeded stream, never `Math.random()` (which is banned in
 * this codebase's pure packages anyway).
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seeded Fisher–Yates shuffle returning a new array (input untouched). */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
