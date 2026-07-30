import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Guards the offline font wiring (F-004 FR-3). The bundled `@fontsource-variable/*` packages name
 * their families "Onest Variable" / "Geist Mono Variable"; the vendored `--font-sans` / `--font-mono`
 * tokens ask for "Onest" / "Geist Mono". When the two drifted apart the whole UI silently rendered in
 * the OS fallback sans — invisible to every screenshot and to the offline assertion alike (nothing is
 * fetched, so offline passed trivially). `tokens/fonts.css` bridges the gap by declaring the faces
 * under the canonical names; these tests fail if a re-sync breaks that bridge.
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

/** Comments stripped, so the deviation notes (which quote `@import`) don't read as declarations. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const typography = stripComments(read('./design/tokens/typography.css'))
const fonts = stripComments(read('./design/tokens/fonts.css'))

/** The first (most-preferred) family in a font-family token list, unquoted. */
function preferredFamily(token: '--font-sans' | '--font-mono'): string {
  const value = new RegExp(`${token}\\s*:([^;]+);`).exec(typography)?.[1]
  expect(value, `${token} is declared in typography.css`).toBeDefined()
  const first = value!.split(',')[0]!.trim()
  return first.replace(/^["']|["']$/g, '')
}

/** Every family `fonts.css` declares an `@font-face` for, and the src of each face. */
function declaredFaces(): { family: string; src: string }[] {
  return [...fonts.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => {
    const block = match[1]!
    return {
      family: (/font-family:\s*["']?([^"';]+)["']?\s*;/.exec(block)?.[1] ?? '').trim(),
      src: (/src:\s*([^;]+);/.exec(block)?.[1] ?? '').trim(),
    }
  })
}

describe('design system fonts (F-004 FR-3)', () => {
  it('declares faces under the exact families the type ramp asks for', () => {
    const families = new Set(declaredFaces().map((face) => face.family))
    expect(families).toContain(preferredFamily('--font-sans'))
    expect(families).toContain(preferredFamily('--font-mono'))
  })

  it('sources every face from a locally bundled woff2, never a CDN', () => {
    const faces = declaredFaces()
    expect(faces.length).toBeGreaterThan(0)
    for (const face of faces) {
      expect(face.src).toContain('.woff2')
      expect(face.src).not.toMatch(/https?:/)
    }
    expect(fonts).not.toContain('@import')
  })

  it('does not import the font packages’ own stylesheets, which use "* Variable" names', () => {
    const index = read('./design/index.ts')
    expect(index).not.toMatch(/^\s*import\s+['"]@fontsource/m)
  })
})
