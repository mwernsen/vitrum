import type { GreyBitmap } from '@vitrum/core'
import type { ReferenceAsset, ReferenceLayer } from '@vitrum/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { TraceController } from './controller.svelte'
import { rasteriseLayer, type TraceSource } from './rasterise'
import { SyncTraceRunner, type TraceRequest, type TraceRunner } from './runner'
import TraceDialog from './TraceDialog.svelte'

/**
 * The autotrace dialog (F-059): the controls drive a live piece count, and an uncalibrated layer is
 * refused with a message pointing at F-051's calibration (FR-3).
 *
 * Rasterising a layer needs `createImageBitmap`, which jsdom has not got, so these tests inject a
 * synthetic grid through the controller's rasteriser seam. The pipeline itself is the real one — the
 * pure `@vitrum/core` trace, run inline by `SyncTraceRunner`.
 */

/**
 * A 1 px = 1 mm grid carrying a drawn rectangle split by a bar — two regions in near-black marker —
 * plus a **mid-grey stray construction line** across the left region. The construction line is the
 * point: at the recommended threshold it is not geometry and the panel has two pieces; past the
 * pencil it becomes a third. Same length, same shape, different luminance (FR-8).
 */
function twoRegions(): TraceSource {
  const width = 200
  const height = 140
  const data = new Uint8Array(width * height).fill(235) // paper
  const stroke = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    luma: number,
    widthPx = 6,
  ): void => {
    const half = widthPx / 2
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const dx = bx - ax
        const dy = by - ay
        const lenSq = dx * dx + dy * dy || 1
        const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq))
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if (d <= half) data[y * width + x] = luma
      }
    }
  }
  // The pencil line goes down first, so the marker stamps over it where they cross — a stray line
  // under the drawing, not a gap punched through it.
  stroke(60, 20, 60, 120, 150, 4)
  const corners: [number, number][] = [
    [20, 20],
    [180, 20],
    [180, 120],
    [20, 120],
  ]
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i]!
    const [bx, by] = corners[(i + 1) % 4]!
    stroke(ax, ay, bx, by, 30)
  }
  stroke(100, 20, 100, 120, 30) // the dividing bar

  const image: GreyBitmap = { width, height, data }
  return { image, grid: { width, height, origin: { x: 0, y: 0 }, mmPerPx: 1 } }
}

const layer = (over: Partial<ReferenceLayer> = {}): ReferenceLayer => ({
  id: 'l1',
  name: 'bench photo',
  assetId: 'a1',
  naturalWidthPx: 200,
  naturalHeightPx: 140,
  srcQuad: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 140 },
    { x: 0, y: 140 },
  ],
  dstQuad: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 140 },
    { x: 0, y: 140 },
  ],
  opacity: 0.6,
  desaturate: false,
  visible: true,
  locked: false,
  rectified: false,
  calibrated: true,
  ...over,
})

const asset: ReferenceAsset = { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }

/** A controller wired to the real pipeline, inline, over a synthetic grid. */
async function open(over: Partial<ReferenceLayer> = {}): Promise<TraceController> {
  const controller = new TraceController(new SyncTraceRunner(), async () => twoRegions())
  // The synthetic grid is 1 px = 1 mm — a deliberately coarse "scan" — so the mm tolerances are
  // scaled to match, exactly as the core synthetic tests do. The adaptive window keeps its shipped
  // radius: shrink it towards the stroke width and ink lying against a thick line fails the
  // local-mean test, which pulls a genuine junction apart.
  await controller.load(layer(over), asset)
  controller.set({ minBlobPx: 20, simplifyMm: 0.8, fitMm: 1.2 })
  await controller.recompute()
  return controller
}

describe('TraceDialog (F-059)', () => {
  it('shows the layer name, a live piece count and every control', async () => {
    const controller = await open()
    render(TraceDialog, { controller, onTrace: vi.fn() })

    expect(screen.getByText('bench photo')).toBeInTheDocument()
    expect(screen.getByText(/Pieces detected:/)).toBeInTheDocument()
    expect(screen.getByTestId('trace-piece-count')).toHaveTextContent('2')
    for (const label of [
      'Ink threshold',
      'Despeckle',
      'Simplification',
      'Curve fit',
      'Healing tolerance',
    ]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Trace as')).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Outer contour is the panel border' }),
    ).toBeInTheDocument()
  })

  it('updates the previewed piece count when a control moves', async () => {
    const controller = await open()
    render(TraceDialog, { controller, onTrace: vi.fn() })
    expect(screen.getByTestId('trace-piece-count')).toHaveTextContent('2')

    // Raise the threshold past the pencil and its stray line starts closing a third region.
    await fireEvent.input(screen.getByLabelText('Ink threshold'), { target: { value: '190' } })
    await waitFor(() => expect(screen.getByTestId('trace-piece-count')).toHaveTextContent('3'))

    // Back below the pencil, and the panel is two pieces again.
    await fireEvent.input(screen.getByLabelText('Ink threshold'), { target: { value: '100' } })
    await waitFor(() => expect(screen.getByTestId('trace-piece-count')).toHaveTextContent('2'))
  })

  it('keeps the mid-grey pencil line out of the trace, and lets it in past the threshold (FR-8)', async () => {
    const controller = await open()
    const before = controller.preview!.segments.length
    expect(controller.preview!.pieceCount).toBe(2)

    controller.set({ thresholdLuma: 190 })
    await controller.recompute()
    // The pencil line is now geometry: more segments, and a third region. Nothing but luminance could
    // have separated them — it is exactly as long and as straight as the marker bar beside it.
    expect(controller.preview!.segments.length).toBeGreaterThan(before)
    expect(controller.preview!.pieceCount).toBe(3)
  })

  it('refuses an uncalibrated layer and points at F-051 calibration (FR-3)', async () => {
    // The real rasteriser here: its calibration check runs before it touches any DOM API, so this
    // exercises the production path rather than a stand-in.
    const controller = new TraceController(new SyncTraceRunner(), rasteriseLayer)
    await controller.load(layer({ calibrated: false }), asset)
    render(TraceDialog, { controller, onTrace: vi.fn() })

    expect(controller.open).toBe(true)
    expect(controller.preview).toBeNull()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/has not been calibrated/)
    expect(alert).toHaveTextContent(/Calibrate scale/)
    // Nothing to add, so the confirm button is inert.
    expect(screen.getByRole('button', { name: 'Add lead lines' })).toBeDisabled()
  })

  it('emits no ids from the preview — the document mints its own on merge', async () => {
    const controller = await open()
    for (const draft of controller.preview!.segments) {
      expect(Object.keys(draft).sort()).toEqual(['geometry', 'role'])
    }
  })

  it('hands the runner a request a worker could actually receive', async () => {
    // The controller falls back to running inline when the worker is unusable, which would quietly
    // mask the classic Svelte 5 mistake: `options` is `$state`, so reading it yields a Proxy, and a
    // Proxy cannot be structured-cloned into a worker. Assert cloneability here rather than hoping the
    // packaged E2E notices.
    let seen: TraceRequest | null = null
    const sync = new SyncTraceRunner()
    const spy: TraceRunner = {
      run: (request) => {
        seen = request
        return sync.run(request)
      },
      dispose: () => sync.dispose(),
    }
    const controller = new TraceController(spy, async () => twoRegions())
    await controller.load(layer(), asset)

    expect(seen).not.toBeNull()
    expect(() => structuredClone(seen)).not.toThrow()
  })

  it('confirms through the callback and can be cancelled', async () => {
    const controller = await open()
    const onTrace = vi.fn()
    render(TraceDialog, { controller, onTrace })
    await fireEvent.click(screen.getByRole('button', { name: 'Add lead lines' }))
    expect(onTrace).toHaveBeenCalledOnce()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(controller.open).toBe(false)
  })
})
