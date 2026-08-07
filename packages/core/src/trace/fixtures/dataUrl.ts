/**
 * Decoding the base64 data URLs Vite's `?inline` import gives us for the binary fixtures.
 *
 * Pure `core` has no `@types/node`, so `Buffer`, `atob` and `TextDecoder` are all off the table (the
 * F-050 lesson: reaching for them drags DOM/node libs into a package that must stay a leaf). Base64 is
 * six lines, so it lives here.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Decode a `data:...;base64,...` URL into its bytes. */
export function decodeDataUrl(url: string): Uint8Array {
  const comma = url.indexOf(',')
  if (comma < 0) throw new Error('decodeDataUrl: not a data URL')
  return decodeBase64(url.slice(comma + 1))
}

export function decodeBase64(text: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) lookup[ALPHABET.charCodeAt(i)] = i

  let length = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 128 && lookup[code]! >= 0) length++
  }
  const out = new Uint8Array(Math.floor((length * 3) / 4))
  let acc = 0
  let bits = 0
  let at = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const value = code < 128 ? lookup[code]! : -1
    if (value < 0) continue
    acc = (acc << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (acc >> bits) & 0xff
    }
  }
  return out
}
