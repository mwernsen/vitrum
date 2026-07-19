import type { Glass } from '@vitrum/model'

/**
 * CRUD actions for one glass scope — the global library or the project catalog (F-022). The
 * palette panel is scope-agnostic: it drives whichever bundle it is handed, so the same UI edits
 * the library (via the {@link GlassLibraryController}) or the project (via document commands).
 */
export interface GlassScopeActions {
  upsert: (glass: Glass) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  /** Mint a fresh glass id for a new entry in this scope. */
  newId: () => string
}
