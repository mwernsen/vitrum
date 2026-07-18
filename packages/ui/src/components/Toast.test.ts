import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { createRawSnippet } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import Toast from './Toast.svelte'

const message = createRawSnippet(() => ({ render: () => `<span>Cut list exported</span>` }))

describe('Toast', () => {
  it('renders its message with a status role', () => {
    render(Toast, { children: message, tone: 'success' })
    expect(screen.getByRole('status')).toHaveTextContent('Cut list exported')
  })

  it('renders an action button that fires onAction', async () => {
    const onAction = vi.fn()
    render(Toast, { children: message, action: 'Undo', onAction })
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('omits the action button when no action is given', () => {
    render(Toast, { children: message })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
