import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { deserialize, serialize, type Migration } from './serialize'
import type { AssetId, Project, ReferenceAsset } from './types'

/**
 * The `.vitrum` file container (F-051). A project used to be plain JSON text (F-002); once it can
 * embed reference images (photos, scans) the file becomes a **zip**:
 *
 * ```
 * document.json        the versioned envelope — exactly the F-002 JSON, migrations still apply
 * assets/manifest.json { [assetId]: mime }
 * assets/<assetId>     the raw (already downscaled) image bytes, one entry per layer image
 * ```
 *
 * Keeping the bytes as separate zip entries (rather than base64 inside the JSON) means the JSON
 * stays small and the images incur no size bloat. `fflate` is a pure, dependency-free zip codec
 * that runs in both Node and the browser, so this stays inside `@vitrum/model` with no host help.
 *
 * There is deliberately **no** reader for the old text-JSON `.vitrum` — there are no existing files
 * (decided with Mathieu at F-051 expansion), so `unpackDocument` only understands the zip form.
 */

const DOCUMENT_ENTRY = 'document.json'
const MANIFEST_ENTRY = 'assets/manifest.json'
const ASSET_PREFIX = 'assets/'

export interface UnpackedDocument {
  readonly project: Project
  readonly assets: Map<AssetId, ReferenceAsset>
}

/** Serialize a project plus its embedded image assets into the `.vitrum` zip bytes. */
export function packDocument(
  project: Project,
  assets: ReadonlyMap<AssetId, ReferenceAsset>,
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [DOCUMENT_ENTRY]: strToU8(serialize(project)),
  }
  const manifest: Record<AssetId, string> = {}
  for (const [id, asset] of assets) {
    files[ASSET_PREFIX + id] = asset.bytes
    manifest[id] = asset.mime
  }
  files[MANIFEST_ENTRY] = strToU8(JSON.stringify(manifest))
  // mtime defaults to 0 → deterministic output; deflate is lossless so image bytes round-trip.
  return zipSync(files, { level: 6 })
}

/**
 * Parse `.vitrum` zip bytes back into a project and its embedded assets, migrating an older
 * `document.json` schema (and rejecting a newer one) exactly as {@link deserialize} does.
 * `migrations` is injectable for testing.
 */
export function unpackDocument(
  bytes: Uint8Array,
  migrations?: readonly Migration[],
): UnpackedDocument {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (cause) {
    throw new Error('Not a valid Vitrum file: the contents are not a valid archive.', { cause })
  }
  const docBytes = files[DOCUMENT_ENTRY]
  if (!docBytes) {
    throw new Error(`Not a valid Vitrum file: missing ${DOCUMENT_ENTRY}.`)
  }
  const project = deserialize(strFromU8(docBytes), migrations)

  const manifestBytes = files[MANIFEST_ENTRY]
  const manifest: Record<string, string> = manifestBytes
    ? (JSON.parse(strFromU8(manifestBytes)) as Record<string, string>)
    : {}

  const assets = new Map<AssetId, ReferenceAsset>()
  for (const [name, entry] of Object.entries(files)) {
    if (!name.startsWith(ASSET_PREFIX) || name === MANIFEST_ENTRY) continue
    const id = name.slice(ASSET_PREFIX.length)
    if (!id) continue
    assets.set(id, { mime: manifest[id] ?? 'application/octet-stream', bytes: entry })
  }
  return { project, assets }
}

/**
 * A stable, content-addressed id for an image blob (F-051): re-importing the same photo reuses its
 * asset entry (dedup) and the id survives save/load. A 64-bit FNV-1a hash rendered as hex — fast,
 * dependency-free, and collision-safe enough for the handful of images in a project.
 */
export function assetIdFor(bytes: Uint8Array): AssetId {
  // 64-bit FNV-1a over two 32-bit lanes (avoids BigInt for hot-path friendliness).
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i]!
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= bytes[bytes.length - 1 - i]!
    h2 = Math.imul(h2, 0x01000193)
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
  return `img-${hex}`
}
