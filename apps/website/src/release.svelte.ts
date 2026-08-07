// One shared lookup of the latest release, so the hero button and the platform
// cards agree and the API is hit once per visit rather than once per component.

import { detectPlatform, fetchLatestRelease, type LatestRelease, type PlatformId } from './releases'

interface UserAgentData {
  getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>
}

let release = $state<LatestRelease | null>(null)
let platform = $state<PlatformId | null>(null)
/** True once the lookup has settled, either way — the button waits rather than flickering. */
let settled = $state(false)
let started = false

/**
 * Apple silicon vs Intel is only knowable from the Client Hints API, which is
 * Chromium-only; elsewhere `detectPlatform` falls back to a labelled guess.
 */
async function architecture(): Promise<string | undefined> {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  if (!data) return undefined
  try {
    return (await data.getHighEntropyValues(['architecture'])).architecture
  } catch {
    return undefined
  }
}

/** Idempotent: safe to call from every component that needs the release. */
export function initRelease(): void {
  if (started) return
  started = true
  void (async () => {
    platform = detectPlatform(navigator.userAgent, await architecture())
    release = await fetchLatestRelease()
    settled = true
  })()
}

export const releaseState = {
  get release(): LatestRelease | null {
    return release
  },
  get platform(): PlatformId | null {
    return platform
  },
  get settled(): boolean {
    return settled
  },
}
