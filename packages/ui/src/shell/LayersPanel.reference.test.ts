import { DocumentStore } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'
import type { OpenedImage } from '../document/host'
import { ReferenceController } from '../reference/controller.svelte'

import LayersPanel from './LayersPanel.svelte'

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

describe('LayersPanel — reference images (F-051)', () => {
  it('lists reference layers and fires the add-image action', async () => {
    const controller = await withLayers(2)
    const onAddReference = vi.fn()
    render(LayersPanel, {
      viewport: new ViewportController(),
      reference: controller,
      onAddReference,
    })

    expect(screen.getByText('Reference images')).toBeInTheDocument()
    expect(screen.getByText('photo-0')).toBeInTheDocument()
    expect(screen.getByText('photo-1')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /add image/i }))
    expect(onAddReference).toHaveBeenCalledOnce()
  })

  it('toggles a layer visibility through the eye button', async () => {
    const controller = await withLayers(1)
    render(LayersPanel, { viewport: new ViewportController(), reference: controller })

    expect(controller.layers[0]!.visible).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: /hide layer/i }))
    expect(controller.layers[0]!.visible).toBe(false)
  })

  it('shows the placeholder when no reference controller is provided', () => {
    render(LayersPanel, { viewport: new ViewportController() })
    expect(screen.getByText('Reference photo')).toBeInTheDocument()
    expect(screen.queryByText('Reference images')).not.toBeInTheDocument()
  })
})
