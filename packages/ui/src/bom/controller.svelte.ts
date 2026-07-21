import type { BomReport } from '@vitrum/core'
import { buildBomDocument, bomToCsv, renderPdf } from '@vitrum/paper'
import { SvelteSet } from 'svelte/reactivity'

/** Writes generated PDF bytes to the host (native dialog on desktop, download in the browser). */
export type SavePdf = (suggestedName: string, bytes: Uint8Array) => Promise<string | null>
/** Writes a generated text document (CSV) to the host. */
export type SaveText = (suggestedName: string, text: string) => Promise<string | null>

/** How the cutting-list rows are ordered in the panel (Diafane parity). */
export type CutSort = 'number' | 'size'

/**
 * The reactive owner of the Manufacturing panel's view state (F-042): the cutting-list sort choice,
 * the currently highlighted line item (traceability — clicking a row lights up its pieces/segments on
 * the canvas), and the PDF/CSV export runners. The BOM report itself is derived upstream in the shell
 * from the live document via `computeBom`, so it stays live (FR-2); this class holds no report state.
 */
export class BomController {
  /** Cutting-list sort order (per glass section). */
  sort = $state<CutSort>('number')

  /** Piece display ids to highlight on the canvas for the picked line item (traceability). */
  highlightPieces = $state<Set<string>>(new SvelteSet())
  /** Segment ids to highlight on the canvas for the picked line item (came/foil traceability). */
  highlightSegments = $state<Set<string>>(new SvelteSet())

  exporting = $state(false)
  errorMessage = $state<string | null>(null)
  lastSavedPath = $state<string | null>(null)

  /** Highlight a set of pieces and/or segments (empty sets clear the highlight). */
  highlight(pieceIds: readonly string[], segmentIds: readonly string[] = []): void {
    this.highlightPieces = new SvelteSet(pieceIds)
    this.highlightSegments = new SvelteSet(segmentIds)
  }

  clearHighlight(): void {
    if (this.highlightPieces.size > 0) this.highlightPieces = new SvelteSet()
    if (this.highlightSegments.size > 0) this.highlightSegments = new SvelteSet()
  }

  /** Build and export the cutting-list / BOM PDF. Errors are captured, not thrown, for the panel. */
  async exportPdf(
    report: BomReport,
    projectName: string,
    unit: 'mm' | 'in',
    savePdf: SavePdf,
  ): Promise<string | null> {
    return this.#run(async () => {
      const doc = buildBomDocument(report, { projectName, unit })
      const bytes = await renderPdf(doc)
      return savePdf(`${sanitize(projectName)}-cutlist.pdf`, bytes)
    })
  }

  /** Build and export the cutting-list / BOM CSV. */
  async exportCsv(
    report: BomReport,
    projectName: string,
    unit: 'mm' | 'in',
    saveText: SaveText,
  ): Promise<string | null> {
    return this.#run(async () =>
      saveText(`${sanitize(projectName)}-cutlist.csv`, bomToCsv(report, unit)),
    )
  }

  async #run(task: () => Promise<string | null>): Promise<string | null> {
    this.exporting = true
    this.errorMessage = null
    try {
      const path = await task()
      this.lastSavedPath = path
      return path
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      this.exporting = false
    }
  }
}

/** A filesystem-friendly base filename from a project name. */
function sanitize(name: string): string {
  const trimmed = name
    .trim()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return trimmed || 'panel'
}
