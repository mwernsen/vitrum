import { describe, expect, it } from 'vitest'

import { SelectionController } from './selection.svelte'

describe('SelectionController', () => {
  it('replaces, toggles and clears', () => {
    const s = new SelectionController()
    s.replace(['a', 'b'])
    expect([...s.selected].sort()).toEqual(['a', 'b'])
    s.toggle('a')
    expect([...s.selected]).toEqual(['b'])
    s.toggle('c')
    expect([...s.selected].sort()).toEqual(['b', 'c'])
    s.clear()
    expect(s.isEmpty).toBe(true)
  })

  it('select-all and invert over a universe', () => {
    const s = new SelectionController()
    const all = ['a', 'b', 'c', 'd']
    s.replace(['a', 'b'])
    s.invert(all)
    expect([...s.selected].sort()).toEqual(['c', 'd'])
    s.selectAll(all)
    expect(s.size).toBe(4)
  })

  it('plain click selects the nearest; clicking the same stack cycles through it', () => {
    const s = new SelectionController()
    const stack = ['top', 'mid', 'bottom']
    s.click(stack, false)
    expect(s.single).toBe('top')
    s.click(stack, false)
    expect(s.single).toBe('mid')
    s.click(stack, false)
    expect(s.single).toBe('bottom')
    s.click(stack, false)
    expect(s.single).toBe('top') // wraps
  })

  it('a click on a different stack resets the cycle', () => {
    const s = new SelectionController()
    s.click(['a', 'b'], false)
    expect(s.single).toBe('a')
    s.click(['x', 'y'], false)
    expect(s.single).toBe('x')
  })

  it('Shift-click toggles the nearest candidate into the selection', () => {
    const s = new SelectionController()
    s.replace(['a'])
    s.click(['b'], true)
    expect([...s.selected].sort()).toEqual(['a', 'b'])
    s.click(['a'], true)
    expect([...s.selected]).toEqual(['b'])
  })

  it('plain click on empty space clears; Shift-click on empty is a no-op', () => {
    const s = new SelectionController()
    s.replace(['a'])
    s.click([], true)
    expect(s.size).toBe(1)
    s.click([], false)
    expect(s.isEmpty).toBe(true)
  })
})
