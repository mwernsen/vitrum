import { makeViewport } from '@vitrum/core'
import { vec2 } from '@vitrum/geometry'
import { DocumentStore } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'
import type { OpenedImage } from '../document/host'
import { ReferenceController } from '../reference/controller.svelte'

import ReferenceOverlay from './ReferenceOverlay.svelte'

/** An overlay over one imported 800×600 layer, with an identity viewport (screen px == world mm). */
async function setup() {
  const viewport = new ViewportController()
  viewport.transform = makeViewport(1, vec2(0, 0))
  const store = new DocumentStore()
  const controller = new ReferenceController({
    getDoc: () => store.document,
    execute: (command, options) => store.execute(command, options),
    prepare: async (bytes, mime) => ({ bytes, mime, width: 800, height: 600 }),
    decode: async () => ({}) as TexImageSource,
  })
  const img: OpenedImage = { path: 'photo.png', mime: 'image/png', bytes: new Uint8Array([1]) }
  await controller.importImage(async () => img)
  render(ReferenceOverlay, { controller, viewport })
  return { controller }
}

/** Width : height of the layer's destination quad — the aspect ratio a resize must keep. */
function ratio(controller: ReferenceController): number {
  const q = controller.layers[0]!.dstQuad
  return (q[1].x - q[0].x) / (q[3].y - q[0].y)
}

describe('ReferenceOverlay — corner handles', () => {
  it('a corner drag resizes the layer, keeping its aspect ratio', async () => {
    const { controller } = await setup()
    const before = ratio(controller)
    const handle = screen.getByRole('button', { name: /resize from the bottom-right corner/i })

    // Drag straight down: with a free corner this would stretch the height alone.
    await fireEvent.pointerDown(handle, { pointerId: 1, clientX: 300, clientY: 225 })
    await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 400 })
    await fireEvent.pointerUp(handle, { pointerId: 1 })

    const q = controller.layers[0]!.dstQuad
    expect(ratio(controller)).toBeCloseTo(before, 6)
    expect(q[3].y - q[0].y).toBeGreaterThan(0)
    expect(q[0]).toEqual(controller.layers[0]!.dstQuad[0]) // the opposite corner stays put
  })

  it('alt-dragging a corner moves that corner alone (free perspective tweak)', async () => {
    const { controller } = await setup()
    const before = ratio(controller)
    const handle = screen.getByRole('button', { name: /resize from the bottom-right corner/i })

    await fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 300,
      clientY: 225,
      altKey: true,
    })
    await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 400, altKey: true })
    await fireEvent.pointerUp(handle, { pointerId: 1 })

    const q = controller.layers[0]!.dstQuad
    expect(q[2]).not.toEqual(q[1]) // it did move
    expect(q[2].y).not.toBeCloseTo(q[3].y, 6) // and only it — the quad is no longer a rectangle
    expect(ratio(controller)).toBeCloseTo(before, 6) // the other three corners are untouched
  })
})
