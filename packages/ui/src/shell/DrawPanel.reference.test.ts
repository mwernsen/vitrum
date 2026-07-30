import { DocumentStore } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'
import type { OpenedImage } from '../document/host'
import { ReferenceController } from '../reference/controller.svelte'

import DrawPanel from './DrawPanel.svelte'

/** Build a reference controller (real store, stubbed image pipeline) with `count` layers. */
async function withLayers(count: number) {
  const store = new DocumentStore()
  const controller = new ReferenceController({
    getDoc: () => store.document,
    execute: (command, options) => store.execute(command, options),
    prepare: async (bytes, mime) => ({ bytes, mime, width: 800, height: 600 }),
    decode: async () => ({}) as TexImageSource,
  })
  for (let i = 0; i < count; i++) {
    const img: OpenedImage = {
      path: `photo-${i}.png`,
      mime: 'image/png',
      bytes: new Uint8Array([i + 1]),
    }
    await controller.importImage(async () => img)
  }
  return controller
}

describe('DrawPanel — tracing underlay (F-051)', () => {
  it('lists reference layers and fires the add-image action', async () => {
    const controller = await withLayers(2)
    const onAddReference = vi.fn()
    render(DrawPanel, {
      viewport: new ViewportController(),
      reference: controller,
      onAddReference,
    })

    expect(screen.getByText('Tracing')).toBeInTheDocument()
    expect(screen.getByText('photo-0')).toBeInTheDocument()
    expect(screen.getByText('photo-1')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /add image/i }))
    expect(onAddReference).toHaveBeenCalledOnce()
  })

  it('toggles a layer visibility through the eye button', async () => {
    const controller = await withLayers(1)
    render(DrawPanel, { viewport: new ViewportController(), reference: controller })

    expect(controller.layers[0]!.visible).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: /hide layer/i }))
    expect(controller.layers[0]!.visible).toBe(false)
  })

  it('drives the opacity of the topmost layer with no explicit selection', async () => {
    const controller = await withLayers(1)
    render(DrawPanel, { viewport: new ViewportController(), reference: controller })

    const slider = screen.getByLabelText('Reference opacity') as HTMLInputElement
    await fireEvent.input(slider, { target: { value: '40' } })
    expect(controller.layers[0]!.opacity).toBeCloseTo(0.4, 5)
  })

  it('says so when there is nothing to trace yet', async () => {
    const controller = await withLayers(0)
    render(DrawPanel, { viewport: new ViewportController(), reference: controller })
    expect(screen.getByText(/No reference images/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Reference opacity')).not.toBeInTheDocument()
  })
})
