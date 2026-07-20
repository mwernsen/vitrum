import { nanoid } from 'nanoid'

import type { CameProfileId } from './technique'
import type { GlassId, LayerId, NodeId, ReinforcementId, SegmentId } from './types'

/**
 * Stable-id generation. IDs are opaque strings, never reused and never derived from an
 * array index, so references between entities (piece → glass in later features) survive
 * insertion, deletion and save/load. Generation is the one impure step; it is kept out
 * of command application so commands stay pure and deterministic for property tests.
 */
export function newSegmentId(): SegmentId {
  return nanoid()
}

export function newNodeId(): NodeId {
  return nanoid()
}

export function newGlassId(): GlassId {
  return nanoid()
}

export function newLayerId(): LayerId {
  return nanoid()
}

/** A fresh came-profile id for a user-added library entry (seed profiles use readable slugs). */
export function newCameProfileId(): CameProfileId {
  return `came-${nanoid(8)}`
}

/** A fresh reinforcement-bar id (F-032). */
export function newReinforcementId(): ReinforcementId {
  return nanoid()
}
