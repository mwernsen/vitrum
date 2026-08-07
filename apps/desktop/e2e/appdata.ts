import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A fresh, per-test app-data root for one `electron.launch`.
 *
 * F-058 made the launch screen the startup state, which means **every** spec now reads the panel
 * library at boot. Without this, specs would read and write the developer's real
 * `userData/library` — mutating real user data, and making startup order-dependent: whether a spec
 * meets an empty library or a populated grid with a Continue hero would depend on what an earlier
 * spec left behind.
 *
 * `mkdtempSync` gives a unique directory per call, so parallel workers and repeated runs cannot
 * collide (stronger than a `pid`/counter scheme). Spread it into an `electron.launch` env, before any
 * override the spec sets deliberately:
 *
 * ```ts
 * env: { ...process.env, ...isolatedAppData(), VITRUM_AUTOSAVE_PATH: mine }
 * ```
 *
 * A spec that wants a *pre-populated* library should seed one inside its own isolated directory
 * rather than inherit whatever happens to be on the machine.
 */
/**
 * `process.env` with undefined values dropped, so it satisfies Playwright's `Record<string, string>`
 * env type when spread alongside a typed override object.
 */
export function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) out[key] = value
  return out
}

export function isolatedAppData(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'vitrum-e2e-appdata-'))
  return {
    VITRUM_LIBRARY_PATH: join(dir, 'library'),
    VITRUM_VERSIONS_PATH: join(dir, 'versions'),
    VITRUM_AUTOSAVE_PATH: join(dir, 'autosave.vitrum'),
  }
}
