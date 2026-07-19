import type { Glass, SheetSize, TextureTag, TransparencyClass } from './types'

/**
 * The glass catalog (F-022): the library of glass a designer assigns to pieces. Like KiCad's
 * symbol/footprint libraries there are two levels — a global user library shared across
 * projects ({@link glassLibrary}) and per-project glass copies stored in the document so a
 * shared file is self-contained (FR-1). This module owns the shipped starter catalog data, the
 * pure hue/search/filter logic the palette panel drives (FR-3), and the copy-on-write helpers
 * (FR-2). The `Glass`/`SheetSize`/`TransparencyClass`/`TextureTag` shapes live in `types.ts` with
 * the other document entities; this module builds on them.
 *
 * Everything here is plain, deeply-readonly data with pure functions. Project-scope mutation
 * happens through the commands in `commands.ts`; the global library is edited through the pure
 * operations in `glassLibrary.ts`. The shipped {@link STARTER_GLASSES} are frozen and never
 * mutated — user edits copy-on-write (FR-2).
 */

/** The enumerated texture tags, for the palette's texture filter and the editor's picker. */
export const TEXTURE_TAGS: readonly TextureTag[] = [
  'smooth',
  'hammered',
  'seedy',
  'streaky',
  'ripple',
  'granite',
]

/** The transparency classes, in display order. */
export const TRANSPARENCY_CLASSES: readonly TransparencyClass[] = [
  'transparent',
  'translucent',
  'opalescent',
  'opaque',
]

/**
 * A coarse colour-wheel bucket derived from a glass's base colour — the axis the palette filters
 * by "hue" on (FR-3). Low-saturation glass (clear, whites, greys, black) buckets as `neutral`.
 */
export type HueBucket =
  'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'neutral'

/** The hue buckets, in colour-wheel order with `neutral` last. */
export const HUE_BUCKETS: readonly HueBucket[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'neutral',
]

/* -------------------------------------------------------------------------- */
/* Colour / hue                                                                */
/* -------------------------------------------------------------------------- */

/** Parse `#rgb`/`#rrggbb` into 0–255 channels, or null if unparseable. */
export function parseHex(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** HSL of a hex colour: `h` in [0,360), `s`/`l` in [0,1]. Neutral greys report `h = 0`, `s = 0`. */
export function hexToHsl(color: string): { h: number; s: number; l: number } | null {
  const rgb = parseHex(color)
  if (!rgb) return null
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return { h, s, l }
}

/**
 * Bucket a base colour onto the coarse hue wheel used by the palette's hue filter (FR-3). Low
 * saturation — clear, whites, greys, blacks — buckets as `neutral` so uncoloured glass groups
 * together. Unparseable colours also fall back to `neutral`.
 */
export function hueBucket(color: string): HueBucket {
  const hsl = hexToHsl(color)
  if (!hsl) return 'neutral'
  // Desaturated or near-black/near-white glass is neutral regardless of hue.
  if (hsl.s < 0.15 || hsl.l < 0.06 || hsl.l > 0.96) return 'neutral'
  const h = ((hsl.h % 360) + 360) % 360
  if (h < 15 || h >= 345) return 'red'
  if (h < 45) return 'orange'
  if (h < 70) return 'yellow'
  if (h < 160) return 'green'
  if (h < 200) return 'teal'
  if (h < 255) return 'blue'
  if (h < 300) return 'purple'
  return 'pink'
}

/* -------------------------------------------------------------------------- */
/* Search / filter                                                             */
/* -------------------------------------------------------------------------- */

/** A palette filter. All present criteria must match (AND); absent criteria don't constrain. */
export interface GlassFilter {
  /** Free-text query matched against name, manufacturer, SKU, texture and transparency. */
  readonly query?: string
  readonly hue?: HueBucket
  readonly transparency?: TransparencyClass
  readonly texture?: TextureTag
}

/** Whether a glass satisfies a filter (FR-3). Empty/whitespace query does not constrain. */
export function matchesGlass(glass: Glass, filter: GlassFilter): boolean {
  const q = filter.query?.trim().toLowerCase()
  if (q) {
    const haystack = [glass.name, glass.manufacturer, glass.sku, glass.texture, glass.transparency]
      .filter((s): s is string => typeof s === 'string')
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(q)) return false
  }
  if (filter.hue && hueBucket(glass.color) !== filter.hue) return false
  if (filter.transparency && glass.transparency !== filter.transparency) return false
  if (filter.texture && glass.texture !== filter.texture) return false
  return true
}

/** Filter a glass collection, preserving input order (FR-3). */
export function filterGlasses(glasses: readonly Glass[], filter: GlassFilter): Glass[] {
  return glasses.filter((g) => matchesGlass(g, filter))
}

/* -------------------------------------------------------------------------- */
/* Swatch sizing (FR-5)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Target pixel dimensions for a swatch image so its longest side is at most `max`, preserving
 * aspect ratio and never upscaling (FR-5). Pure — the actual raster downscale (a `<canvas>`
 * concern) lives in `packages/ui`; this is the size maths, so it is unit-tested here.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The default swatch cap in pixels (FR-5, "~512 px"). */
export const SWATCH_MAX_PX = 512

/* -------------------------------------------------------------------------- */
/* Starter catalog (FR-2)                                                       */
/* -------------------------------------------------------------------------- */

const DEFAULT_SHEET_SIZES: readonly SheetSize[] = [
  { widthMm: 305, heightMm: 305, label: 'sample' },
  { widthMm: 610, heightMm: 914, label: 'full sheet' },
]

/**
 * The shipped starter catalog: 60 hand-curated generic glasses spanning the colour wheel ×
 * common transparency/texture combinations, with plausible names mimicking real glass lines
 * (the manufacturer names are fictional). Ids are stable readable slugs so saved references stay
 * meaningful. This array is deeply frozen and NEVER mutated: on first run a fresh *copy* seeds the
 * user's global library (FR-2, copy-on-write), and any edit produces a new library value, leaving
 * these shipped objects pristine.
 */
export const STARTER_GLASSES: readonly Glass[] = deepFreezeGlasses([
  // Reds
  glass(
    'gl-ruby-cathedral',
    'Ruby cathedral',
    '#9b1b26',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1101',
    96,
  ),
  glass(
    'gl-crimson-seedy',
    'Crimson seedy',
    '#b02231',
    'translucent',
    'seedy',
    'Aurora Glass',
    'AG-1104',
    104,
  ),
  glass(
    'gl-garnet-streaky',
    'Garnet streaky',
    '#7c2230',
    'translucent',
    'streaky',
    'Meridian',
    'MR-220',
    118,
  ),
  glass(
    'gl-cardinal-opal',
    'Cardinal opalescent',
    '#c0343f',
    'opalescent',
    'granite',
    'Riverstone',
    'RS-540',
    88,
  ),
  glass(
    'gl-brick-opaque',
    'Brick opaque',
    '#8f3a34',
    'opaque',
    'hammered',
    'Old Forge',
    'OF-071',
    72,
  ),
  // Oranges
  glass(
    'gl-amber-cathedral',
    'Amber cathedral',
    '#c77e28',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1210',
    84,
  ),
  glass(
    'gl-tangerine-hammered',
    'Tangerine hammered',
    '#d2691e',
    'translucent',
    'hammered',
    'Cathedral Works',
    'CW-330',
    92,
  ),
  glass(
    'gl-marigold-ripple',
    'Marigold ripple',
    '#e07a1f',
    'translucent',
    'ripple',
    'Lumen',
    'LM-410',
    98,
  ),
  glass(
    'gl-copper-streaky',
    'Copper streaky',
    '#a9581f',
    'opalescent',
    'streaky',
    'Meridian',
    'MR-244',
    122,
  ),
  glass('gl-clay-opaque', 'Clay opaque', '#9c5b39', 'opaque', 'smooth', 'Old Forge', 'OF-088', 70),
  // Ambers / yellows
  glass(
    'gl-honey-seedy',
    'Honey seedy',
    '#d9a520',
    'transparent',
    'seedy',
    'Aurora Glass',
    'AG-1305',
    82,
  ),
  glass(
    'gl-sunflower-cathedral',
    'Sunflower cathedral',
    '#e8c02a',
    'transparent',
    'smooth',
    'Lumen',
    'LM-430',
    80,
  ),
  glass(
    'gl-goldenrod-ripple',
    'Goldenrod ripple',
    '#e6b422',
    'translucent',
    'ripple',
    'Cathedral Works',
    'CW-352',
    90,
  ),
  glass(
    'gl-butter-opal',
    'Butter opalescent',
    '#f0d878',
    'opalescent',
    'streaky',
    'Riverstone',
    'RS-560',
    86,
  ),
  glass(
    'gl-maize-opaque',
    'Maize opaque',
    '#d8c24a',
    'opaque',
    'granite',
    'Old Forge',
    'OF-102',
    68,
  ),
  // Greens
  glass(
    'gl-emerald-cathedral',
    'Emerald cathedral',
    '#1f7a4d',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1408',
    100,
  ),
  glass(
    'gl-fern-hammered',
    'Fern hammered',
    '#3f8f47',
    'translucent',
    'hammered',
    'Cathedral Works',
    'CW-372',
    94,
  ),
  glass(
    'gl-moss-streaky',
    'Moss streaky',
    '#5a7a34',
    'translucent',
    'streaky',
    'Meridian',
    'MR-268',
    116,
  ),
  glass(
    'gl-jade-opal',
    'Jade opalescent',
    '#4f9d78',
    'opalescent',
    'granite',
    'Riverstone',
    'RS-582',
    90,
  ),
  glass('gl-olive-seedy', 'Olive seedy', '#6b7a2e', 'transparent', 'seedy', 'Lumen', 'LM-452', 88),
  glass(
    'gl-forest-opaque',
    'Forest opaque',
    '#2f5d3a',
    'opaque',
    'granite',
    'Old Forge',
    'OF-115',
    72,
  ),
  glass(
    'gl-spring-ripple',
    'Spring ripple',
    '#7bbf6a',
    'translucent',
    'ripple',
    'Cathedral Works',
    'CW-388',
    92,
  ),
  // Teals
  glass(
    'gl-teal-cathedral',
    'Teal cathedral',
    '#137a83',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1512',
    102,
  ),
  glass(
    'gl-seafoam-ripple',
    'Seafoam ripple',
    '#3fae9f',
    'translucent',
    'ripple',
    'Lumen',
    'LM-470',
    96,
  ),
  glass(
    'gl-aqua-opal',
    'Aqua opalescent',
    '#68b6b0',
    'opalescent',
    'streaky',
    'Riverstone',
    'RS-604',
    90,
  ),
  glass(
    'gl-teal-streaky',
    'Deep teal streaky',
    '#0f5f66',
    'translucent',
    'streaky',
    'Meridian',
    'MR-290',
    120,
  ),
  // Blues
  glass(
    'gl-cobalt-cathedral',
    'Cobalt cathedral',
    '#1c3f9b',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1604',
    110,
  ),
  glass(
    'gl-sapphire-seedy',
    'Sapphire seedy',
    '#26468f',
    'transparent',
    'seedy',
    'Cathedral Works',
    'CW-402',
    108,
  ),
  glass(
    'gl-sky-hammered',
    'Sky hammered',
    '#5a86c4',
    'translucent',
    'hammered',
    'Lumen',
    'LM-488',
    98,
  ),
  glass(
    'gl-cornflower-opal',
    'Cornflower opalescent',
    '#6f93cf',
    'opalescent',
    'granite',
    'Riverstone',
    'RS-626',
    92,
  ),
  glass(
    'gl-steel-streaky',
    'Steel blue streaky',
    '#3c5a7a',
    'translucent',
    'streaky',
    'Meridian',
    'MR-312',
    118,
  ),
  glass('gl-navy-opaque', 'Navy opaque', '#22335f', 'opaque', 'granite', 'Old Forge', 'OF-131', 74),
  glass(
    'gl-glacier-ripple',
    'Glacier ripple',
    '#9dc7e0',
    'translucent',
    'ripple',
    'Cathedral Works',
    'CW-418',
    94,
  ),
  // Purples
  glass(
    'gl-amethyst-cathedral',
    'Amethyst cathedral',
    '#6a3d99',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1708',
    108,
  ),
  glass(
    'gl-violet-seedy',
    'Violet seedy',
    '#7a4bb0',
    'transparent',
    'seedy',
    'Lumen',
    'LM-506',
    100,
  ),
  glass(
    'gl-plum-streaky',
    'Plum streaky',
    '#5c3a63',
    'translucent',
    'streaky',
    'Meridian',
    'MR-334',
    116,
  ),
  glass(
    'gl-lavender-opal',
    'Lavender opalescent',
    '#a488c4',
    'opalescent',
    'hammered',
    'Riverstone',
    'RS-648',
    92,
  ),
  glass(
    'gl-eggplant-opaque',
    'Eggplant opaque',
    '#3f2a4d',
    'opaque',
    'granite',
    'Old Forge',
    'OF-144',
    76,
  ),
  // Pinks / magentas
  glass(
    'gl-rose-cathedral',
    'Rose cathedral',
    '#c04a78',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1802',
    96,
  ),
  glass(
    'gl-fuchsia-hammered',
    'Fuchsia hammered',
    '#b83b7a',
    'translucent',
    'hammered',
    'Cathedral Works',
    'CW-436',
    98,
  ),
  glass(
    'gl-blush-opal',
    'Blush opalescent',
    '#e2a9c0',
    'opalescent',
    'streaky',
    'Riverstone',
    'RS-660',
    88,
  ),
  glass(
    'gl-magenta-streaky',
    'Magenta streaky',
    '#9d2f66',
    'translucent',
    'streaky',
    'Meridian',
    'MR-356',
    118,
  ),
  // Neutrals — clears, whites, greys, blacks, warm browns
  glass(
    'gl-clear-float',
    'Clear float',
    '#f2f4f5',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1000',
    48,
  ),
  glass(
    'gl-clear-seedy',
    'Clear seedy',
    '#eef1f2',
    'transparent',
    'seedy',
    'Cathedral Works',
    'CW-100',
    58,
  ),
  glass(
    'gl-clear-hammered',
    'Clear hammered',
    '#e9edee',
    'transparent',
    'hammered',
    'Lumen',
    'LM-110',
    60,
  ),
  glass(
    'gl-clear-ripple',
    'Clear ripple',
    '#e6ebec',
    'transparent',
    'ripple',
    'Cathedral Works',
    'CW-104',
    62,
  ),
  glass(
    'gl-clear-granite',
    'Clear granite',
    '#e4eaeb',
    'transparent',
    'granite',
    'Cathedral Works',
    'CW-108',
    64,
  ),
  glass(
    'gl-white-opal',
    'White opalescent',
    '#f4f1ec',
    'opalescent',
    'smooth',
    'Riverstone',
    'RS-500',
    66,
  ),
  glass(
    'gl-white-streaky',
    'White streaky',
    '#efeae2',
    'opalescent',
    'streaky',
    'Riverstone',
    'RS-502',
    68,
  ),
  glass(
    'gl-ivory-opaque',
    'Ivory opaque',
    '#e8e0cf',
    'opaque',
    'smooth',
    'Old Forge',
    'OF-020',
    62,
  ),
  glass(
    'gl-pearl-granite',
    'Pearl granite',
    '#dcd8d0',
    'opalescent',
    'granite',
    'Riverstone',
    'RS-506',
    70,
  ),
  glass(
    'gl-smoke-cathedral',
    'Smoke cathedral',
    '#8a8f92',
    'transparent',
    'smooth',
    'Meridian',
    'MR-400',
    78,
  ),
  glass(
    'gl-slate-streaky',
    'Slate streaky',
    '#5c6468',
    'translucent',
    'streaky',
    'Meridian',
    'MR-404',
    96,
  ),
  glass(
    'gl-charcoal-opaque',
    'Charcoal opaque',
    '#33383b',
    'opaque',
    'granite',
    'Old Forge',
    'OF-160',
    76,
  ),
  glass(
    'gl-black-opaque',
    'Black opaque',
    '#141517',
    'opaque',
    'smooth',
    'Old Forge',
    'OF-166',
    80,
  ),
  glass(
    'gl-taupe-opal',
    'Taupe opalescent',
    '#b7a894',
    'opalescent',
    'hammered',
    'Riverstone',
    'RS-512',
    72,
  ),
  glass('gl-sand-seedy', 'Sand seedy', '#cbb98f', 'translucent', 'seedy', 'Lumen', 'LM-120', 74),
  glass(
    'gl-bronze-cathedral',
    'Bronze cathedral',
    '#7a5a2e',
    'transparent',
    'smooth',
    'Aurora Glass',
    'AG-1050',
    82,
  ),
  glass(
    'gl-chocolate-opaque',
    'Chocolate opaque',
    '#4a3325',
    'opaque',
    'granite',
    'Old Forge',
    'OF-172',
    74,
  ),
  glass('gl-fog-ripple', 'Fog ripple', '#d3d8da', 'translucent', 'ripple', 'Lumen', 'LM-130', 70),
])

/** Concise constructor for a starter glass (3 mm nominal, standard sheet sizes). */
function glass(
  id: string,
  name: string,
  color: string,
  transparency: TransparencyClass,
  texture: TextureTag,
  manufacturer: string,
  sku: string,
  pricePerM2: number,
): Glass {
  return {
    id,
    name,
    color,
    transparency,
    texture,
    thicknessMm: 3,
    manufacturer,
    sku,
    pricePerM2,
    sheetSizes: DEFAULT_SHEET_SIZES.map((s) => ({ ...s })),
  }
}

/** Deep-freeze every shipped glass (and its sheet-size list) so the starter data can never mutate. */
function deepFreezeGlasses(glasses: Glass[]): readonly Glass[] {
  for (const g of glasses) {
    if (g.sheetSizes) {
      for (const s of g.sheetSizes) Object.freeze(s)
      Object.freeze(g.sheetSizes)
    }
    Object.freeze(g)
  }
  return Object.freeze(glasses)
}

/**
 * A fresh, independent copy of the starter catalog — new deeply-mutable objects each call, so the
 * global library seeds from data no one else shares and the shipped {@link STARTER_GLASSES} stay
 * frozen (FR-2).
 */
export function starterGlasses(): Glass[] {
  return STARTER_GLASSES.map(cloneGlass)
}

/** A structural deep copy of a glass (used when seeding the library and consuming into a project). */
export function cloneGlass(g: Glass): Glass {
  return {
    ...g,
    sheetSizes: g.sheetSizes ? g.sheetSizes.map((s) => ({ ...s })) : undefined,
  }
}
