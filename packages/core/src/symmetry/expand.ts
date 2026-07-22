import { symmetryTransforms, transformSymGeometry } from './transform'
import type { NetworkSegment, SymmetrySetup } from './types'

/**
 * Expand a source network into its symmetry replicas (F-052 Decision §2). Returns **only** the
 * replica segments (every group element except the identity); the source is left untouched so the
 * caller keeps its real ids/nodes. Pure and deterministic: replica ids derive solely from the
 * source id and the group-element index, so two source segments that share a node get replicas
 * that share a node (per-sector welds hold by construction — seam welds across sectors are left to
 * F-020's positional clustering, Decision §4), and repeated runs are byte-identical.
 *
 * `mode: 'none'` (or a radial count < 2) yields no replicas.
 */
export function expandReplicas(
  segments: readonly NetworkSegment[],
  setup: SymmetrySetup | undefined,
): NetworkSegment[] {
  if (!setup || setup.mode === 'none') return []
  const transforms = symmetryTransforms(setup)
  const replicas: NetworkSegment[] = []
  // Skip element 0 (identity = the source itself).
  for (let k = 1; k < transforms.length; k++) {
    const t = transforms[k]!
    const suffix = `~sym${k}`
    for (const seg of segments) {
      replicas.push({
        id: `${seg.id}${suffix}`,
        geometry: transformSymGeometry(t, seg.geometry),
        role: seg.role,
        endpoints: [`${seg.endpoints[0]}${suffix}`, `${seg.endpoints[1]}${suffix}`],
      })
    }
  }
  return replicas
}

/**
 * The full replicated network: the source segments followed by every replica. This is what piece
 * detection (F-020), DRC (F-030) and the outputs consume (F-052 Decision §2). When symmetry is off
 * it is just the source, unchanged.
 */
export function expandNetwork(
  segments: readonly NetworkSegment[],
  setup: SymmetrySetup | undefined,
): NetworkSegment[] {
  return [...segments, ...expandReplicas(segments, setup)]
}
