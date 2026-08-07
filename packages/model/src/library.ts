import { defaultTechnique, type TechniqueKind } from './technique'
import { createEmptyProject, type Project } from './types'

/**
 * The panel library (F-058): the user's recently opened `.vitrum` files, persisted outside any
 * document in the app-data directory (see {@link LibraryPort}). Like the glass library (F-022) and
 * version history (F-055) it is app-level state, not part of the document/undo model.
 *
 * It is deliberately a **view over the user's files**, never a vault that owns them: an entry is a
 * path plus display metadata, and a file that moved or vanished renders in a missing state with
 * locate / forget actions rather than being silently resurrected. Nothing here touches the DOM,
 * Svelte or Electron.
 */
export const PANEL_LIBRARY_VERSION = 1

/** How many recents to retain; the oldest-opened entry is evicted past this (FR-7). */
export const MAX_LIBRARY_ENTRIES = 50

/**
 * The panel's derived facts, written into its entry **when the editor saves** (FR-10). The grid and
 * the Continue hero then show real figures without opening any file — and crucially without running
 * F-020 piece detection at browse time across the whole library, which is why this is indexed at save
 * rather than on browse (Open question 6).
 *
 * Raw counts, not percentages: the surface derives "Glass 86%" and "geometry complete" from these, so
 * the stored shape stays honest and the presentation can change without a migration.
 */
export interface PanelFacts {
  /** Pieces F-020 detected — the design's "panes". Zero means geometry does not close yet. */
  readonly panes: number
  /** Pieces with glass assigned (F-023), so the surface can show the painted fraction. */
  readonly paintedPanes: number
  /**
   * Lead came length, or foil seam length for a foil panel (F-042) — in mm, like all stored lengths.
   * Which one it is follows the entry's own `technique`.
   */
  readonly leadLengthMm: number
  /** Actionable DRC violations: errors + warnings, the figure the editor's activity rail badges. */
  readonly checksOutstanding: number
  /** Whether checks had ever run when this was indexed — "not run" reads differently from "clear". */
  readonly checksRun: boolean
}

/**
 * One recently opened panel. Everything the grid shows except the thumbnail, which is rendered
 * lazily from the file and cached separately (FR-6) rather than stored here — document *content*
 * never lives in the library.
 */
export interface PanelEntry {
  /** Absolute path of the `.vitrum` file. The entry's identity. */
  readonly path: string
  /** The panel's name, from `Project.settings.name` when it was last opened. */
  readonly name: string
  /** The document's display unit, so the grid reads dimensions the way the file does. */
  readonly units: 'mm' | 'in'
  /** Panel extent in mm, when the document declares one. */
  readonly widthMm?: number
  readonly heightMm?: number
  readonly technique: TechniqueKind
  /** Epoch milliseconds the panel was last opened (or saved back to the library). */
  readonly lastOpenedAt: number
  /**
   * Epoch milliseconds the panel was last *saved*, set only by the save path. The design's hero reads
   * "edited 12 min ago", which is this — merely opening a file is not editing it. Absent until the
   * panel is saved at least once by a build that indexes (FR-10 back-compat).
   */
  readonly lastSavedAt?: number
  /**
   * Derived figures captured at the last save (FR-10). Absent for an entry written by an older build,
   * or one only ever opened — the surface then renders without the figures rather than erroring, and
   * gains them on the next save.
   */
  readonly facts?: PanelFacts
}

/** The persisted library: entries newest-opened first. */
export interface PanelLibrary {
  readonly version: number
  readonly entries: readonly PanelEntry[]
}

export function emptyPanelLibrary(): PanelLibrary {
  return { version: PANEL_LIBRARY_VERSION, entries: [] }
}

/**
 * Describe a document for the library grid, as of `at` (epoch ms). Pass `indexed` on the **save** path
 * to capture the panel's derived figures and stamp `lastSavedAt` (FR-10); omit it when merely opening,
 * which must not claim the panel was edited.
 */
export function panelEntryFor(
  path: string,
  project: Project,
  at: number,
  indexed?: PanelFacts,
): PanelEntry {
  const size = project.settings.panelSize
  return {
    path,
    name: project.settings.name || 'Untitled panel',
    units: project.settings.units,
    ...(size ? { widthMm: size.width, heightMm: size.height } : {}),
    technique: project.technique.kind,
    lastOpenedAt: at,
    ...(indexed ? { lastSavedAt: at, facts: indexed } : {}),
  }
}

/**
 * Merge a refreshed entry over whatever the library already knew about that path, so re-*opening* a
 * panel keeps the figures and save time indexed by its last save instead of blanking them. A fresh
 * `facts` (from a save) always wins.
 */
function mergeEntry(previous: PanelEntry | undefined, next: PanelEntry): PanelEntry {
  if (!previous) return next
  const facts = next.facts ?? previous.facts
  const lastSavedAt = next.lastSavedAt ?? previous.lastSavedAt
  return {
    ...next,
    ...(facts ? { facts } : {}),
    ...(lastSavedAt !== undefined ? { lastSavedAt } : {}),
  }
}

/**
 * Record that a panel was opened (or saved): its entry moves to the front with refreshed metadata,
 * any older entry for the same path is replaced, and the list is capped at
 * {@link MAX_LIBRARY_ENTRIES} by dropping the oldest-opened entries (FR-7).
 */
export function recordPanelOpened(library: PanelLibrary, entry: PanelEntry): PanelLibrary {
  const previous = library.entries.find((e) => e.path === entry.path)
  const rest = library.entries.filter((e) => e.path !== entry.path)
  return {
    version: PANEL_LIBRARY_VERSION,
    entries: [mergeEntry(previous, entry), ...rest].slice(0, MAX_LIBRARY_ENTRIES),
  }
}

/** Drop an entry from the library ("remove from library"). The file on disk is untouched. */
export function forgetPanel(library: PanelLibrary, path: string): PanelLibrary {
  return {
    version: PANEL_LIBRARY_VERSION,
    entries: library.entries.filter((e) => e.path !== path),
  }
}

/**
 * Rebind a missing entry to the path the user located it at (FR-2). The entry keeps its metadata and
 * its place in the list; an existing entry already pointing at `toPath` is absorbed, so locating a
 * file onto one already in the library never leaves a duplicate.
 */
export function relocatePanel(
  library: PanelLibrary,
  fromPath: string,
  toPath: string,
): PanelLibrary {
  if (fromPath === toPath) return library
  const entries: PanelEntry[] = []
  for (const entry of library.entries) {
    if (entry.path === toPath) continue // absorbed by the relocated entry
    entries.push(entry.path === fromPath ? { ...entry, path: toPath } : entry)
  }
  return { version: PANEL_LIBRARY_VERSION, entries }
}

/**
 * The thumbnail cache key for a file: its path plus the modification time it was rendered from, so a
 * file edited outside the library re-renders instead of showing a stale preview (FR-6).
 */
export function panelThumbnailKey(path: string, mtimeMs: number): string {
  return `${path.replace(/[^a-zA-Z0-9._-]/g, '_')}@${Math.round(mtimeMs)}`
}

export function serializePanelLibrary(library: PanelLibrary): string {
  return JSON.stringify(library)
}

/**
 * Parse a persisted library. Tolerant by design (FR-7 — the library must never block startup):
 * malformed JSON, a wrong shape or an unreadable entry yields an empty library / drops that entry
 * rather than throwing.
 */
export function deserializePanelLibrary(contents: string): PanelLibrary {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return emptyPanelLibrary()
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyPanelLibrary()
  const raw = (parsed as { entries?: unknown }).entries
  if (!Array.isArray(raw)) return emptyPanelLibrary()
  const entries: PanelEntry[] = []
  for (const item of raw) {
    const entry = parseEntry(item)
    if (entry) entries.push(entry)
  }
  return { version: PANEL_LIBRARY_VERSION, entries: entries.slice(0, MAX_LIBRARY_ENTRIES) }
}

function parseEntry(item: unknown): PanelEntry | null {
  if (typeof item !== 'object' || item === null) return null
  const r = item as Record<string, unknown>
  if (typeof r['path'] !== 'string' || r['path'] === '') return null
  const width = typeof r['widthMm'] === 'number' ? r['widthMm'] : undefined
  const height = typeof r['heightMm'] === 'number' ? r['heightMm'] : undefined
  const savedAt = typeof r['lastSavedAt'] === 'number' ? r['lastSavedAt'] : undefined
  const facts = parseFacts(r['facts'])
  return {
    path: r['path'],
    name: typeof r['name'] === 'string' && r['name'] !== '' ? r['name'] : 'Untitled panel',
    units: r['units'] === 'in' ? 'in' : 'mm',
    ...(width !== undefined ? { widthMm: width } : {}),
    ...(height !== undefined ? { heightMm: height } : {}),
    technique: r['technique'] === 'foil' ? 'foil' : 'lead',
    lastOpenedAt: typeof r['lastOpenedAt'] === 'number' ? r['lastOpenedAt'] : 0,
    ...(savedAt !== undefined ? { lastSavedAt: savedAt } : {}),
    ...(facts ? { facts } : {}),
  }
}

/**
 * Parse an indexed facts block, dropping it wholesale if it is not fully well-formed. Half-trusted
 * figures would be worse than none: the surface already renders cleanly without them (FR-10).
 */
function parseFacts(raw: unknown): PanelFacts | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const num = (key: string): number | null =>
    typeof r[key] === 'number' && Number.isFinite(r[key]) ? (r[key] as number) : null
  const panes = num('panes')
  const paintedPanes = num('paintedPanes')
  const leadLengthMm = num('leadLengthMm')
  const checksOutstanding = num('checksOutstanding')
  if (panes === null || paintedPanes === null) return null
  if (leadLengthMm === null || checksOutstanding === null) return null
  return {
    panes,
    paintedPanes,
    leadLengthMm,
    checksOutstanding,
    checksRun: r['checksRun'] === true,
  }
}

/**
 * Whether an entry matches the launch screen's search box (FR-11): case-insensitive, on the panel's
 * name, plus its file name so a panel found by where it lives still matches. A blank query matches
 * everything, so the caller can pass the raw field value.
 */
export function panelMatches(entry: PanelEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  if (entry.name.toLowerCase().includes(needle)) return true
  const fileName = entry.path.split(/[/\\]/).pop() ?? ''
  return fileName.toLowerCase().includes(needle)
}

/** What the new-panel dialog decides (FR-3). Dimensions have already been validated and converted. */
export interface NewPanelSpec {
  readonly name: string
  readonly units: 'mm' | 'in'
  readonly widthMm: number
  readonly heightMm: number
  readonly technique: TechniqueKind
}

/**
 * Build a fresh project from the new-panel dialog's choices (FR-3): the `Project.settings` and
 * `technique` fields that have existed since F-002/F-021 but had no creation-time UI. Every other
 * block is its default, so the document enters the editor clean.
 */
export function createPanelProject(spec: NewPanelSpec): Project {
  const base = createEmptyProject({
    name: spec.name,
    units: spec.units,
    panelSize: { width: spec.widthMm, height: spec.heightMm },
  })
  return { ...base, technique: { ...defaultTechnique(), kind: spec.technique } }
}

/**
 * How the UI reaches the persisted panel library and its thumbnail cache (F-058). Mirrors the
 * F-022 `GlassLibraryPort` / F-055 `VersionPort` split: the desktop host writes the app-data
 * directory, the browser stub uses `localStorage`, tests use maps — so `packages/ui` stays
 * Electron-free while the desktop app tracks real files.
 */
export interface LibraryPort {
  /** Read the persisted library JSON, or null on first run. */
  load(): Promise<string | null>
  /** Persist the library JSON (called after every change). */
  save(contents: string): Promise<void>
  /**
   * Modification time (epoch ms) for each path, or null where the file is missing or unreadable —
   * how the grid derives its missing state (FR-2) and the thumbnail cache key (FR-6). Resolves in
   * the same order as `paths` and never rejects, so a slow or absent disk cannot block the library
   * (FR-7).
   */
  stat(paths: readonly string[]): Promise<readonly (number | null)[]>
  /** Read a cached thumbnail (PNG bytes) for a {@link panelThumbnailKey}, or null on a miss. */
  loadThumbnail(key: string): Promise<Uint8Array | null>
  /** Cache a rendered thumbnail (PNG bytes) under a {@link panelThumbnailKey}. */
  saveThumbnail(key: string, bytes: Uint8Array): Promise<void>
}
