/**
 * A tiny, dependency-free XML reader (F-050). SVG import must be DOM-free so parsing runs and
 * unit-tests in plain Node (`@vitrum/core` has no browser): we parse the SVG **string** into a
 * plain element tree rather than a live `SVGElement`. This is deliberately minimal — enough for
 * the well-formed XML that Illustrator, Inkscape and Affinity emit — not a general XML engine:
 *
 * - elements with single/double-quoted attributes, self-closing `<.../>` and nesting,
 * - `<?xml …?>` declarations, `<!DOCTYPE …>`, comments and CDATA are skipped,
 * - the five predefined entities and numeric character references are decoded in attribute values.
 *
 * Namespaced names (`xlink:href`, `inkscape:label`) are kept verbatim as the local lookup key.
 */

/** One parsed XML element: its (lowercased, namespace-stripped) tag, attributes and children. */
export interface XmlElement {
  /** Tag name, lowercased with any namespace prefix removed (`svg:path` → `path`). */
  readonly name: string
  /** Attributes, keyed by their raw name (prefix kept, e.g. `xlink:href`). */
  readonly attrs: Readonly<Record<string, string>>
  readonly children: readonly XmlElement[]
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Decode the predefined XML entities and numeric character references in an attribute value. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body] ?? whole
  })
}

/** Strip a namespace prefix and lowercase a tag name (`svg:linearGradient` → `lineargradient`). */
function localName(raw: string): string {
  const colon = raw.indexOf(':')
  return (colon >= 0 ? raw.slice(colon + 1) : raw).toLowerCase()
}

interface MutableElement {
  name: string
  attrs: Record<string, string>
  children: MutableElement[]
}

/**
 * Parse an XML/SVG string into its root element. Throws on a document with no element, or on a
 * mismatched/unclosed tag — a malformed file the caller reports rather than silently mis-importing.
 */
export function parseXml(source: string): XmlElement {
  let i = 0
  const n = source.length
  const stack: MutableElement[] = []
  let root: MutableElement | null = null

  const skipDirective = (close: string): void => {
    const end = source.indexOf(close, i)
    i = end < 0 ? n : end + close.length
  }

  while (i < n) {
    const lt = source.indexOf('<', i)
    if (lt < 0) break
    i = lt

    if (source.startsWith('<!--', i)) {
      skipDirective('-->')
      continue
    }
    if (source.startsWith('<![CDATA[', i)) {
      skipDirective(']]>')
      continue
    }
    if (source.startsWith('<!', i) || source.startsWith('<?', i)) {
      // DOCTYPE / processing instruction / XML declaration — skip to the matching '>'.
      skipDirective('>')
      continue
    }

    if (source[i + 1] === '/') {
      // Closing tag.
      const end = source.indexOf('>', i)
      if (end < 0) throw new Error('parseXml: unterminated closing tag')
      const name = localName(source.slice(i + 2, end).trim())
      const top = stack.pop()
      if (!top || top.name !== name) {
        throw new Error(`parseXml: mismatched closing tag </${name}>`)
      }
      i = end + 1
      continue
    }

    // Opening (or self-closing) tag.
    const end = findTagEnd(source, i)
    if (end < 0) throw new Error('parseXml: unterminated tag')
    const selfClosing = source[end - 1] === '/'
    const inner = source.slice(i + 1, selfClosing ? end - 1 : end)
    const element = readTag(inner)
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(element)
    else if (!root) root = element
    if (!selfClosing) stack.push(element)
    i = end + 1
  }

  if (!root) throw new Error('parseXml: no root element')
  if (stack.length > 0) throw new Error(`parseXml: unclosed tag <${stack[stack.length - 1]!.name}>`)
  return root
}

/** Find the index of the `>` that closes the tag starting at `open`, respecting quoted values. */
function findTagEnd(source: string, open: number): number {
  let quote: string | null = null
  for (let j = open + 1; j < source.length; j++) {
    const ch = source[j]!
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return j
    }
  }
  return -1
}

/** Parse a tag's inner text (`path d="…" fill="none"`) into an element with its attributes. */
function readTag(inner: string): MutableElement {
  const attrs: Record<string, string> = {}
  const attrRe = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  // The tag name is the first token up to whitespace or slash.
  const nameMatch = /^\s*([^\s/>]+)/.exec(inner)
  const name = localName(nameMatch ? nameMatch[1]! : inner.trim())
  while ((m = attrRe.exec(inner)) !== null) {
    const key = m[1]!
    const value = m[3] ?? m[4] ?? ''
    attrs[key] = decodeEntities(value)
  }
  return { name, attrs, children: [] }
}
