import { formatLength, type LengthUnit } from '@vitrum/core'
import type { PanelEntry, PanelFacts } from '@vitrum/model'

/**
 * Display helpers for the launch screen (F-058, panel `#2a`). Plain TS rather than inline in the
 * component so they are unit-testable — and so the `Date` arithmetic below stays out of a Svelte
 * module, where the reactivity lint rule (rightly) objects to raw `Date` instances.
 *
 * The copy shapes come straight off the design: the hero reads "edited 12 min ago · 128 panes ·
 * 24.6 m came", cards read "36 panes · 8.2 m came" and "5d ago".
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

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * Compact relative time, in the design's own vocabulary: "just now", "12 min ago", "3h ago", "5d ago",
 * "2w ago", then a plain date once a month has passed. `now` is injectable so boundaries are testable.
 */
export function relativeTime(at: number, now: number = Date.now()): string {
  if (!at) return 'never'
  const elapsed = Math.max(0, now - at)
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`
  if (elapsed < 5 * WEEK) return `${Math.floor(elapsed / WEEK)}w ago`
  return new Date(at).toLocaleDateString()
}

/**
 * When the panel was last touched, preferring the last *save* — "edited" should mean edited, and
 * merely opening a file is not editing it. Falls back to the last open for an entry that has never been
 * saved by an indexing build (FR-10 back-compat).
 */
export function editedAt(entry: PanelEntry): number {
  return entry.lastSavedAt ?? entry.lastOpenedAt
}

/**
 * The design's mono figure line: "128 panes · 24.6 m came" — or "· 24.6 m seam" for a foil panel,
 * since "came" would simply be wrong there. Null when the entry carries no indexed facts, so the
 * surface omits the line rather than printing zeroes it does not know (FR-10).
 */
export function panelFigures(entry: PanelEntry): string | null {
  const { facts } = entry
  if (!facts) return null
  const parts = [`${facts.panes} ${facts.panes === 1 ? 'pane' : 'panes'}`]
  if (facts.leadLengthMm > 0) {
    const metres = facts.leadLengthMm / 1000
    parts.push(`${metres.toFixed(1)} m ${entry.technique === 'foil' ? 'seam' : 'came'}`)
  }
  return parts.join(' · ')
}

/** One readiness pill on the Continue hero. Tone picks the token palette, mirroring the design. */
export interface ReadinessPill {
  readonly id: 'geometry' | 'glass' | 'checks'
  readonly label: string
  readonly tone: 'done' | 'progress' | 'attention'
  /** For the glass pill: the painted fraction as a percentage, drawn as a conic-gradient dot. */
  readonly percent?: number
}

/**
 * The hero's readiness pills (FR-9), derived from the indexed facts. Deliberately the same three
 * judgements the editor's own `ReadinessMeter` makes — geometry closes, every piece has glass, checks
 * are clear — so the library and the cockpit never disagree about whether a panel is ready.
 */
export function readinessPills(facts: PanelFacts): ReadinessPill[] {
  const pills: ReadinessPill[] = []

  pills.push(
    facts.panes > 0
      ? { id: 'geometry', label: 'Geometry complete', tone: 'done' }
      : { id: 'geometry', label: 'Geometry open', tone: 'attention' },
  )

  if (facts.panes > 0) {
    const percent = Math.round((facts.paintedPanes / facts.panes) * 100)
    pills.push(
      percent === 100
        ? { id: 'glass', label: 'Glass complete', tone: 'done', percent }
        : { id: 'glass', label: `Glass ${percent}%`, tone: 'progress', percent },
    )
  }

  if (!facts.checksRun) {
    pills.push({ id: 'checks', label: 'Checks not run', tone: 'progress' })
  } else if (facts.checksOutstanding > 0) {
    pills.push({
      id: 'checks',
      label: `${facts.checksOutstanding} check${facts.checksOutstanding === 1 ? '' : 's'} to review`,
      tone: 'attention',
    })
  } else {
    pills.push({ id: 'checks', label: 'Checks clear', tone: 'done' })
  }

  return pills
}
