import type { Project, Segment } from './types'

/**
 * Queries over the lead-line network that downstream derivations share. The one contract
 * this file pins down is FR-5 of F-012: **construction** segments (guide lines and circles)
 * participate in snapping but must never reach piece detection (F-020), DRC (F-030) or any
 * export. Every such consumer should take its input from {@link outputSegments} rather than
 * iterating `project.segments` directly, so the exclusion is defined in exactly one place.
 */

/** True for a segment that contributes to the finished panel (everything but construction). */
export function isOutputSegment(segment: Segment): boolean {
  return segment.role !== 'construction'
}

/**
 * The segments piece detection, DRC and exports operate on: the whole network minus
 * construction guides. Insertion order is preserved (the `Project.segments` record iterates
 * in insertion order, which JSON round-trips).
 */
export function outputSegments(project: Project): Segment[] {
  return Object.values(project.segments).filter(isOutputSegment)
}

/** The ids of all construction guides — used by the reversible "clear all guides" command. */
export function constructionSegmentIds(project: Project): string[] {
  return Object.values(project.segments)
    .filter((s) => s.role === 'construction')
    .map((s) => s.id)
}
