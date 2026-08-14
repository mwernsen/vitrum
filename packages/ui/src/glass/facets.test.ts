import { HUE_BUCKETS, TEXTURE_TAGS, TRANSPARENCY_CLASSES } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import {
  HUE_OPTIONS,
  TEXTURE_OPTIONS,
  TRANSPARENCY_OPTIONS,
  hasActiveFacets,
  toGlassFilter,
  type FacetSelection,
} from './facets'

const empty: FacetSelection = { query: '', hue: '', transparency: '', texture: '' }

describe('facet option lists', () => {
  it('lead with an "any" sentinel, then one capitalised option per value', () => {
    expect(HUE_OPTIONS[0]).toEqual({ value: '', label: 'Any hue' })
    expect(HUE_OPTIONS).toHaveLength(HUE_BUCKETS.length + 1)
    expect(HUE_OPTIONS.map((o) => o.value)).toEqual(['', ...HUE_BUCKETS])
    expect(HUE_OPTIONS[1]).toEqual({ value: 'red', label: 'Red' })

    expect(TRANSPARENCY_OPTIONS[0]).toEqual({ value: '', label: 'Any transparency' })
    expect(TRANSPARENCY_OPTIONS).toHaveLength(TRANSPARENCY_CLASSES.length + 1)

    expect(TEXTURE_OPTIONS[0]).toEqual({ value: '', label: 'Any texture' })
    expect(TEXTURE_OPTIONS).toHaveLength(TEXTURE_TAGS.length + 1)
  })
})

describe('toGlassFilter', () => {
  it('drops "any" sentinels so an unset facet does not constrain', () => {
    expect(toGlassFilter(empty)).toEqual({ query: '' })
  })

  it('keeps only the set facets, with the query always present', () => {
    expect(
      toGlassFilter({ query: 'ruby', hue: 'red', transparency: '', texture: 'seedy' }),
    ).toEqual({ query: 'ruby', hue: 'red', texture: 'seedy' })
  })
})

describe('hasActiveFacets', () => {
  it('is false for the empty selection and a whitespace-only query', () => {
    expect(hasActiveFacets(empty)).toBe(false)
    expect(hasActiveFacets({ ...empty, query: '   ' })).toBe(false)
  })

  it('is true when any facet or a real query is set', () => {
    expect(hasActiveFacets({ ...empty, query: 'ruby' })).toBe(true)
    expect(hasActiveFacets({ ...empty, hue: 'red' })).toBe(true)
    expect(hasActiveFacets({ ...empty, transparency: 'opaque' })).toBe(true)
    expect(hasActiveFacets({ ...empty, texture: 'seedy' })).toBe(true)
  })
})
