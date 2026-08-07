import type { NewPanelSpec } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import NewPanelDialog, { type NewPanelChoice } from './NewPanelDialog.svelte'

function open(props: { photoAvailable?: boolean } = {}) {
  const onCreate = vi.fn<(spec: NewPanelSpec, choice: NewPanelChoice) => void>()
  const onClose = vi.fn()
  render(NewPanelDialog, { open: true, onCreate, onClose, ...props })
  return { onCreate, onClose }
}

const create = () => screen.getByRole('button', { name: 'Create panel' })

describe('NewPanelDialog (F-058 FR-3)', () => {
  it('creates a panel from the defaults, in millimetres', async () => {
    const { onCreate } = open()
    await fireEvent.click(create())
    expect(onCreate).toHaveBeenCalledWith(
      { name: 'Untitled panel', units: 'mm', widthMm: 300, heightMm: 400, technique: 'lead' },
      { fromPhoto: false },
    )
  })

  it('carries the name, size, units and technique the user chose', async () => {
    const { onCreate } = open()
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Chapel lancet' } })
    await fireEvent.input(screen.getByLabelText('Width'), { target: { value: '12' } })
    await fireEvent.input(screen.getByLabelText('Height'), { target: { value: '24' } })
    await fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'in' } })
    await fireEvent.click(screen.getByLabelText('Copper foil'))
    await fireEvent.click(create())

    const [spec] = onCreate.mock.calls[0]!
    expect(spec.name).toBe('Chapel lancet')
    expect(spec.units).toBe('in')
    expect(spec.technique).toBe('foil')
    expect(spec.widthMm).toBeCloseTo(304.8, 6)
    expect(spec.heightMm).toBeCloseTo(609.6, 6)
  })

  it('stays quiet until submit, then reports the bad field and creates nothing', async () => {
    const { onCreate } = open()
    await fireEvent.input(screen.getByLabelText('Width'), { target: { value: '0' } })
    expect(screen.queryByText('Must be greater than zero')).not.toBeInTheDocument()

    await fireEvent.click(create())
    expect(screen.getByText('Must be greater than zero')).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('closes without creating anything on cancel', async () => {
    const { onCreate, onClose } = open()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  describe('start from a photo (FR-12)', () => {
    it('offers the tracing on-ramp when the host can import images', async () => {
      const { onCreate } = open({ photoAvailable: true })
      await fireEvent.click(screen.getByLabelText('A photo or scan to trace'))
      await fireEvent.click(create())
      expect(onCreate).toHaveBeenCalledWith(expect.anything(), { fromPhoto: true })
    })

    it('hides it — and never requests it — on a host that cannot import images', async () => {
      const { onCreate } = open({ photoAvailable: false })
      expect(screen.queryByLabelText('A photo or scan to trace')).not.toBeInTheDocument()
      await fireEvent.click(create())
      expect(onCreate).toHaveBeenCalledWith(expect.anything(), { fromPhoto: false })
    })

    it('mentions that templates are still to come, so the third path is not a mystery', () => {
      open({ photoAvailable: false })
      expect(screen.getByText(/Pattern templates arrive with F-060/)).toBeInTheDocument()
    })
  })
})
