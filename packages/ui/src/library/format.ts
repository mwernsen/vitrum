import { formatLength, type LengthUnit } from '@vitrum/core'
import type { PanelEntry } from '@vitrum/model'

/**
 * Display helpers for the launch screen's grid (F-058 FR-2). Plain TS rather than inline in the
 * component so they are unit-testable — and so the `Date` arithmetic below stays out of a Svelte
 * module, where the reactivity lint rule (rightly) objects to raw `Date` instances.
 */

/**
 * "300 × 400 mm", in the unit the document itself uses — the unit appears once, on the pair. Null for
 * a panel that declares no extent.
 */
export function panelDimensions(entry: PanelEntry): string | null {
  const { widthMm, heightMm } = entry
  if (widthMm === undefined || heightMm === undefined) return null
  const unit = entry.units as LengthUnit
  const width = formatLength(widthMm, unit).replace(/\s\S+$/, '')
  return `${width} × ${formatLength(heightMm, unit)}`
}

const DAY_MS = 86_400_000

/**
 * When a panel was last opened, in calendar days rather than elapsed hours: "Today", "Yesterday", "4
 * days ago", then a plain date. Precise enough to recognise a panel, quiet enough to skim past.
 * `now` is injectable so the boundaries are testable.
 */
export function lastOpenedLabel(at: number, now: number = Date.now()): string {
  if (!at) return 'Never opened'
  const days = Math.floor(startOfDay(now) / DAY_MS) - Math.floor(startOfDay(at) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(at).toLocaleDateString()
}

/**
 * Local midnight for a timestamp, as a UTC-epoch value — shifting by the offset lets the day index be
 * plain integer division, with no mutable `Date` in sight.
 */
function startOfDay(at: number): number {
  const date = new Date(at)
  return at - date.getTimezoneOffset() * 60_000
}
