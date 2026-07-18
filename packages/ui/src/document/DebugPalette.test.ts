import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { DocumentController } from './controller.svelte'
import DebugPalette from './DebugPalette.svelte'
import { createFakeHost } from './fakeHost'

let controller: DocumentController | undefined

afterEach(() => {
  controller?.dispose()
  controller = undefined
})

describe('DebugPalette', () => {
  it('adds a segment and reflects it, then undoes via the palette', async () => {
    const user = userEvent.setup()
    controller = new DocumentController(createFakeHost())
    controller.paletteOpen = true
    render(DebugPalette, { controller })

    expect(screen.getByTestId('segment-count')).toHaveTextContent('Segments: 0')

    await user.click(screen.getByRole('button', { name: 'Add segment' }))
    expect(screen.getByTestId('segment-count')).toHaveTextContent('Segments: 1')

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('segment-count')).toHaveTextContent('Segments: 0')
  })

  it('disables undo when there is nothing to undo', () => {
    controller = new DocumentController(createFakeHost())
    controller.paletteOpen = true
    render(DebugPalette, { controller })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })
})
