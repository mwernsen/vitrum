import { bench, describe } from 'vitest'

import { intersect } from './intersect'
import { makeRng } from './rand'
import type { Line } from './types'

/**
 * FR-5: 10,000 random segment-pair intersection tests must run in < 100 ms, because
 * piece detection (F-020) and DRC call `intersect` in hot loops. The bounding-box
 * pre-filter inside `intersect` is what keeps this cheap. Run with `pnpm --filter
 * @vitrum/geometry bench`.
 */
const rng = makeRng(20260718)
const pairs: [Line, Line][] = Array.from({ length: 10_000 }, () => [rng.line(), rng.line()])

describe('segment-pair intersection (FR-5)', () => {
  bench('10,000 random segment pairs', () => {
    for (const [a, b] of pairs) intersect(a, b)
  })
})
