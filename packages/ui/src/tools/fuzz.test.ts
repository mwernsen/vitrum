import {
  arcTool,
  bezierTool,
  borderTool,
  circleTool,
  lineTool,
  polygonTool,
  rectangleTool,
  type SegmentDraft,
  type ToolDef,
  type ToolInput,
} from '@vitrum/core'
import { vec2, type Vec2 } from '@vitrum/geometry'
import {
  addSegments,
  createEmptyProject,
  createSegment,
  DocumentStore,
  replaceSegments,
} from '@vitrum/model'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

/**
 * F-011 acceptance: random tool gestures interleaved with undo/redo never corrupt the
 * document. This extends F-002's undo-all-≡-initial property from single commands to the
 * real commands drawing tools emit — multi-segment `addSegments` and the border tool's
 * `replaceSegments` swap — driving each tool's actual pure reducer.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: ToolDef<any>[] = [
  lineTool,
  arcTool,
  bezierTool,
  rectangleTool,
  circleTool,
  polygonTool,
  borderTool,
]

/** Fold a gesture's inputs into a tool, returning the drafts it commits (possibly none). */
function drive(tool: ToolDef<unknown>, inputs: readonly ToolInput[]): SegmentDraft[] {
  let state = tool.initial
  const drafts: SegmentDraft[] = []
  for (const input of inputs) {
    const step = tool.reduce(state, input)
    state = step.state
    if (step.commit) drafts.push(...step.commit)
  }
  return drafts
}

/** A completed-gesture input sequence for a tool, built from up to four points. */
function gestureInputs(toolIndex: number, points: readonly Vec2[]): ToolInput[] {
  const clicks: ToolInput[] = points.map((at) => ({ type: 'down', at }))
  switch (toolIndex) {
    case 0: // line: chain then finish
    case 2: // bezier: plain clicks then finish (down+up per click)
      return [
        ...points.flatMap((at) => [{ type: 'down', at } as const, { type: 'up', at } as const]),
        { type: 'enter' },
      ]
    case 1: // arc: three points commit on the third
      return clicks.slice(0, 3)
    default: // rectangle/circle/polygon/border: two corners
      return clicks.slice(0, 2)
  }
}

/** Apply a gesture's drafts the way ToolController does: one command per gesture. */
function commitDrafts(store: DocumentStore, drafts: readonly SegmentDraft[]): void {
  if (drafts.length === 0) return
  const segments = drafts.map((d) => createSegment(d.geometry, d.role))
  if (drafts.every((d) => d.role === 'border')) {
    const existing = Object.values(store.document.segments)
      .filter((s) => s.role === 'border')
      .map((s) => s.id)
    store.execute(replaceSegments(existing, segments))
  } else {
    store.execute(addSegments(segments))
  }
}

const pointArb = fc.record({
  x: fc.integer({ min: -500, max: 500 }),
  y: fc.integer({ min: -500, max: 500 }),
})

const opArb = fc.oneof(
  fc.record({
    t: fc.constant('draw' as const),
    tool: fc.integer({ min: 0, max: TOOLS.length - 1 }),
    points: fc.array(pointArb, { minLength: 2, maxLength: 4 }),
  }),
  fc.record({ t: fc.constant('undo' as const) }),
  fc.record({ t: fc.constant('redo' as const) }),
)
type Op = ReturnType<(typeof opArb)['generate']>['value']

function runOps(store: DocumentStore, ops: readonly Op[]): void {
  for (const op of ops) {
    if (op.t === 'undo') store.undo()
    else if (op.t === 'redo') store.redo()
    else {
      const inputs = gestureInputs(
        op.tool,
        op.points.map((p) => vec2(p.x, p.y)),
      )
      commitDrafts(store, drive(TOOLS[op.tool]!, inputs))
    }
  }
}

describe('tool-gesture undo/redo fuzz (F-011 acceptance)', () => {
  it('undo-all after random gestures returns the initial document', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const initial = createEmptyProject()
        const store = new DocumentStore(initial)
        runOps(store, ops)
        while (store.canUndo) store.undo()
        expect(store.document).toEqual(initial)
      }),
    )
  })

  it('redo-all after undo-all reproduces the drawn document', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const store = new DocumentStore(createEmptyProject())
        // Only draws here, so redo can fully reconstruct (undo/redo ops would truncate).
        const draws = ops.filter((o) => o.t === 'draw')
        runOps(store, draws)
        const drawn = store.document
        while (store.canUndo) store.undo()
        while (store.canRedo) store.redo()
        expect(store.document).toEqual(drawn)
      }),
    )
  })
})
