import { describe, expect, it } from 'vitest'

import { RELEASES_URL } from './links'
import {
  detectPlatform,
  downloadHref,
  fetchLatestRelease,
  pickDeb,
  pickInstaller,
  type LatestRelease,
  type ReleaseAsset,
} from './releases'

/** The real asset set electron-builder published for v0.1.1. */
const ASSETS: ReleaseAsset[] = [
  'Vitrum-0.1.1-amd64.deb',
  'Vitrum-0.1.1-arm64-mac.zip',
  'Vitrum-0.1.1-arm64.dmg',
  'Vitrum-0.1.1-mac.zip',
  'Vitrum-0.1.1-x86_64.AppImage',
  'Vitrum-0.1.1.dmg',
  'Vitrum-Setup-0.1.1.exe',
].map((name) => ({ name, url: `https://example.test/${name}` }))

const RELEASE: LatestRelease = { version: '0.1.1', assets: ASSETS }

const UA = {
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
}

describe('detectPlatform', () => {
  it('reads Windows and Linux off the user agent', () => {
    expect(detectPlatform(UA.windows)).toBe('windows')
    expect(detectPlatform(UA.linux)).toBe('linux')
  })

  it('uses the architecture hint on macOS when Chromium supplies one', () => {
    expect(detectPlatform(UA.macSafari, 'arm')).toBe('mac-arm64')
    expect(detectPlatform(UA.macSafari, 'x86')).toBe('mac-x64')
  })

  it('assumes Apple silicon when no hint is available', () => {
    // Safari reports "Intel" even on Apple silicon, so the UA string cannot be
    // trusted here; the button label is what lets an Intel owner self-correct.
    expect(detectPlatform(UA.macSafari)).toBe('mac-arm64')
  })

  it('claims nothing for phones', () => {
    // Android matches /Linux/ but must not be offered a desktop AppImage.
    expect(detectPlatform(UA.android)).toBeNull()
    expect(detectPlatform(UA.iphone)).toBeNull()
  })
})

describe('pickInstaller', () => {
  it('picks the arch-specific dmg for Apple silicon', () => {
    expect(pickInstaller(ASSETS, 'mac-arm64')?.name).toBe('Vitrum-0.1.1-arm64.dmg')
  })

  it('picks the unsuffixed dmg for Intel, never the arm64 one', () => {
    expect(pickInstaller(ASSETS, 'mac-x64')?.name).toBe('Vitrum-0.1.1.dmg')
  })

  it('picks the installer exe and the AppImage', () => {
    expect(pickInstaller(ASSETS, 'windows')?.name).toBe('Vitrum-Setup-0.1.1.exe')
    expect(pickInstaller(ASSETS, 'linux')?.name).toBe('Vitrum-0.1.1-x86_64.AppImage')
  })

  it('never offers a mac zip in place of the dmg', () => {
    for (const platform of ['mac-arm64', 'mac-x64'] as const) {
      expect(pickInstaller(ASSETS, platform)?.name).toMatch(/\.dmg$/)
    }
  })

  it('keeps matching when the version changes', () => {
    const next = ASSETS.map((a) => ({ ...a, name: a.name.replace('0.1.1', '2.4.0') }))
    expect(pickInstaller(next, 'mac-arm64')?.name).toBe('Vitrum-2.4.0-arm64.dmg')
    expect(pickInstaller(next, 'windows')?.name).toBe('Vitrum-Setup-2.4.0.exe')
  })

  it('returns null when the release lacks that platform', () => {
    expect(pickInstaller([], 'windows')).toBeNull()
  })
})

describe('pickDeb', () => {
  it('finds the Debian package', () => {
    expect(pickDeb(ASSETS)?.name).toBe('Vitrum-0.1.1-amd64.deb')
  })
})

describe('downloadHref', () => {
  it('gives a direct asset URL when both release and platform are known', () => {
    expect(downloadHref(RELEASE, 'windows')).toBe('https://example.test/Vitrum-Setup-0.1.1.exe')
  })

  it('falls back to the releases page when the release is unknown', () => {
    // The state while every release is still a draft: the API 404s.
    expect(downloadHref(null, 'windows')).toBe(RELEASES_URL)
  })

  it('falls back when the platform cannot be identified', () => {
    expect(downloadHref(RELEASE, null)).toBe(RELEASES_URL)
  })
})

describe('fetchLatestRelease', () => {
  const ok = (body: unknown) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)

  it('maps the API payload to assets', async () => {
    const release = await fetchLatestRelease(() =>
      ok({
        tag_name: 'v0.1.1',
        assets: [{ name: 'Vitrum-0.1.1.dmg', browser_download_url: 'https://example.test/a.dmg' }],
      }),
    )
    expect(release).toEqual({
      version: '0.1.1',
      assets: [{ name: 'Vitrum-0.1.1.dmg', url: 'https://example.test/a.dmg' }],
    })
  })

  it('returns null on 404 — the draft-only case', async () => {
    const release = await fetchLatestRelease(() =>
      Promise.resolve({ ok: false, status: 404 } as Response),
    )
    expect(release).toBeNull()
  })

  it('returns null when the network throws', async () => {
    const release = await fetchLatestRelease(() => Promise.reject(new Error('offline')))
    expect(release).toBeNull()
  })

  it('returns null for a release with no assets', async () => {
    const release = await fetchLatestRelease(() => ok({ tag_name: 'v0.1.1', assets: [] }))
    expect(release).toBeNull()
  })

  it('skips malformed assets rather than emitting empty links', async () => {
    const release = await fetchLatestRelease(() =>
      ok({
        tag_name: 'v0.1.1',
        assets: [
          { name: 'no-url.dmg' },
          { name: 'good.exe', browser_download_url: 'https://example.test/good.exe' },
        ],
      }),
    )
    expect(release?.assets).toEqual([{ name: 'good.exe', url: 'https://example.test/good.exe' }])
  })
})
