import type {
  Project,
  ProjectSettings,
  Segment,
  SegmentGeometry,
  SegmentId,
  SegmentRole,
} from './types'

/**
 * The command pattern (F-002 FR-1). Every mutation of a `Project` is a `Command`:
 *
 * - `apply`   — a pure forward transform `Project -> Project` (structural sharing).
 * - `invert`  — given the document *before* `apply` ran, produce the command that
 *   exactly reverses it. The store keeps this so undo is precise (FR-2) without
 *   snapshotting the whole document.
 * - `merge`   — optional. Coalesces a following command of the same interaction into
 *   one history entry (e.g. every mouse-move of a drag). Returns the combined forward
 *   command, or `undefined` to decline.
 *
 * Commands are kept *semantic* ("addSegment", "moveNode") rather than generic patches
 * so DRC (F-030) and versioning (F-055) can reason about intent. They are the ONLY way
 * to change a document — the store exposes no raw setters.
 */
export interface Command {
  readonly kind: string
  apply(doc: Project): Project
  invert(before: Project): Command
  merge?(next: Command): Command | undefined
}

/* -------------------------------------------------------------------------- */
/* Segment commands                                                            */
/* -------------------------------------------------------------------------- */

/** Add a new segment. Fails if its id is already present (ids are never reused). */
export function addSegment(segment: Segment): Command {
  return {
    kind: 'addSegment',
    apply: (doc) => {
      if (segment.id in doc.segments) {
        throw new Error(`addSegment: segment ${segment.id} already exists`)
      }
      return { ...doc, segments: { ...doc.segments, [segment.id]: segment } }
    },
    invert: () => removeSegment(segment.id),
  }
}

/** Remove an existing segment. */
export function removeSegment(id: SegmentId): Command {
  return {
    kind: 'removeSegment',
    apply: (doc) => {
      if (!(id in doc.segments)) {
        throw new Error(`removeSegment: segment ${id} does not exist`)
      }
      return { ...doc, segments: withoutSegment(doc.segments, id) }
    },
    invert: (before) => {
      const segment = before.segments[id]
      if (!segment) throw new Error(`removeSegment.invert: segment ${id} does not exist`)
      return addSegment(segment)
    },
  }
}

interface UpdateGeometryCommand extends Command {
  readonly kind: 'updateSegmentGeometry'
  readonly segmentId: SegmentId
  readonly geometry: SegmentGeometry
}

/**
 * Replace a segment's geometry (the "move node / edit curve" mutation). Consecutive
 * updates to the same segment within one interaction coalesce via `merge`, so a drag
 * becomes a single undo entry whose inverse restores the pre-drag geometry.
 */
export function updateSegmentGeometry(id: SegmentId, geometry: SegmentGeometry): Command {
  const command: UpdateGeometryCommand = {
    kind: 'updateSegmentGeometry',
    segmentId: id,
    geometry,
    apply: (doc) => {
      const segment = doc.segments[id]
      if (!segment) throw new Error(`updateSegmentGeometry: segment ${id} does not exist`)
      return { ...doc, segments: { ...doc.segments, [id]: { ...segment, geometry } } }
    },
    invert: (before) => {
      const segment = before.segments[id]
      if (!segment) throw new Error(`updateSegmentGeometry.invert: segment ${id} does not exist`)
      return updateSegmentGeometry(id, segment.geometry)
    },
    merge: (next) => {
      if (next.kind !== 'updateSegmentGeometry') return undefined
      const other = next as UpdateGeometryCommand
      if (other.segmentId !== id) return undefined
      // Net effect of the drag so far: jump straight to the latest geometry.
      return updateSegmentGeometry(id, other.geometry)
    },
  }
  return command
}

/** Change a segment's role (lead / construction / border). */
export function setSegmentRole(id: SegmentId, role: SegmentRole): Command {
  return {
    kind: 'setSegmentRole',
    apply: (doc) => {
      const segment = doc.segments[id]
      if (!segment) throw new Error(`setSegmentRole: segment ${id} does not exist`)
      return { ...doc, segments: { ...doc.segments, [id]: { ...segment, role } } }
    },
    invert: (before) => {
      const segment = before.segments[id]
      if (!segment) throw new Error(`setSegmentRole.invert: segment ${id} does not exist`)
      return setSegmentRole(id, segment.role)
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Settings commands                                                           */
/* -------------------------------------------------------------------------- */

/** Patch project settings. Pass `panelSize: undefined` to clear the panel size. */
export function updateSettings(patch: Partial<ProjectSettings>): Command {
  return {
    kind: 'updateSettings',
    apply: (doc) => ({ ...doc, settings: mergeSettings(doc.settings, patch) }),
    invert: (before) => replaceSettings(before.settings),
  }
}

/** Restore settings wholesale — the inverse of `updateSettings`. */
function replaceSettings(settings: ProjectSettings): Command {
  return {
    kind: 'replaceSettings',
    apply: (doc) => ({ ...doc, settings }),
    invert: (before) => replaceSettings(before.settings),
  }
}

function mergeSettings(base: ProjectSettings, patch: Partial<ProjectSettings>): ProjectSettings {
  const units = patch.units ?? base.units
  const name = patch.name ?? base.name
  const panelSize = 'panelSize' in patch ? patch.panelSize : base.panelSize
  return panelSize ? { units, name, panelSize } : { units, name }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function withoutSegment(
  segments: Readonly<Record<SegmentId, Segment>>,
  id: SegmentId,
): Record<SegmentId, Segment> {
  const next: Record<SegmentId, Segment> = {}
  for (const key of Object.keys(segments)) {
    const segment = segments[key]
    if (key !== id && segment) next[key] = segment
  }
  return next
}
