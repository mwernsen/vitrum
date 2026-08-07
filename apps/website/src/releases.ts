// Resolving "the right download" for a visitor.
//
// The buttons used to point at the releases page and leave the visitor to work
// out which of seven files they wanted. Instead we read the latest release from
// the GitHub API and hand back a direct asset URL for their platform.
//
// Everything degrades to the releases page: the API is unauthenticated (60
// requests/hour per IP), returns 404 while every release is still a draft, and
// is simply absent offline. A landing page must never present a dead button, so
// callers treat `null` as "link to the releases page" rather than an error.

import { RELEASES_URL } from './links'

const LATEST_API = 'https://api.github.com/repos/mwernsen/vitrum/releases/latest'

/** A platform we ship a distinct installer for. */
export type PlatformId = 'mac-arm64' | 'mac-x64' | 'windows' | 'linux'

export interface ReleaseAsset {
  readonly name: string
  /** Direct download URL (GitHub's `browser_download_url`). */
  readonly url: string
}

export interface LatestRelease {
  /** Tag without the leading `v`, e.g. "0.1.1". */
  readonly version: string
  readonly assets: readonly ReleaseAsset[]
}

/** Human label for a platform, used on the button itself. */
export const PLATFORM_LABELS: Record<PlatformId, string> = {
  'mac-arm64': 'macOS (Apple silicon)',
  'mac-x64': 'macOS (Intel)',
  windows: 'Windows',
  linux: 'Linux',
}

/**
 * Which installer each platform wants, matched against the names electron-builder
 * produces (`Vitrum-0.1.1-arm64.dmg`, `Vitrum-Setup-0.1.1.exe`, …). Matching on
 * shape rather than an exact name keeps this working as the version changes.
 *
 * The Intel dmg is the one *without* an arch in its name, so it must be tested
 * after the arm64 pattern has had its chance.
 */
const INSTALLER_PATTERNS: Record<PlatformId, RegExp> = {
  'mac-arm64': /-arm64\.dmg$/,
  'mac-x64': /^(?:(?!arm64).)*\.dmg$/,
  windows: /\.exe$/,
  linux: /\.AppImage$/,
}

/** The Debian package, offered alongside the AppImage rather than auto-picked. */
const DEB_PATTERN = /\.deb$/

/**
 * Best guess at the visitor's platform.
 *
 * `arch` comes from `navigator.userAgentData.getHighEntropyValues(['architecture'])`,
 * which only Chromium answers. Safari on Apple silicon reports itself as Intel, so
 * when the hint is missing we assume Apple silicon — it is the overwhelming majority
 * of Macs in use, and the button says which build it is so an Intel owner can see
 * the mismatch and pick the other one. Guessing Intel instead would hand every
 * Apple silicon visitor a Rosetta build silently.
 */
export function detectPlatform(userAgent: string, arch?: string): PlatformId | null {
  // iOS first: an iPhone's user agent says "like Mac OS X", so the macOS test
  // below would otherwise hand it a dmg. An iPad in desktop mode is genuinely
  // indistinguishable from a Mac by user agent alone and is left to fall through;
  // it lands on a download it cannot open, which the platform cards make obvious.
  if (/iPhone|iPod|iPad/i.test(userAgent)) return null
  if (/Windows|Win32|Win64/i.test(userAgent)) return 'windows'
  if (/Mac OS X|Macintosh/i.test(userAgent)) {
    if (arch === 'x86' || arch === 'x86_64') return 'mac-x64'
    return 'mac-arm64'
  }
  // Android is Linux-y by user agent but is not a desktop target.
  if (/Android/i.test(userAgent)) return null
  if (/Linux|X11/i.test(userAgent)) return 'linux'
  return null
}

/** The installer for `platform`, or null when the release has no matching asset. */
export function pickInstaller(
  assets: readonly ReleaseAsset[],
  platform: PlatformId,
): ReleaseAsset | null {
  return assets.find((asset) => INSTALLER_PATTERNS[platform].test(asset.name)) ?? null
}

/** The `.deb`, for the Linux card's secondary link. */
export function pickDeb(assets: readonly ReleaseAsset[]): ReleaseAsset | null {
  return assets.find((asset) => DEB_PATTERN.test(asset.name)) ?? null
}

/** A direct download URL when one can be resolved, else the releases page. */
export function downloadHref(release: LatestRelease | null, platform: PlatformId | null): string {
  if (!release || !platform) return RELEASES_URL
  return pickInstaller(release.assets, platform)?.url ?? RELEASES_URL
}

interface GithubReleaseResponse {
  tag_name?: string
  assets?: { name?: string; browser_download_url?: string }[]
}

/**
 * Read the latest published release. Returns null for every failure mode —
 * draft-only (404), rate limiting, offline — so callers fall back rather than throw.
 */
export async function fetchLatestRelease(
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<LatestRelease | null> {
  try {
    const response = await fetchFn(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return null
    const body = (await response.json()) as GithubReleaseResponse
    const assets: ReleaseAsset[] = (body.assets ?? [])
      .filter((asset) => asset.name && asset.browser_download_url)
      .map((asset) => ({ name: asset.name!, url: asset.browser_download_url! }))
    if (assets.length === 0) return null
    return { version: (body.tag_name ?? '').replace(/^v/, ''), assets }
  } catch {
    return null
  }
}
