import { createEmptyProject } from '@vitrum/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { VersionController } from '../versions/controller.svelte'

import VersionsPanel from './VersionsPanel.svelte'

/** A controller with no port, deterministic ids, and a no-op thumbnail renderer for tests. */
function controllerWith(): { versions: VersionController; restoreCalls: () => number } {
  let idc = 0
  let restored = 0
  const versions = new VersionController({
    getDoc: () => createEmptyProject({ name: 'test' }),
    restore: () => {
      restored++
    },
    openCopy: () => {},
    newId: () => `id-${idc++}`,
    renderThumbnail: async () => null,
  })
  return { versions, restoreCalls: () => restored }
}

describe('VersionsPanel (F-055)', () => {
  it('prompts when there are no versions yet', () => {
    const { versions } = controllerWith()
    render(VersionsPanel, { versions })
    expect(screen.getByText(/No versions yet/)).toBeInTheDocument()
  })

  it('lists a saved version with its name (FR-5)', async () => {
    const { versions } = controllerWith()
    await versions.useDocument(null)
    await versions.saveVersion('client draft 2', 'first cut')
    render(VersionsPanel, { versions })
    expect(await screen.findByText('client draft 2')).toBeInTheDocument()
    expect(screen.getByText('first cut')).toBeInTheDocument()
    expect(screen.getByText('Named')).toBeInTheDocument()
  })

  it('restores a version through the controller (FR-2)', async () => {
    const { versions, restoreCalls } = controllerWith()
    await versions.useDocument(null)
    await versions.saveVersion('v')
    render(VersionsPanel, { versions })
    await fireEvent.click(await screen.findByRole('button', { name: 'Restore this version' }))
    expect(restoreCalls()).toBe(1)
  })

  it('opens the save-version dialog', async () => {
    const { versions } = controllerWith()
    render(VersionsPanel, { versions })
    await fireEvent.click(screen.getByRole('button', { name: 'Save version…' }))
    expect(await screen.findByRole('dialog', { name: 'Save version' })).toBeInTheDocument()
  })

  it('shows a read-only banner with edit-a-copy (FR-8)', async () => {
    const { versions } = controllerWith()
    const onEditCopy = vi.fn()
    render(VersionsPanel, { versions, readOnly: true, onEditCopy })
    await fireEvent.click(screen.getByRole('button', { name: 'Edit a copy' }))
    expect(onEditCopy).toHaveBeenCalledOnce()
    // Restore is disabled while read-only.
    expect(screen.queryByRole('button', { name: 'Save version…' })).toBeNull()
  })

  it('offers export for sharing when a handler is provided (FR-7)', async () => {
    const { versions } = controllerWith()
    const onShare = vi.fn()
    render(VersionsPanel, { versions, onShare })
    await fireEvent.click(screen.getByRole('button', { name: 'Export for sharing…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export for sharing' })
    expect(dialog).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(onShare).toHaveBeenCalledOnce())
  })
})
