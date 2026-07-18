import { nanoid } from 'nanoid'

import type { GlassId, LayerId, SegmentId } from './types'

/**
 * Stable-id generation. IDs are opaque strings, never reused and never derived from an
 * array index, so references between entities (piece → glass in later features) survive
 * insertion, deletion and save/load. Generation is the one impure step; it is kept out
 * of command application so commands stay pure and deterministic for property tests.
 */
export function newSegmentId(): SegmentId {
  return nanoid()
}

export function newGlassId(): GlassId {
  return nanoid()
}

export function newLayerId(): LayerId {
  return nanoid()
}
