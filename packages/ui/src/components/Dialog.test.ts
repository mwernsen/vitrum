import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createRawSnippet } from 'svelte'

import Dialog from './Dialog.svelte'

const body = createRawSnippet(() => ({ render: () => `<p>Removes 12 panes.</p>` }))
const footer = createRawSnippet(() => ({ render: () => `<button>Cancel</button>` }))

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(Dialog, { open: false, title: 'Delete panel', children: body })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders a labelled modal dialog with its title and children when open', () => {
    render(Dialog, { open: true, title: 'Delete panel', children: body })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Delete panel')
    expect(screen.getByText('Removes 12 panes.')).toBeInTheDocument()
  })

  it('renders the footer snippet', () => {
    render(Dialog, { open: true, title: 'Delete panel', children: body, footer })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('calls onClose when the close button is pressed', async () => {
    const onClose = vi.fn()
    render(Dialog, { open: true, title: 'Delete panel', children: body, onClose })
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop is clicked but not the panel', async () => {
    const onClose = vi.fn()
    render(Dialog, { open: true, title: 'Delete panel', children: body, onClose })
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    // The backdrop is the dialog's offset parent; click it directly.
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    await userEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn()
    render(Dialog, { open: true, title: 'Delete panel', children: body, onClose })
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('treats a numeric width as pixels', () => {
    render(Dialog, { open: true, title: 'Delete panel', children: body, width: 640 })
    expect(screen.getByRole('dialog')).toHaveStyle({ width: '640px' })
  })
})
