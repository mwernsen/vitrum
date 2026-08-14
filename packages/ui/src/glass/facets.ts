import {
  HUE_BUCKETS,
  TEXTURE_TAGS,
  TRANSPARENCY_CLASSES,
  type GlassFilter,
  type HueBucket,
  type TextureTag,
  type TransparencyClass,
} from '@vitrum/model'

/**
 * Shared facet-row plumbing for the glass surfaces (F-022 palette, F-063 library home). Both offer
 * the same hue / transparency / texture filters over the F-022 matching semantics; keeping the option
 * lists and the `Select`-value → `GlassFilter` assembly in one plain-TS place means the two surfaces
 * cannot drift and the (small) logic is unit-testable without a component (F-063 acceptance criteria).
 *
 * The empty string is the `Select`'s "Any …" sentinel — absent from a {@link GlassFilter}, so it
 * does not constrain (F-022 `matchesGlass`).
 */

/** One `<Select>` option: `''` is the "any" sentinel that clears the facet. */
export interface FacetOption<T extends string> {
  readonly value: T | ''
  readonly label: string
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function options<T extends string>(any: string, values: readonly T[]): FacetOption<T>[] {
  return [{ value: '', label: any }, ...values.map((v) => ({ value: v, label: cap(v) }))]
}

export const HUE_OPTIONS: FacetOption<HueBucket>[] = options('Any hue', HUE_BUCKETS)
export const TRANSPARENCY_OPTIONS: FacetOption<TransparencyClass>[] = options(
  'Any transparency',
  TRANSPARENCY_CLASSES,
)
export const TEXTURE_OPTIONS: FacetOption<TextureTag>[] = options('Any texture', TEXTURE_TAGS)

/** The live facet selection, before it is folded into a {@link GlassFilter}. */
export interface FacetSelection {
  readonly query: string
  readonly hue: HueBucket | ''
  readonly transparency: TransparencyClass | ''
  readonly texture: TextureTag | ''
}

/** Fold the raw facet selection into a {@link GlassFilter}, dropping the "any" sentinels (F-022 FR-3). */
export function toGlassFilter(sel: FacetSelection): GlassFilter {
  return {
    query: sel.query,
    ...(sel.hue ? { hue: sel.hue } : {}),
    ...(sel.transparency ? { transparency: sel.transparency } : {}),
    ...(sel.texture ? { texture: sel.texture } : {}),
  }
}

/** True when any facet or a non-blank query is active — used to offer a "clear filters" affordance. */
export function hasActiveFacets(sel: FacetSelection): boolean {
  return sel.query.trim() !== '' || sel.hue !== '' || sel.transparency !== '' || sel.texture !== ''
}
