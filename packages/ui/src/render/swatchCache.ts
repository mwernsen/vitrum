/**
 * A tiny decode cache for glass swatch photos (F-053). A swatch is a data-URL string on the glass;
 * the WebGL renderer needs it decoded to a GPU-uploadable image. Decoding is async, so the cache
 * hands back `undefined` until an image is ready and calls `onDecoded` once it is, which the render
 * layer turns into a redraw (mirroring the F-051 reference-source decode + version-bump pattern).
 *
 * Kept in a plain `.ts` module (not the `.svelte` component) so DOM globals and a plain `Map` cache
 * are available without tripping the Svelte reactivity lint rules — reactivity is driven by the
 * component's `onDecoded` bump, not by mutating this cache.
 */
export class SwatchCache {
  #sources = new Map<string, { url: string; source: TexImageSource }>()
  #pending = new Set<string>()

  constructor(private readonly onDecoded: () => void) {}

  /** The decoded image for a key, or `undefined` while (or if never) decoding. */
  resolve = (key: string): TexImageSource | undefined => this.#sources.get(key)?.source

  /** Kick off decoding `url` under `id` if not already decoded/decoding for that exact url. */
  ensure(id: string, url: string): void {
    if (this.#sources.get(id)?.url === url) return
    if (this.#pending.has(id) || typeof Image === 'undefined') return
    this.#pending.add(id)
    const img = new Image()
    img.onload = () => {
      this.#sources.set(id, { url, source: img })
      this.#pending.delete(id)
      this.onDecoded()
    }
    img.onerror = () => this.#pending.delete(id)
    img.src = url
  }
}
